import { asc, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The settle-up writes, driven the way the debts card drives them: `next/headers` is a cookie jar
 * this test owns, so session → guard → endpoint check → transaction runs for real against the
 * embedded database. Only the browser is missing.
 *
 * The cases fall into three groups, and each is the proof of something a screen cannot show:
 *
 * - **the refusals** (AC-5): a stranger, a signed-out caller, a group that does not exist, a
 *   malformed id and a payment naming another group's seat all get *one* answer, compared here to
 *   each other rather than to a string, because a refusal that differs by case is the leak;
 * - **the feed rows** (AC-7): a payment and the row that records it commit together, and the
 *   deleted row still says what happened after the payment itself is gone;
 * - **the departed seat** (AC-8): a seat whose membership row is deleted still owns its ledger,
 *   so a current member can clear what it owes and the group still reaches all-zero.
 */

const jar = vi.hoisted(() => ({ entries: new Map<string, string>() }));

/**
 * Where a successful action landed, as a thrown value rather than a return.
 *
 * A success redirects now — the recorded payment changes the list it was recorded from, so the
 * form that would have shown the confirmation is unmounted with the row — and `redirect()` is a
 * control-flow throw. Catching its own named error is the only way to read the URL back out, the
 * same trick the expense suite uses.
 */
const redirected = vi.hoisted(() => {
  class Redirected extends Error {
    constructor(readonly url: string) {
      super(`redirect:${url}`);
      this.name = 'Redirected';
    }
  }
  return { Redirected };
});

/**
 * The seam inside the payment transaction. `paymentSubject` builds the feed row's sentence, so it
 * is the call that sits between the payment insert and the activity insert; mocking it is how the
 * atomicity case fails the write at that exact point, the way the expense suite mocks
 * `splitAmount`. The actual module is spread back in, so parsing and every message constant behave
 * exactly as they do in production.
 */
const paymentSubjectBox = vi.hoisted(() => ({
  real: undefined as unknown as typeof import('./validation').paymentSubject,
}));

vi.mock('./validation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./validation')>();
  paymentSubjectBox.real = actual.paymentSubject;
  return { ...actual, paymentSubject: vi.fn(actual.paymentSubject) };
});

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.entries.has(name) ? { name, value: jar.entries.get(name) as string } : undefined,
    set: (name: string, value: string) => {
      jar.entries.set(name, value);
    },
    delete: (name: string) => {
      jar.entries.delete(name);
    },
  }),
  headers: async () => new Headers(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new redirected.Redirected(url);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { createPayment, deletePayment } = await import('./actions');
const { computeNetBalances } = await import('./balances');
const { revalidatePath } = await import('next/cache');
const { randomToken } = await import('../random');
const { SESSION_COOKIE, mintSession } = await import('../auth/session');
const { hashPassword } = await import('../auth/password');
const { withDb } = await import('../db/client');
const { listMigrationFiles, runMigrations } = await import('../db/migrate');
const {
  activityEvents,
  expensePayers,
  expenses,
  groups,
  memberships,
  payments,
  sessions,
  splitLines,
  users,
} = await import('../db/schema');
const {
  ARCHIVED_GROUP_MESSAGE,
  GROUP_NOT_FOUND_MESSAGE,
  UNAUTHENTICATED_MESSAGE,
} = await import('../groups/validation');
const {
  IDLE_PAYMENT_STATE,
  PAYMENT_AMOUNT_INVALID_MESSAGE,
  PAYMENT_AMOUNT_POSITIVE_MESSAGE,
  PAYMENT_AMOUNT_TOO_LARGE_MESSAGE,
  PAYMENT_BOTH_DEPARTED_MESSAGE,
  PAYMENT_DELETED,
  PAYMENT_NOT_FOUND_MESSAGE,
  PAYMENT_RECORDED,
  PAYMENT_SAME_MEMBER_MESSAGE,
  paymentSubject,
} = await import('./validation');

const PASSWORD = 'correct horse battery staple';
const MALFORMED = 'not-a-uuid';
const NO_SUCH_ID = '44444444-4444-4444-8444-444444444444';

let passwordHash: string;
let adaId: string;
let boId: string;
let cyId: string;

async function createAccount(email: string, displayName: string): Promise<string> {
  const [user] = await withDb((handle) =>
    handle.db
      .insert(users)
      .values({ email, passwordHash, displayName })
      .returning({ id: users.id }),
  );
  return user.id;
}

async function signInAs(userId: string): Promise<void> {
  const { token } = await withDb((handle) => mintSession(handle.db, userId));
  jar.entries.set(SESSION_COOKIE, token);
}

interface FormSpec {
  groupId: string;
  paymentId?: string;
  fromMembershipId?: string;
  toMembershipId?: string;
  amount?: string;
}

/** A submitted payment, encoded the way the debts card encodes one. */
function paymentForm(spec: FormSpec): FormData {
  const data = new FormData();
  data.set('groupId', spec.groupId);
  if (spec.paymentId !== undefined) data.set('paymentId', spec.paymentId);
  if (spec.fromMembershipId !== undefined) data.set('fromMembershipId', spec.fromMembershipId);
  if (spec.toMembershipId !== undefined) data.set('toMembershipId', spec.toMembershipId);
  if (spec.amount !== undefined) data.set('amount', spec.amount);

  return data;
}

/** Runs an action that is expected to land the caller somewhere, and returns where. */
async function redirectUrl(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof redirected.Redirected) return error.url;
    throw error;
  }
  throw new Error('expected the action to redirect');
}

/** The notice path a recorded payment lands on: the group page carrying the outcome and the pair. */
function paymentNoticeUrl(
  groupId: string,
  notice: string,
  fromMembershipId: string,
  toMembershipId: string,
): string {
  return `/groups/${groupId}?payment=${notice}&from=${fromMembershipId}&to=${toMembershipId}`;
}

interface Fixture {
  groupId: string;
  ada: string;
  bo: string;
  cy: string;
  dee: string;
  otherGroupId: string;
  otherSeat: string;
}

/**
 * A group with three accounts and one placeholder, written straight to the database, plus a
 * second group whose seat exists only to be handed in as an endpoint it has no business being.
 */
async function seedGroup(options: { archived?: boolean } = {}): Promise<Fixture> {
  const joinedAt = Date.parse('2026-01-01T00:00:00Z');

  return withDb(async (handle) => {
    const [group] = await handle.db
      .insert(groups)
      .values({
        name: 'Goa trip',
        currency: 'INR',
        type: 'trip',
        inviteToken: randomToken(),
        archived: options.archived ?? false,
      })
      .returning();

    const seats: string[] = [];
    const members: Array<[string | null, string]> = [
      [adaId, 'Ada'],
      [boId, 'Bo'],
      [cyId, 'Cy'],
      [null, 'Dee'],
    ];

    for (const [index, [userId, displayName]] of members.entries()) {
      const [membership] = await handle.db
        .insert(memberships)
        .values({
          groupId: group.id,
          userId,
          displayName,
          role: index === 0 ? 'owner' : 'member',
          createdAt: new Date(joinedAt + index * 60_000),
        })
        .returning({ id: memberships.id });
      seats.push(membership.id);
    }

    const [other] = await handle.db
      .insert(groups)
      .values({ name: 'Flat', currency: 'INR', type: 'home', inviteToken: randomToken() })
      .returning({ id: groups.id });

    const [otherSeat] = await handle.db
      .insert(memberships)
      .values({ groupId: other.id, userId: adaId, displayName: 'Ada', role: 'owner' })
      .returning({ id: memberships.id });

    return {
      groupId: group.id,
      ada: seats[0],
      bo: seats[1],
      cy: seats[2],
      dee: seats[3],
      otherGroupId: other.id,
      otherSeat: otherSeat.id,
    };
  });
}

/** Ada pays 30 for the three of them, split equally: Ada +20, Bo −10, Cy −10. */
async function recordDinner(fixture: Fixture): Promise<void> {
  await withDb(async (handle) => {
    const [expense] = await handle.db
      .insert(expenses)
      .values({
        groupId: fixture.groupId,
        description: 'Dinner',
        amountMinor: 3000,
        date: '2026-10-05',
        category: 'food',
        splitType: 'equal',
      })
      .returning({ id: expenses.id });

    await handle.db.insert(expensePayers).values({
      expenseId: expense.id,
      membershipId: fixture.ada,
      displayName: 'Ada',
      amountMinor: 3000,
      position: 0,
    });

    for (const [membershipId, displayName] of [
      [fixture.ada, 'Ada'],
      [fixture.bo, 'Bo'],
      [fixture.cy, 'Cy'],
    ] as Array<[string, string]>) {
      await handle.db.insert(splitLines).values({
        expenseId: expense.id,
        membershipId,
        displayName,
        shareMinor: 1000,
      });
    }
  });
}

async function paymentRows(groupId: string) {
  return withDb((handle) =>
    handle.db
      .select()
      .from(payments)
      .where(eq(payments.groupId, groupId))
      .orderBy(asc(payments.createdAt)),
  );
}

async function eventsOf(groupId: string) {
  return withDb((handle) =>
    handle.db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.groupId, groupId))
      .orderBy(asc(activityEvents.createdAt)),
  );
}

async function netsOf(groupId: string): Promise<Map<string, number>> {
  const balances = await withDb((handle) => computeNetBalances(handle.db, groupId));
  return new Map(balances.map((balance) => [balance.membershipId, balance.balanceMinor]));
}

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-session-secret';
  passwordHash = await hashPassword(PASSWORD);
  await withDb((handle) => runMigrations(handle.db));
});

beforeEach(async () => {
  await withDb(async (handle) => {
    await handle.db.delete(activityEvents);
    await handle.db.delete(payments);
    await handle.db.delete(expensePayers);
    await handle.db.delete(splitLines);
    await handle.db.delete(expenses);
    await handle.db.delete(memberships);
    await handle.db.delete(sessions);
    await handle.db.delete(groups);
    await handle.db.delete(users);
  });
  jar.entries.clear();
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(paymentSubject).mockReset();
  vi.mocked(paymentSubject).mockImplementation(paymentSubjectBox.real);

  adaId = await createAccount('ada@example.co', 'Ada');
  boId = await createAccount('bo@example.co', 'Bo');
  cyId = await createAccount('cy@example.co', 'Cy');
});

describe('migration 0005', () => {
  it('is part of the shipped set and applies cleanly', async () => {
    const shipped = await listMigrationFiles();

    expect(shipped).toContain('0005_payments.sql');
    expect(await withDb((handle) => runMigrations(handle.db))).toEqual([]);
  });
});

describe('createPayment', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedGroup();
    await signInAs(adaId);
  });

  it('records the payment and the feed row that says so, in one save', async () => {
    const url = await redirectUrl(
      createPayment(
        IDLE_PAYMENT_STATE,
        paymentForm({
          groupId: fixture.groupId,
          fromMembershipId: fixture.bo,
          toMembershipId: fixture.ada,
          amount: '10.00',
        }),
      ),
    );

    // The success is a navigation, not a returned state: the row it was recorded from leaves the
    // list, so the confirmation rides the group page's query with the pair it is about (AC-6).
    expect(url).toBe(paymentNoticeUrl(fixture.groupId, PAYMENT_RECORDED, fixture.bo, fixture.ada));

    const [payment] = await paymentRows(fixture.groupId);
    expect(payment).toMatchObject({
      groupId: fixture.groupId,
      fromMembershipId: fixture.bo,
      fromDisplayName: 'Bo',
      toMembershipId: fixture.ada,
      toDisplayName: 'Ada',
      amountMinor: 1000,
    });

    const [event] = await eventsOf(fixture.groupId);
    expect(event).toMatchObject({
      actorUserId: adaId,
      kind: 'payment-created',
      subjectName: 'Bo paid Ada',
      paymentId: payment.id,
      payload: {
        amountMinor: 1000,
        fromMembershipId: fixture.bo,
        fromDisplayName: 'Bo',
        toMembershipId: fixture.ada,
        toDisplayName: 'Ada',
      },
    });

    // Both screens show the number this moved, and the card the form lives on is on the group
    // page: the refresh has to reach them or the balance beside the button would be stale. The
    // cross-group feed is on the list for the same reason at one remove — the row asserted above
    // is what it renders, and a feed a write behind is the record disagreeing with the ledger.
    expect(revalidatePath).toHaveBeenCalledWith('/');
    expect(revalidatePath).toHaveBeenCalledWith(`/groups/${fixture.groupId}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/groups/${fixture.groupId}/members`);
    expect(revalidatePath).toHaveBeenCalledWith('/activity');
  });

  it('moves both seats towards zero, which is the whole point of recording one', async () => {
    await recordDinner(fixture);
    await signInAs(boId);

    await redirectUrl(
      createPayment(
        IDLE_PAYMENT_STATE,
        paymentForm({
          groupId: fixture.groupId,
          fromMembershipId: fixture.bo,
          toMembershipId: fixture.ada,
          amount: '10.00',
        }),
      ),
    );

    const nets = await netsOf(fixture.groupId);
    expect(nets.get(fixture.ada)).toBe(1000);
    expect(nets.get(fixture.bo)).toBe(0);
    expect(nets.get(fixture.cy)).toBe(-1000);
  });

  it('accepts a partial amount and leaves the rest outstanding', async () => {
    await recordDinner(fixture);
    await signInAs(boId);

    const url = await redirectUrl(
      createPayment(
        IDLE_PAYMENT_STATE,
        paymentForm({
          groupId: fixture.groupId,
          fromMembershipId: fixture.bo,
          toMembershipId: fixture.ada,
          amount: '4.00',
        }),
      ),
    );

    // A partial payment is still a success: the notice names the pair and the page reads the
    // remainder back off the shrunken suggestion.
    expect(url).toBe(paymentNoticeUrl(fixture.groupId, PAYMENT_RECORDED, fixture.bo, fixture.ada));
    const nets = await netsOf(fixture.groupId);
    expect(nets.get(fixture.bo)).toBe(-600);
    expect(nets.get(fixture.ada)).toBe(1600);
  });

  it('refuses a signed-out caller without writing anything', async () => {
    jar.entries.clear();

    const state = await createPayment(
      IDLE_PAYMENT_STATE,
      paymentForm({
        groupId: fixture.groupId,
        fromMembershipId: fixture.bo,
        toMembershipId: fixture.ada,
        amount: '10.00',
      }),
    );

    expect(state).toMatchObject({ status: 'error', message: UNAUTHENTICATED_MESSAGE });
    expect(await paymentRows(fixture.groupId)).toHaveLength(0);
    expect(await eventsOf(fixture.groupId)).toHaveLength(0);
  });

  it('answers a stranger, a missing group and a malformed id identically', async () => {
    await signInAs(cyId);
    const stranger = await createPayment(
      IDLE_PAYMENT_STATE,
      paymentForm({
        groupId: fixture.otherGroupId,
        fromMembershipId: fixture.otherSeat,
        toMembershipId: fixture.otherSeat,
        amount: '10.00',
      }),
    );

    await signInAs(adaId);
    const missing = await createPayment(
      IDLE_PAYMENT_STATE,
      paymentForm({
        groupId: NO_SUCH_ID,
        fromMembershipId: fixture.bo,
        toMembershipId: fixture.ada,
        amount: '10.00',
      }),
    );
    const malformed = await createPayment(
      IDLE_PAYMENT_STATE,
      paymentForm({
        groupId: MALFORMED,
        fromMembershipId: fixture.bo,
        toMembershipId: fixture.ada,
        amount: '10.00',
      }),
    );

    // One refusal for all three, carrying nothing but the sentence: the caller cannot tell a
    // group that is not there from one that is not theirs, and neither can a prober.
    expect(stranger).toEqual(missing);
    expect(malformed).toEqual(missing);
    expect(missing.message).toBe(GROUP_NOT_FOUND_MESSAGE);
    expect(JSON.stringify(missing)).not.toContain('Goa');
  });

  it('refuses an endpoint from another group the same way it refuses a missing group', async () => {
    const state = await createPayment(
      IDLE_PAYMENT_STATE,
      paymentForm({
        groupId: fixture.groupId,
        fromMembershipId: fixture.bo,
        toMembershipId: fixture.otherSeat,
        amount: '10.00',
      }),
    );

    // The id exists — in the caller's *other* group — and that is exactly what must not show:
    // it is answered as if it were nowhere at all, and nothing is written.
    expect(state).toMatchObject({ status: 'error', message: GROUP_NOT_FOUND_MESSAGE });
    expect(await paymentRows(fixture.groupId)).toHaveLength(0);
  });

  it('refuses a payment that moves nothing, from a seat to itself', async () => {
    const state = await createPayment(
      IDLE_PAYMENT_STATE,
      paymentForm({
        groupId: fixture.groupId,
        fromMembershipId: fixture.bo,
        toMembershipId: fixture.bo,
        amount: '10.00',
      }),
    );

    expect(state).toMatchObject({ status: 'error', message: PAYMENT_SAME_MEMBER_MESSAGE });
    expect(await paymentRows(fixture.groupId)).toHaveLength(0);
  });

  it('refuses an amount that is not a number, or not more than zero, or out of range', async () => {
    const submit = (amount: string) =>
      createPayment(
        IDLE_PAYMENT_STATE,
        paymentForm({
          groupId: fixture.groupId,
          fromMembershipId: fixture.bo,
          toMembershipId: fixture.ada,
          amount,
        }),
      );

    expect((await submit('ten')).message).toBe(PAYMENT_AMOUNT_INVALID_MESSAGE);
    expect((await submit('0')).message).toBe(PAYMENT_AMOUNT_POSITIVE_MESSAGE);
    expect((await submit('-1')).message).toBe(PAYMENT_AMOUNT_INVALID_MESSAGE);
    expect((await submit('99999999999.00')).message).toBe(PAYMENT_AMOUNT_TOO_LARGE_MESSAGE);
    expect(await paymentRows(fixture.groupId)).toHaveLength(0);
  });

  it('refreshes nothing when it refuses, because nothing moved', async () => {
    const refused = await createPayment(
      IDLE_PAYMENT_STATE,
      paymentForm({
        groupId: fixture.groupId,
        fromMembershipId: fixture.bo,
        toMembershipId: fixture.ada,
        amount: 'ten',
      }),
    );

    // A rejected amount wrote no ledger row, so there is no balance to drop out of any cache. Home
    // and the cross-group feed are left alone rather than refetched for a reader who is still
    // looking at the sheet they typed in — the only outcomes that refresh are the ones with a
    // group to name, and this one has none.
    expect(refused).toMatchObject({ status: 'error', message: PAYMENT_AMOUNT_INVALID_MESSAGE });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses to change an archived group', async () => {
    const archived = await seedGroup({ archived: true });
    await signInAs(adaId);

    const state = await createPayment(
      IDLE_PAYMENT_STATE,
      paymentForm({
        groupId: archived.groupId,
        fromMembershipId: archived.bo,
        toMembershipId: archived.ada,
        amount: '10.00',
      }),
    );

    expect(state).toMatchObject({ status: 'error', message: ARCHIVED_GROUP_MESSAGE });
    expect(await paymentRows(archived.groupId)).toHaveLength(0);
  });

  it('clears what a departed seat owes, so a group with a deleted seat still reaches zero', async () => {
    await recordDinner(fixture);
    // Bo leaves with their seat still in the ledger — the ADR-0007 state a removal produces.
    await withDb((handle) => handle.db.delete(memberships).where(eq(memberships.id, fixture.bo)));

    const url = await redirectUrl(
      createPayment(
        IDLE_PAYMENT_STATE,
        paymentForm({
          groupId: fixture.groupId,
          fromMembershipId: fixture.bo,
          toMembershipId: fixture.ada,
          amount: '10.00',
        }),
      ),
    );

    // A seat that is gone is still a seat this group's notice can name: the redirect carries its
    // id like any other, and the page's seat check reads it off the ledger map that keeps it.
    expect(url).toBe(paymentNoticeUrl(fixture.groupId, PAYMENT_RECORDED, fixture.bo, fixture.ada));

    // The payment snapshots the name the ledger kept for a seat that is no longer there, and it
    // settles the seat's debt: Bo is square even though Bo is gone.
    const [payment] = await paymentRows(fixture.groupId);
    expect(payment).toMatchObject({ fromMembershipId: fixture.bo, fromDisplayName: 'Bo' });
    expect((await netsOf(fixture.groupId)).get(fixture.bo)).toBe(0);

    // And the group is still settleable to all-zero: Cy's share is the only thing left, and the
    // money that cleared the departed seat did not strand itself anywhere.
    await redirectUrl(
      createPayment(
        IDLE_PAYMENT_STATE,
        paymentForm({
          groupId: fixture.groupId,
          fromMembershipId: fixture.cy,
          toMembershipId: fixture.ada,
          amount: '10.00',
        }),
      ),
    );

    const nets = await netsOf(fixture.groupId);
    expect([...nets.values()].every((net) => net === 0)).toBe(true);
  });

  it('refuses a payment between two departed seats without writing anything', async () => {
    await recordDinner(fixture);
    // Both ends leave, keeping their ledger rows: to the balances map they are still participants,
    // which is exactly why the endpoint check alone let this through.
    await withDb(async (handle) => {
      await handle.db.delete(memberships).where(eq(memberships.id, fixture.bo));
      await handle.db.delete(memberships).where(eq(memberships.id, fixture.cy));
    });

    const state = await createPayment(
      IDLE_PAYMENT_STATE,
      paymentForm({
        groupId: fixture.groupId,
        fromMembershipId: fixture.bo,
        toMembershipId: fixture.cy,
        amount: '10.00',
      }),
    );

    // Nobody is left who could ever delete it — the delete rule needs one endpoint to still be a
    // current member — so the write is refused rather than recorded undeletable.
    expect(state).toMatchObject({ status: 'error', message: PAYMENT_BOTH_DEPARTED_MESSAGE });
    expect(await paymentRows(fixture.groupId)).toHaveLength(0);
    expect(await eventsOf(fixture.groupId)).toHaveLength(0);
  });

  it('leaves no payment and no activity row when the write fails part-way through', async () => {
    vi.mocked(paymentSubject).mockImplementationOnce(() => {
      throw new Error('the write failed after the payment was inserted');
    });

    await expect(
      createPayment(
        IDLE_PAYMENT_STATE,
        paymentForm({
          groupId: fixture.groupId,
          fromMembershipId: fixture.bo,
          toMembershipId: fixture.ada,
          amount: '10.00',
        }),
      ),
    ).rejects.toThrow('the write failed after the payment was inserted');

    // The payment row was written before the failure: the transaction is what takes it back.
    expect(await paymentRows(fixture.groupId)).toHaveLength(0);
    expect(await eventsOf(fixture.groupId)).toHaveLength(0);
  });
});

describe('deletePayment', () => {
  let fixture: Fixture;

  /** A recorded payment: Bo pays Ada 10. Returns its id. */
  async function recordPayment(): Promise<string> {
    await signInAs(adaId);
    await redirectUrl(
      createPayment(
        IDLE_PAYMENT_STATE,
        paymentForm({
          groupId: fixture.groupId,
          fromMembershipId: fixture.bo,
          toMembershipId: fixture.ada,
          amount: '10.00',
        }),
      ),
    );

    const [payment] = await paymentRows(fixture.groupId);
    return payment.id;
  }

  beforeEach(async () => {
    fixture = await seedGroup();
  });

  it('deletes for the payer, and the feed row outlives the payment it describes', async () => {
    const paymentId = await recordPayment();
    await signInAs(boId);

    const url = await redirectUrl(
      deletePayment(IDLE_PAYMENT_STATE, paymentForm({ groupId: fixture.groupId, paymentId })),
    );

    // The deleted row leaves the list, so this success navigates too, naming the pair the
    // deletion was about.
    expect(url).toBe(paymentNoticeUrl(fixture.groupId, PAYMENT_DELETED, fixture.bo, fixture.ada));
    expect(await paymentRows(fixture.groupId)).toHaveLength(0);

    const events = await eventsOf(fixture.groupId);
    const deleted = events.find((event) => event.kind === 'payment-deleted');

    // This is what AC-7 is about: the payment is gone, the link back to it is null, and the
    // snapshot is what a feed still has to render.
    expect(deleted).toMatchObject({
      actorUserId: boId,
      paymentId: null,
      payload: {
        amountMinor: 1000,
        fromDisplayName: 'Bo',
        toDisplayName: 'Ada',
        fromMembershipId: fixture.bo,
        toMembershipId: fixture.ada,
      },
    });
  });

  it('deletes for the recipient too', async () => {
    const paymentId = await recordPayment();
    await signInAs(adaId);

    const url = await redirectUrl(
      deletePayment(IDLE_PAYMENT_STATE, paymentForm({ groupId: fixture.groupId, paymentId })),
    );

    expect(url).toBe(paymentNoticeUrl(fixture.groupId, PAYMENT_DELETED, fixture.bo, fixture.ada));
    expect(await paymentRows(fixture.groupId)).toHaveLength(0);
  });

  it('puts the balance back when a payment is deleted', async () => {
    await recordDinner(fixture);
    const paymentId = await recordPayment();
    await signInAs(boId);

    await redirectUrl(
      deletePayment(IDLE_PAYMENT_STATE, paymentForm({ groupId: fixture.groupId, paymentId })),
    );

    const nets = await netsOf(fixture.groupId);
    expect(nets.get(fixture.ada)).toBe(2000);
    expect(nets.get(fixture.bo)).toBe(-1000);
  });

  it('refuses a member the payment does not involve, exactly as it refuses a payment that is not there', async () => {
    const paymentId = await recordPayment();
    await signInAs(cyId);
    // Recording it above was a write and did refresh; what is under test here is only what the
    // refusals below do, so the setup's own revalidations are dropped from the count.
    vi.mocked(revalidatePath).mockClear();

    const notInvolved = await deletePayment(
      IDLE_PAYMENT_STATE,
      paymentForm({ groupId: fixture.groupId, paymentId }),
    );
    const unknown = await deletePayment(
      IDLE_PAYMENT_STATE,
      paymentForm({ groupId: fixture.groupId, paymentId: NO_SUCH_ID }),
    );
    const malformed = await deletePayment(
      IDLE_PAYMENT_STATE,
      paymentForm({ groupId: fixture.groupId, paymentId: MALFORMED }),
    );

    // To Cy, a payment between two other people is one that does not exist — and the answer says
    // the same thing either way, so it cannot be used to find out that it does.
    expect(notInvolved.message).toBe(PAYMENT_NOT_FOUND_MESSAGE);
    expect(unknown).toEqual(notInvolved);
    expect(malformed).toEqual(notInvolved);
    expect(await paymentRows(fixture.groupId)).toHaveLength(1);

    // Three refusals, and not one of them touched the ledger — so not one of them refreshes a
    // balance cache either. This is the settle path's half of the same rule the recorded delete
    // above depends on: the refresh follows the write, never the attempt.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses a signed-out caller and a stranger without deleting anything', async () => {
    const paymentId = await recordPayment();

    jar.entries.clear();
    const signedOut = await deletePayment(
      IDLE_PAYMENT_STATE,
      paymentForm({ groupId: fixture.groupId, paymentId }),
    );

    await signInAs(cyId);
    const stranger = await deletePayment(
      IDLE_PAYMENT_STATE,
      paymentForm({ groupId: fixture.otherGroupId, paymentId }),
    );

    expect(signedOut).toMatchObject({ status: 'error', message: UNAUTHENTICATED_MESSAGE });
    expect(stranger).toMatchObject({ status: 'error', message: GROUP_NOT_FOUND_MESSAGE });
    expect(await paymentRows(fixture.groupId)).toHaveLength(1);
  });

  it('refuses to change an archived group', async () => {
    // Record while the group is open, then archive it: the payment is still readable and still
    // not deletable, which is what an archived group means.
    const paymentId = await recordPayment();
    await withDb((handle) =>
      handle.db.update(groups).set({ archived: true }).where(eq(groups.id, fixture.groupId)),
    );
    await signInAs(boId);

    const state = await deletePayment(
      IDLE_PAYMENT_STATE,
      paymentForm({ groupId: fixture.groupId, paymentId }),
    );

    expect(state).toMatchObject({ status: 'error', message: ARCHIVED_GROUP_MESSAGE });
    expect(await paymentRows(fixture.groupId)).toHaveLength(1);
  });

  it('deletes a departed seat’s payment through the involved member, and refuses a third one', async () => {
    await recordDinner(fixture);
    // Bo pays Ada 10 and then leaves; the payment names a seat that no longer exists.
    const paymentId = await recordPayment();
    await withDb((handle) => handle.db.delete(memberships).where(eq(memberships.id, fixture.bo)));

    await signInAs(cyId);
    const third = await deletePayment(
      IDLE_PAYMENT_STATE,
      paymentForm({ groupId: fixture.groupId, paymentId }),
    );

    // Ada is the other end of it, and the only person left who was there.
    await signInAs(adaId);
    const involved = await redirectUrl(
      deletePayment(IDLE_PAYMENT_STATE, paymentForm({ groupId: fixture.groupId, paymentId })),
    );

    expect(third).toMatchObject({ status: 'error', message: PAYMENT_NOT_FOUND_MESSAGE });
    expect(involved).toBe(
      paymentNoticeUrl(fixture.groupId, PAYMENT_DELETED, fixture.bo, fixture.ada),
    );
    expect(await paymentRows(fixture.groupId)).toHaveLength(0);
  });
});
