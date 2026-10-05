import { asc, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The expense writes, driven the way the editor drives them: `next/headers` is a cookie jar this
 * test owns, so session → guard → boundary → transaction runs for real against the embedded
 * database. Only the browser is missing.
 *
 * One module is mocked, and only to reach a state a passing run cannot: the money core, so a
 * write can be made to fail in the middle of its own transaction. That is what proves the
 * transaction is there — a failing write must leave no expense, no payer, no split line and no
 * feed row behind it, and a mock is how a test arranges "failing" without breaking the schema on
 * purpose.
 */

const jar = vi.hoisted(() => ({ entries: new Map<string, string>() }));

const redirected = vi.hoisted(() => {
  class Redirected extends Error {
    constructor(readonly url: string) {
      super(`redirect:${url}`);
      this.name = 'Redirected';
    }
  }
  return { Redirected };
});

const splitBox = vi.hoisted(() => ({
  real: undefined as unknown as typeof import('../money/splits').splitAmount,
}));

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

vi.mock('../money/splits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../money/splits')>();
  splitBox.real = actual.splitAmount;
  return { ...actual, splitAmount: vi.fn(actual.splitAmount) };
});

const { createExpense, deleteExpense, updateExpense } = await import('./actions');
const { getExpenseEditorData, listExpenses, loadExpense } = await import('./queries');
const { splitAmount } = await import('../money/splits');
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
  EXPENSE_ADDED,
  EXPENSE_DELETED,
  EXPENSE_NOT_FOUND_MESSAGE,
  EXPENSE_UPDATED,
  IDLE_EXPENSE_STATE,
  UNKNOWN_MEMBER_MESSAGE,
} = await import('./validation');
// A type-only import, beside the awaited ones: it is erased before the module runs, so it has no
// bearing on when the mocked modules above are built, and the filter shape is all this file wants.
import type { ExpenseFilters } from './validation';

const PASSWORD = 'correct horse battery staple';
const NOTE = 'the long way round';
const NO_SUCH_ID = '44444444-4444-4444-8444-444444444444';
const NO_FILTERS: ExpenseFilters = { memberId: null, category: null, search: null };

let passwordHash: string;
let adaId: string;
let boId: string;
let cyId: string;
const accountNames = new Map<string, string>();

async function createAccount(email: string, displayName: string): Promise<string> {
  const [user] = await withDb((handle) =>
    handle.db
      .insert(users)
      .values({ email, passwordHash, displayName })
      .returning({ id: users.id }),
  );
  accountNames.set(user.id, displayName);
  return user.id;
}

async function signInAs(userId: string): Promise<void> {
  const { token } = await withDb((handle) => mintSession(handle.db, userId));
  jar.entries.set(SESSION_COOKIE, token);
}

interface FormSpec {
  groupId: string;
  expenseId?: string;
  description?: string;
  amount?: string;
  date?: string;
  category?: string;
  note?: string;
  splitType?: string;
  payers?: Array<{ membershipId: string; amount: string }>;
  splits?: Array<{ membershipId: string; included?: boolean; value?: string }>;
}

/** A submitted expense, encoded the way the editor encodes one. */
function expenseForm(spec: FormSpec): FormData {
  const data = new FormData();
  data.set('groupId', spec.groupId);
  if (spec.expenseId !== undefined) data.set('expenseId', spec.expenseId);
  if (spec.description !== undefined) data.set('description', spec.description);
  if (spec.amount !== undefined) data.set('amount', spec.amount);
  if (spec.date !== undefined) data.set('date', spec.date);
  if (spec.category !== undefined) data.set('category', spec.category);
  if (spec.note !== undefined) data.set('note', spec.note);
  if (spec.splitType !== undefined) data.set('splitType', spec.splitType);

  (spec.payers ?? []).forEach((payer, index) => {
    data.set(`payer.${index}.membershipId`, payer.membershipId);
    data.set(`payer.${index}.amount`, payer.amount);
  });

  (spec.splits ?? []).forEach((split, index) => {
    data.set(`split.${index}.membershipId`, split.membershipId);
    if (split.included) data.set(`split.${index}.included`, '1');
    if (split.value !== undefined) data.set(`split.${index}.value`, split.value);
  });

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

interface Fixture {
  groupId: string;
  ada: string;
  bo: string;
  cy: string;
}

/**
 * A group written straight to the database, its members in a stated order.
 *
 * The join times are pinned rather than left to the clock: `listMembers` reads oldest first and
 * members inserted in one transaction share a timestamp, so without this the order the editor
 * renders rows in — and every assertion about it — would depend on which random uuid sorts first.
 */
async function seedGroup(
  name = 'Goa trip',
  options: { archived?: boolean; members?: Array<string | null> } = {},
): Promise<Fixture> {
  const memberIds = options.members ?? [adaId, boId, cyId];
  const joinedAt = Date.parse('2026-01-01T00:00:00Z');

  return withDb(async (handle) => {
    const [group] = await handle.db
      .insert(groups)
      .values({
        name,
        currency: 'INR',
        type: 'trip',
        inviteToken: randomToken(),
        archived: options.archived ?? false,
      })
      .returning();

    const seats: string[] = [];
    for (const [index, userId] of memberIds.entries()) {
      const [membership] = await handle.db
        .insert(memberships)
        .values({
          groupId: group.id,
          userId,
          displayName:
            userId === null ? `Seat ${index}` : accountNames.get(userId) ?? `Member ${index}`,
          role: index === 0 ? 'owner' : 'member',
          createdAt: new Date(joinedAt + index * 60_000),
        })
        .returning({ id: memberships.id });
      seats.push(membership.id);
    }

    return { groupId: group.id, ada: seats[0], bo: seats[1], cy: seats[2] };
  });
}

async function expenseRowsOf(groupId: string) {
  return withDb((handle) => handle.db.select().from(expenses).where(eq(expenses.groupId, groupId)));
}

async function allPayers() {
  return withDb((handle) => handle.db.select().from(expensePayers));
}

async function allSplits() {
  return withDb((handle) => handle.db.select().from(splitLines));
}

async function payersOf(expenseId: string) {
  return withDb((handle) =>
    handle.db
      .select()
      .from(expensePayers)
      .where(eq(expensePayers.expenseId, expenseId))
      .orderBy(asc(expensePayers.position)),
  );
}

async function splitsOf(expenseId: string) {
  return withDb((handle) =>
    handle.db
      .select()
      .from(splitLines)
      .where(eq(splitLines.expenseId, expenseId))
      .orderBy(asc(splitLines.displayName)),
  );
}

async function eventsOf(groupId: string) {
  return withDb((handle) =>
    handle.db.select().from(activityEvents).where(eq(activityEvents.groupId, groupId)),
  );
}

/** The single expense in a group, for a test that has only just created one. */
async function onlyExpense(groupId: string) {
  const rows = await expenseRowsOf(groupId);
  expect(rows).toHaveLength(1);
  return rows[0];
}

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-session-secret';
  passwordHash = await hashPassword(PASSWORD);
  await withDb((handle) => runMigrations(handle.db));
});

beforeEach(async () => {
  await withDb(async (handle) => {
    await handle.db.delete(activityEvents);
    await handle.db.delete(expensePayers);
    await handle.db.delete(splitLines);
    await handle.db.delete(expenses);
    await handle.db.delete(memberships);
    await handle.db.delete(sessions);
    await handle.db.delete(groups);
    await handle.db.delete(users);
  });
  jar.entries.clear();
  accountNames.clear();

  vi.mocked(splitAmount).mockReset();
  vi.mocked(splitAmount).mockImplementation(splitBox.real);

  adaId = await createAccount('ada@example.co', 'Ada');
  boId = await createAccount('bo@example.co', 'Bo');
  cyId = await createAccount('cy@example.co', 'Cy');
});

describe('migration 0004', () => {
  it('is part of the shipped set and applies cleanly', async () => {
    const shipped = await listMigrationFiles();

    expect(shipped).toContain('0004_expenses.sql');
    expect(await withDb((handle) => runMigrations(handle.db))).toEqual([]);
  });
});

describe('createExpense', () => {
  let groupId: string;
  let ada: string;
  let bo: string;
  let cy: string;

  beforeEach(async () => {
    ({ groupId, ada, bo, cy } = await seedGroup());
    await signInAs(adaId);
  });

  it('records the expense, who paid and who owes, and the feed row, in one save', async () => {
    const url = await redirectUrl(
      createExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({
          groupId,
          description: 'Dinner',
          amount: '10.00',
          date: '2026-10-05',
          category: 'food',
          note: NOTE,
          splitType: 'equal',
          payers: [{ membershipId: ada, amount: '10.00' }],
          splits: [
            { membershipId: ada, included: true },
            { membershipId: bo, included: true },
          ],
        }),
      ),
    );

    // The form is unmounted by the save and the list is what the caller needs to see, so the
    // confirmation rides the group page's query (AC-6). Spelled out here because it is the
    // contract between this action and the page that reads it.
    expect(url).toBe(`/groups/${groupId}?expense=${EXPENSE_ADDED}`);

    const expense = await onlyExpense(groupId);
    expect(expense).toMatchObject({
      description: 'Dinner',
      amountMinor: 1000,
      date: '2026-10-05',
      category: 'food',
      note: NOTE,
      splitType: 'equal',
    });

    expect(await payersOf(expense.id)).toEqual([
      expect.objectContaining({
        membershipId: ada,
        displayName: 'Ada',
        amountMinor: 1000,
        position: 0,
      }),
    ]);

    expect(await splitsOf(expense.id)).toEqual([
      expect.objectContaining({
        membershipId: ada,
        displayName: 'Ada',
        included: true,
        inputValue: null,
        shareMinor: 500,
      }),
      expect.objectContaining({
        membershipId: bo,
        displayName: 'Bo',
        included: true,
        inputValue: null,
        shareMinor: 500,
      }),
    ]);

    const events = await eventsOf(groupId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'expense-created',
      actorUserId: adaId,
      subjectName: 'Dinner',
      expenseId: expense.id,
      payload: null,
    });
  });

  it('puts the rounding remainder on the first payer', async () => {
    await redirectUrl(
      createExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({
          groupId,
          description: 'Petrol',
          amount: '10.00',
          date: '2026-10-05',
          payers: [{ membershipId: bo, amount: '10.00' }],
          splits: [
            { membershipId: ada, included: true },
            { membershipId: bo, included: true },
            { membershipId: cy, included: true },
          ],
        }),
      ),
    );

    const byMember = new Map(
      (await splitsOf((await onlyExpense(groupId)).id)).map((split) => [
        split.membershipId,
        split.shareMinor,
      ]),
    );

    // 333.33… each, and the paisa that will not divide lands on the member who paid.
    expect(byMember.get(bo)).toBe(334);
    expect(byMember.get(ada)).toBe(333);
    expect(byMember.get(cy)).toBe(333);
    expect([...byMember.values()].reduce((total, share) => total + share, 0)).toBe(1000);
  });

  it('sums several payer parts, keeping the order they were entered in', async () => {
    await redirectUrl(
      createExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({
          groupId,
          description: 'Cab',
          amount: '10.00',
          date: '2026-10-04',
          payers: [
            { membershipId: bo, amount: '6.00' },
            { membershipId: ada, amount: '4.00' },
          ],
          splits: [
            { membershipId: ada, included: true },
            { membershipId: bo, included: true },
          ],
        }),
      ),
    );

    const payers = await payersOf((await onlyExpense(groupId)).id);

    expect(payers.map((payer) => [payer.displayName, payer.amountMinor, payer.position])).toEqual([
      ['Bo', 600, 0],
      ['Ada', 400, 1],
    ]);
  });

  it('refuses payer parts that do not add up, naming the shortfall and its size', async () => {
    const state = await createExpense(
      IDLE_EXPENSE_STATE,
      expenseForm({
        groupId,
        description: 'Dinner',
        amount: '5.00',
        date: '2026-10-05',
        payers: [
          { membershipId: ada, amount: '3.00' },
          { membershipId: bo, amount: '1.50' },
        ],
        splits: [{ membershipId: ada, included: true }],
      }),
    );

    expect(state.status).toBe('error');
    const sentence = state.fieldErrors?.payers as string;
    expect(sentence).toContain('4.50');
    expect(sentence).toContain('0.50');
    expect(sentence).toContain('5.00');

    // Nothing half-written: no expense, no payer, no split line, no feed row.
    expect(await expenseRowsOf(groupId)).toHaveLength(0);
    expect(await allPayers()).toHaveLength(0);
    expect(await allSplits()).toHaveLength(0);
    expect(await eventsOf(groupId)).toHaveLength(0);
  });

  it('stores an exact split as the amounts that were typed', async () => {
    await redirectUrl(
      createExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({
          groupId,
          description: 'Groceries',
          amount: '5.00',
          date: '2026-10-02',
          splitType: 'exact',
          payers: [{ membershipId: ada, amount: '5.00' }],
          splits: [
            { membershipId: ada, included: true, value: '3.00' },
            { membershipId: bo, included: true, value: '2.00' },
          ],
        }),
      ),
    );

    const byMember = new Map(
      (await splitsOf((await onlyExpense(groupId)).id)).map((split) => [split.membershipId, split]),
    );

    expect(byMember.get(ada)).toMatchObject({ inputValue: 300, shareMinor: 300 });
    expect(byMember.get(bo)).toMatchObject({ inputValue: 200, shareMinor: 200 });
  });

  it('stores a percentage as basis points beside the share they compute to', async () => {
    await redirectUrl(
      createExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({
          groupId,
          description: 'Hotel',
          amount: '10.00',
          date: '2026-10-03',
          splitType: 'percentage',
          payers: [{ membershipId: ada, amount: '10.00' }],
          splits: [
            { membershipId: ada, included: true, value: '60' },
            { membershipId: bo, included: true, value: '40' },
          ],
        }),
      ),
    );

    const byMember = new Map(
      (await splitsOf((await onlyExpense(groupId)).id)).map((split) => [split.membershipId, split]),
    );

    expect(byMember.get(ada)).toMatchObject({ inputValue: 6000, shareMinor: 600 });
    expect(byMember.get(bo)).toMatchObject({ inputValue: 4000, shareMinor: 400 });
  });

  it('divides a share split in proportion, remainder and all', async () => {
    await redirectUrl(
      createExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({
          groupId,
          description: 'Hotel',
          amount: '10.00',
          date: '2026-10-03',
          splitType: 'shares',
          payers: [{ membershipId: ada, amount: '10.00' }],
          splits: [
            { membershipId: ada, included: true, value: '2' },
            { membershipId: bo, included: true, value: '1' },
          ],
        }),
      ),
    );

    const byMember = new Map(
      (await splitsOf((await onlyExpense(groupId)).id)).map((split) => [split.membershipId, split]),
    );

    expect(byMember.get(ada)).toMatchObject({ inputValue: 2, shareMinor: 667 });
    expect(byMember.get(bo)).toMatchObject({ inputValue: 1, shareMinor: 333 });
  });

  it('keeps a member who was left out at zero rather than charging them', async () => {
    await redirectUrl(
      createExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({
          groupId,
          description: 'Cinema',
          amount: '10.00',
          date: '2026-10-01',
          payers: [{ membershipId: ada, amount: '10.00' }],
          splits: [
            { membershipId: ada, included: true },
            { membershipId: bo, included: true },
            { membershipId: cy, included: false, value: '4.00' },
          ],
        }),
      ),
    );

    const splits = await splitsOf((await onlyExpense(groupId)).id);

    expect(splits.find((split) => split.membershipId === cy)).toMatchObject({
      included: false,
      shareMinor: 0,
    });
    // The whole is still the whole: a member left out does not leave part of the expense owing
    // to nobody.
    expect(splits.reduce((total, split) => total + split.shareMinor, 0)).toBe(1000);
  });

  it('refuses a signed-out caller and writes nothing', async () => {
    jar.entries.clear();

    const state = await createExpense(
      IDLE_EXPENSE_STATE,
      expenseForm({
        groupId,
        description: 'Sneaky',
        amount: '10.00',
        date: '2026-10-05',
        payers: [{ membershipId: ada, amount: '10.00' }],
        splits: [{ membershipId: ada, included: true }],
      }),
    );

    expect(state).toEqual({ status: 'error', message: UNAUTHENTICATED_MESSAGE });
    expect(await expenseRowsOf(groupId)).toHaveLength(0);
  });

  it('answers a stranger the same way for a group that exists and one that does not', async () => {
    // Somebody signed in who is in no group at all.
    await signInAs(await createAccount('dee@example.co', 'Dee'));

    const stranger = await createExpense(
      IDLE_EXPENSE_STATE,
      expenseForm({
        groupId,
        description: 'Peeking',
        amount: '10.00',
        date: '2026-10-05',
        payers: [{ membershipId: ada, amount: '10.00' }],
        splits: [{ membershipId: ada, included: true }],
      }),
    );
    const invented = await createExpense(
      IDLE_EXPENSE_STATE,
      expenseForm({
        groupId: NO_SUCH_ID,
        description: 'Peeking',
        amount: '10.00',
        date: '2026-10-05',
        payers: [{ membershipId: ada, amount: '10.00' }],
        splits: [{ membershipId: ada, included: true }],
      }),
    );

    // A group somebody else is in and a group that has never existed are one answer, because the
    // guard cannot tell them apart and neither can the caller (TR-3).
    expect(stranger).toEqual({ status: 'error', message: GROUP_NOT_FOUND_MESSAGE });
    expect(invented).toEqual(stranger);
    expect(await expenseRowsOf(groupId)).toHaveLength(0);
    expect(await eventsOf(groupId)).toHaveLength(0);
  });

  it('refuses a membership id that is not in this group', async () => {
    const other = await seedGroup('Somebody else', { members: [boId] });

    const state = await createExpense(
      IDLE_EXPENSE_STATE,
      expenseForm({
        groupId,
        description: 'Dinner',
        amount: '10.00',
        date: '2026-10-05',
        payers: [{ membershipId: other.ada, amount: '10.00' }],
        splits: [{ membershipId: ada, included: true }],
      }),
    );

    // A seat in another group is not a member here, and the save is refused whole rather than
    // writing a payer nobody can name.
    expect(state).toEqual({ status: 'error', message: UNKNOWN_MEMBER_MESSAGE });
    expect(await expenseRowsOf(groupId)).toHaveLength(0);
    expect(await allPayers()).toHaveLength(0);
  });

  it('refuses an archived group', async () => {
    const archived = await seedGroup('Old trip', { archived: true });

    const state = await createExpense(
      IDLE_EXPENSE_STATE,
      expenseForm({
        groupId: archived.groupId,
        description: 'Dinner',
        amount: '10.00',
        date: '2026-10-05',
        payers: [{ membershipId: archived.ada, amount: '10.00' }],
        splits: [{ membershipId: archived.ada, included: true }],
      }),
    );

    expect(state).toEqual({ status: 'error', message: ARCHIVED_GROUP_MESSAGE });
    expect(await expenseRowsOf(archived.groupId)).toHaveLength(0);
  });

  it('leaves nothing behind when the write fails part-way through', async () => {
    vi.mocked(splitAmount).mockImplementationOnce(() => {
      throw new Error('the plan failed after the expense was inserted');
    });

    await expect(
      createExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({
          groupId,
          description: 'Dinner',
          amount: '10.00',
          date: '2026-10-05',
          payers: [{ membershipId: ada, amount: '10.00' }],
          splits: [{ membershipId: ada, included: true }],
        }),
      ),
    ).rejects.toThrow('the plan failed');

    // The expense row was written before the failure: the transaction is what takes it back.
    expect(await expenseRowsOf(groupId)).toHaveLength(0);
    expect(await allPayers()).toHaveLength(0);
    expect(await allSplits()).toHaveLength(0);
    expect(await eventsOf(groupId)).toHaveLength(0);
  });
});

describe('updateExpense', () => {
  let groupId: string;
  let ada: string;
  let bo: string;
  let expenseId: string;

  /** The expense every test in this block edits unless it writes its own. */
  async function create(overrides: Partial<FormSpec> = {}): Promise<void> {
    await redirectUrl(
      createExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({
          groupId,
          description: 'Dinner',
          amount: '10.00',
          date: '2026-10-05',
          category: 'food',
          payers: [{ membershipId: ada, amount: '10.00' }],
          splits: [
            { membershipId: ada, included: true },
            { membershipId: bo, included: true },
          ],
          ...overrides,
        }),
      ),
    );
    expenseId = (await onlyExpense(groupId)).id;
  }

  beforeEach(async () => {
    ({ groupId, ada, bo } = await seedGroup());
    await signInAs(adaId);
    await create();
  });

  it('rewrites the rule in place and records what changed', async () => {
    const url = await redirectUrl(
      updateExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({
          groupId,
          expenseId,
          description: 'Dinner and drinks',
          amount: '20.00',
          date: '2026-10-05',
          category: 'food',
          payers: [{ membershipId: ada, amount: '20.00' }],
          splits: [
            { membershipId: ada, included: true },
            { membershipId: bo, included: true },
          ],
        }),
      ),
    );

    expect(url).toBe(`/groups/${groupId}?expense=${EXPENSE_UPDATED}`);
    expect(await expenseRowsOf(groupId)).toHaveLength(1);

    const expense = await onlyExpense(groupId);
    expect(expense).toMatchObject({ description: 'Dinner and drinks', amountMinor: 2000 });

    // The rows are replaced, not duplicated: one payer and two split lines, at the new amounts.
    const payers = await payersOf(expenseId);
    expect(payers).toHaveLength(1);
    expect(payers[0]).toMatchObject({ amountMinor: 2000, position: 0, displayName: 'Ada' });
    expect((await splitsOf(expenseId)).map((split) => split.shareMinor)).toEqual([1000, 1000]);

    const kinds = (await eventsOf(groupId)).map((event) => event.kind).sort();
    // The create and the edit, and only those two.
    expect(kinds).toEqual(['expense-created', 'expense-edited']);

    const edit = (await eventsOf(groupId)).find((event) => event.kind === 'expense-edited');
    expect(edit).toMatchObject({ subjectName: 'Dinner and drinks', expenseId, actorUserId: adaId });

    // Only what moved. The date, the category and the split type are absent because they did not
    // change, and the feed should not claim they did (TR-10). So is the split itself: an equal
    // split has no input to change, and the new shares follow from the new amount rather than
    // being a rule somebody edited. What moved is the description, the amount, and the part the
    // payer paid towards it.
    expect(edit?.payload).toEqual({
      before: {
        description: 'Dinner',
        amountMinor: 1000,
        payers: [{ membershipId: ada, displayName: 'Ada', amountMinor: 1000 }],
      },
      after: {
        description: 'Dinner and drinks',
        amountMinor: 2000,
        payers: [{ membershipId: ada, displayName: 'Ada', amountMinor: 2000 }],
      },
    });
  });

  it('records the rule that was entered when the split type changes', async () => {
    await redirectUrl(
      updateExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({
          groupId,
          expenseId,
          description: 'Dinner',
          amount: '10.00',
          date: '2026-10-05',
          category: 'food',
          splitType: 'percentage',
          payers: [{ membershipId: ada, amount: '10.00' }],
          splits: [
            { membershipId: ada, included: true, value: '60' },
            { membershipId: bo, included: true, value: '40' },
          ],
        }),
      ),
    );

    const byMember = new Map((await splitsOf(expenseId)).map((split) => [split.membershipId, split]));

    expect(byMember.get(ada)).toMatchObject({ inputValue: 6000, shareMinor: 600 });
    expect(byMember.get(bo)).toMatchObject({ inputValue: 4000, shareMinor: 400 });
    expect((await onlyExpense(groupId)).splitType).toBe('percentage');

    const edit = (await eventsOf(groupId)).find((event) => event.kind === 'expense-edited');
    expect(edit?.payload).toMatchObject({
      before: { splitType: 'equal' },
      after: { splitType: 'percentage' },
    });
  });

  it('writes nothing at all for a save that changes nothing', async () => {
    const url = await redirectUrl(
      updateExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({
          groupId,
          expenseId,
          description: 'Dinner',
          amount: '10.00',
          date: '2026-10-05',
          category: 'food',
          payers: [{ membershipId: ada, amount: '10.00' }],
          splits: [
            { membershipId: ada, included: true },
            { membershipId: bo, included: true },
          ],
        }),
      ),
    );

    expect(url).toBe(`/groups/${groupId}?expense=${EXPENSE_UPDATED}`);
    // Pressing Save twice must not put two "edited" rows in the feed for one edit.
    expect((await eventsOf(groupId)).map((event) => event.kind)).toEqual(['expense-created']);
  });

  it('leaves the remainder where it was when the edit does not move it', async () => {
    const three = await seedGroup('Three ways');
    await redirectUrl(
      createExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({
          groupId: three.groupId,
          description: 'Petrol',
          amount: '10.00',
          date: '2026-10-05',
          payers: [{ membershipId: three.bo, amount: '10.00' }],
          splits: [
            { membershipId: three.ada, included: true },
            { membershipId: three.bo, included: true },
            { membershipId: three.cy, included: true },
          ],
        }),
      ),
    );

    const petrolId = (await onlyExpense(three.groupId)).id;
    const before = new Map(
      (await splitsOf(petrolId)).map((split) => [split.membershipId, split.shareMinor]),
    );
    expect(before.get(three.bo)).toBe(334);

    await redirectUrl(
      updateExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({
          groupId: three.groupId,
          expenseId: petrolId,
          description: 'Petrol and tolls',
          amount: '10.00',
          date: '2026-10-05',
          payers: [{ membershipId: three.bo, amount: '10.00' }],
          splits: [
            { membershipId: three.ada, included: true },
            { membershipId: three.bo, included: true },
            { membershipId: three.cy, included: true },
          ],
        }),
      ),
    );

    const after = new Map(
      (await splitsOf(petrolId)).map((split) => [split.membershipId, split.shareMinor]),
    );

    // The payer order survived the round trip through the form, so the paisa did not move to
    // somebody else's balance on an edit that was about the description.
    expect(after).toEqual(before);
  });

  it('keeps a seat that is no longer a member in the expense, under its snapshot name', async () => {
    // Removing a member does not touch the ledger (ADR-0007), so the row is taken out from under
    // the expense the way a removal would.
    await withDb((handle) => handle.db.delete(memberships).where(eq(memberships.id, bo)));

    await redirectUrl(
      updateExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({
          groupId,
          expenseId,
          description: 'Dinner, renamed',
          amount: '10.00',
          date: '2026-10-05',
          category: 'food',
          payers: [{ membershipId: ada, amount: '10.00' }],
          splits: [
            { membershipId: ada, included: true },
            { membershipId: bo, included: true },
          ],
        }),
      ),
    );

    const removed = (await splitsOf(expenseId)).find((split) => split.membershipId === bo);

    // Still there, still owed, still named as they were: an edit of the description is not a
    // reason to erase half of somebody's balance or move their share onto the others.
    expect(removed).toMatchObject({ displayName: 'Bo', included: true, shareMinor: 500 });
    expect((await onlyExpense(groupId)).description).toBe('Dinner, renamed');
  });

  it('refuses a seat that was never in this group', async () => {
    const other = await seedGroup('Somebody else', { members: [cyId] });

    const state = await updateExpense(
      IDLE_EXPENSE_STATE,
      expenseForm({
        groupId,
        expenseId,
        description: 'Dinner',
        amount: '10.00',
        date: '2026-10-05',
        payers: [{ membershipId: ada, amount: '10.00' }],
        splits: [
          { membershipId: ada, included: true },
          { membershipId: other.ada, included: true },
        ],
      }),
    );

    expect(state).toEqual({ status: 'error', message: UNKNOWN_MEMBER_MESSAGE });
    expect((await splitsOf(expenseId)).map((split) => split.membershipId).sort()).toEqual(
      [ada, bo].sort(),
    );
  });

  it('refuses an expense in another group, and one that does not exist', async () => {
    const other = await seedGroup('Somebody else', { members: [cyId] });
    await signInAs(cyId);

    const stranger = await updateExpense(
      IDLE_EXPENSE_STATE,
      expenseForm({
        groupId: other.groupId,
        expenseId,
        description: 'Taken over',
        amount: '99.00',
        date: '2026-10-05',
        payers: [{ membershipId: other.ada, amount: '99.00' }],
        splits: [{ membershipId: other.ada, included: true }],
      }),
    );
    const invented = await updateExpense(
      IDLE_EXPENSE_STATE,
      expenseForm({
        groupId: other.groupId,
        expenseId: NO_SUCH_ID,
        description: 'Taken over',
        amount: '99.00',
        date: '2026-10-05',
        payers: [{ membershipId: other.ada, amount: '99.00' }],
        splits: [{ membershipId: other.ada, included: true }],
      }),
    );

    expect(stranger).toEqual({ status: 'error', message: EXPENSE_NOT_FOUND_MESSAGE });
    expect(invented).toEqual(stranger);

    // The expense is where it was, at the amount it was, under the name it had.
    await signInAs(adaId);
    expect(await onlyExpense(groupId)).toMatchObject({ description: 'Dinner', amountMinor: 1000 });
    expect((await eventsOf(groupId)).map((event) => event.kind)).toEqual(['expense-created']);
  });

  it('refuses a malformed expense id without asking the database', async () => {
    const state = await updateExpense(
      IDLE_EXPENSE_STATE,
      expenseForm({
        groupId,
        expenseId: 'not-an-id',
        description: 'Dinner',
        amount: '10.00',
        date: '2026-10-05',
        payers: [{ membershipId: ada, amount: '10.00' }],
        splits: [{ membershipId: ada, included: true }],
      }),
    );

    expect(state).toEqual({ status: 'error', message: EXPENSE_NOT_FOUND_MESSAGE });
    expect(await onlyExpense(groupId)).toMatchObject({ amountMinor: 1000 });
  });

  it('refuses a signed-out caller and a stranger', async () => {
    jar.entries.clear();
    expect(await updateExpense(IDLE_EXPENSE_STATE, expenseForm({ groupId, expenseId }))).toEqual({
      status: 'error',
      message: UNAUTHENTICATED_MESSAGE,
    });

    // Somebody signed in who is in no group at all: the group they name is not there for them,
    // which is the same answer a group that never existed gets (TR-3).
    await signInAs(await createAccount('dee@example.co', 'Dee'));
    expect(
      await updateExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({ groupId, expenseId, description: 'Peeking' }),
      ),
    ).toEqual({ status: 'error', message: GROUP_NOT_FOUND_MESSAGE });

    await signInAs(adaId);
    expect(await onlyExpense(groupId)).toMatchObject({ description: 'Dinner' });
  });

  it('refuses an archived group', async () => {
    const archived = await seedGroup('Old trip', { archived: true });

    const state = await updateExpense(
      IDLE_EXPENSE_STATE,
      expenseForm({ groupId: archived.groupId, expenseId }),
    );

    expect(state).toEqual({ status: 'error', message: ARCHIVED_GROUP_MESSAGE });
  });

  it('leaves the expense exactly as it was when the write fails part-way', async () => {
    vi.mocked(splitAmount).mockImplementationOnce(() => {
      throw new Error('the plan failed after the payers were deleted');
    });

    await expect(
      updateExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({
          groupId,
          expenseId,
          description: 'Dinner, renamed',
          amount: '20.00',
          date: '2026-10-05',
          category: 'food',
          payers: [{ membershipId: ada, amount: '20.00' }],
          splits: [
            { membershipId: ada, included: true },
            { membershipId: bo, included: true },
          ],
        }),
      ),
    ).rejects.toThrow('the plan failed');

    // The update, the deletes and the rewrite are one transaction, so a failure in the middle puts
    // the original rule back rather than leaving an expense with no payers and no split — and
    // without a feed row claiming an edit that never committed.
    expect(await onlyExpense(groupId)).toMatchObject({ description: 'Dinner', amountMinor: 1000 });
    expect(await payersOf(expenseId)).toHaveLength(1);
    expect(await splitsOf(expenseId)).toHaveLength(2);
    expect((await eventsOf(groupId)).map((event) => event.kind)).toEqual(['expense-created']);
  });
});

describe('deleteExpense', () => {
  let groupId: string;
  let ada: string;
  let bo: string;
  let expenseId: string;

  beforeEach(async () => {
    ({ groupId, ada, bo } = await seedGroup());
    await signInAs(adaId);
    await redirectUrl(
      createExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({
          groupId,
          description: 'Dinner',
          amount: '10.00',
          date: '2026-10-05',
          payers: [{ membershipId: ada, amount: '10.00' }],
          splits: [
            { membershipId: ada, included: true },
            { membershipId: bo, included: true },
          ],
        }),
      ),
    );
    expenseId = (await onlyExpense(groupId)).id;
  });

  it('removes the expense with everything under it and records what it was', async () => {
    const url = await redirectUrl(
      deleteExpense(IDLE_EXPENSE_STATE, expenseForm({ groupId, expenseId })),
    );

    expect(url).toBe(`/groups/${groupId}?expense=${EXPENSE_DELETED}`);
    expect(await expenseRowsOf(groupId)).toHaveLength(0);
    expect(await allPayers()).toHaveLength(0);
    expect(await allSplits()).toHaveLength(0);

    const deleted = (await eventsOf(groupId)).find((event) => event.kind === 'expense-deleted');

    // The feed row outlives the expense, names what it was, and points at nothing: there is no
    // row left for it to point at.
    expect(deleted).toMatchObject({ subjectName: 'Dinner', expenseId: null, actorUserId: adaId });
  });

  it('refuses an expense that is not there, and one in another group', async () => {
    const other = await seedGroup('Somebody else', { members: [cyId] });
    await signInAs(cyId);

    expect(
      await deleteExpense(IDLE_EXPENSE_STATE, expenseForm({ groupId: other.groupId, expenseId })),
    ).toEqual({ status: 'error', message: EXPENSE_NOT_FOUND_MESSAGE });

    await signInAs(adaId);
    expect(
      await deleteExpense(IDLE_EXPENSE_STATE, expenseForm({ groupId, expenseId: NO_SUCH_ID })),
    ).toEqual({ status: 'error', message: EXPENSE_NOT_FOUND_MESSAGE });

    // Both refusals are the same answer, and the expense is untouched either way.
    expect(await onlyExpense(groupId)).toMatchObject({ description: 'Dinner' });
    expect(await allSplits()).toHaveLength(2);
  });

  it('refuses a signed-out caller and an archived group', async () => {
    jar.entries.clear();
    expect(await deleteExpense(IDLE_EXPENSE_STATE, expenseForm({ groupId, expenseId }))).toEqual({
      status: 'error',
      message: UNAUTHENTICATED_MESSAGE,
    });

    const archived = await seedGroup('Old trip', { archived: true });
    await signInAs(adaId);
    expect(
      await deleteExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({ groupId: archived.groupId, expenseId }),
      ),
    ).toEqual({ status: 'error', message: ARCHIVED_GROUP_MESSAGE });

    expect(await onlyExpense(groupId)).toMatchObject({ description: 'Dinner' });
  });

  it('refuses a malformed expense id', async () => {
    expect(
      await deleteExpense(IDLE_EXPENSE_STATE, expenseForm({ groupId, expenseId: 'nope' })),
    ).toEqual({ status: 'error', message: EXPENSE_NOT_FOUND_MESSAGE });
    expect(await onlyExpense(groupId)).toMatchObject({ description: 'Dinner' });
  });
});

describe('the expense list', () => {
  let groupId: string;
  let ada: string;
  let bo: string;
  let cy: string;

  async function add(spec: Partial<FormSpec> & { description: string; date: string }): Promise<void> {
    await signInAs(adaId);
    await redirectUrl(
      createExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({
          groupId,
          amount: '10.00',
          payers: [{ membershipId: ada, amount: '10.00' }],
          splits: [
            { membershipId: ada, included: true },
            { membershipId: bo, included: true },
          ],
          ...spec,
        }),
      ),
    );
  }

  function listed(filters: Partial<ExpenseFilters> = {}) {
    return withDb((handle) =>
      listExpenses(handle.db, groupId, { ...NO_FILTERS, ...filters }),
    );
  }

  beforeEach(async () => {
    ({ groupId, ada, bo, cy } = await seedGroup());
  });

  it('reads newest first, with who paid on each row', async () => {
    await add({ description: 'Old', date: '2026-09-01', category: 'food' });
    await add({ description: 'Newest', date: '2026-10-05', category: 'travel' });
    await add({ description: 'Middle', date: '2026-09-20', category: 'rent' });

    const rows = await listed();

    expect(rows.map((row) => row.description)).toEqual(['Newest', 'Middle', 'Old']);
    expect(rows[0].payers.map((payer) => payer.displayName)).toEqual(['Ada']);
    expect(rows[0]).toMatchObject({ amountMinor: 1000, splitType: 'equal', category: 'travel' });
  });

  it('filters by the member, whether they paid or owe', async () => {
    await add({
      description: 'Ada paid, both owe',
      date: '2026-10-01',
      payers: [{ membershipId: ada, amount: '10.00' }],
      splits: [
        { membershipId: ada, included: true },
        { membershipId: bo, included: true },
      ],
    });
    await add({
      description: 'Bo paid, Cy owes',
      date: '2026-10-02',
      payers: [{ membershipId: bo, amount: '10.00' }],
      splits: [{ membershipId: cy, included: true }],
    });
    // Cy is offered every member and left Cy out on purpose, which writes Cy's row with a zero
    // share. That row is the record that Cy is *not* part of this expense, so it is not Cy's.
    await add({
      description: 'Ada and Bo only',
      date: '2026-10-03',
      payers: [{ membershipId: ada, amount: '10.00' }],
      splits: [
        { membershipId: ada, included: true },
        { membershipId: bo, included: true },
        { membershipId: cy, included: false, value: '5.00' },
      ],
    });

    // Bo paid for one, owes on another, and is in the split of the third.
    expect((await listed({ memberId: bo })).map((row) => row.description).sort()).toEqual([
      'Ada and Bo only',
      'Ada paid, both owe',
      'Bo paid, Cy owes',
    ]);
    // Cy owes on the second — and not on the third, where they were left out on purpose.
    expect((await listed({ memberId: cy })).map((row) => row.description)).toEqual([
      'Bo paid, Cy owes',
    ]);
    // Ada paid for two of them, and is in no part of the third.
    expect((await listed({ memberId: ada })).map((row) => row.description).sort()).toEqual([
      'Ada and Bo only',
      'Ada paid, both owe',
    ]);
    // An id that is not a membership in this group is in no expense at all.
    expect(await listed({ memberId: adaId })).toEqual([]);
  });

  it('filters by category and searches descriptions, and combines the two', async () => {
    await add({ description: 'Dinner', date: '2026-10-01', category: 'food' });
    await add({ description: 'Taxi to the airport', date: '2026-10-02', category: 'travel' });

    expect((await listed({ category: 'travel' })).map((row) => row.description)).toEqual([
      'Taxi to the airport',
    ]);
    expect((await listed({ search: 'airport' })).map((row) => row.description)).toEqual([
      'Taxi to the airport',
    ]);
    expect(
      (await listed({ memberId: bo, category: 'food', search: 'dinner' })).map(
        (row) => row.description,
      ),
    ).toEqual(['Dinner']);
  });

  it('searches for a percent sign rather than matching everything with it', async () => {
    await add({ description: '100% cotton towels', date: '2026-10-01' });
    await add({ description: 'Dinner', date: '2026-10-02' });

    expect((await listed({ search: '100%' })).map((row) => row.description)).toEqual([
      '100% cotton towels',
    ]);
  });

  it('reads nothing for a group with no expenses', async () => {
    expect(await listed()).toEqual([]);
  });
});

describe('the editor read', () => {
  let groupId: string;
  let ada: string;
  let bo: string;

  beforeEach(async () => {
    ({ groupId, ada, bo } = await seedGroup());
    await signInAs(adaId);
  });

  it('opens a new expense on today, the viewer paying, and everyone in the split', async () => {
    const data = await withDb((handle) => getExpenseEditorData(handle.db, groupId, null, ada));

    expect(data).toMatchObject({
      description: '',
      amount: '',
      category: 'other',
      note: '',
      splitType: 'equal',
      payers: [{ membershipId: ada, displayName: 'Ada', amount: '' }],
    });
    expect(data?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      data?.participants.map((participant) => [participant.displayName, participant.included]),
    ).toEqual([
      ['Ada', true],
      ['Bo', true],
      ['Cy', true],
    ]);
    expect(data?.participants.map((participant) => participant.value)).toEqual(['', '', '']);
  });

  it('reopens an expense exactly as it was entered', async () => {
    await redirectUrl(
      createExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({
          groupId,
          description: 'Hotel',
          amount: '123.45',
          date: '2026-10-03',
          category: 'travel',
          note: 'two nights',
          splitType: 'percentage',
          payers: [{ membershipId: ada, amount: '123.45' }],
          splits: [
            { membershipId: ada, included: true, value: '33.33' },
            { membershipId: bo, included: true, value: '66.67' },
          ],
        }),
      ),
    );
    const expenseId = (await onlyExpense(groupId)).id;

    const data = await withDb((handle) => getExpenseEditorData(handle.db, groupId, expenseId, ada));

    // The rule as it was entered, not the shares it came to: 33.33% comes back as 33.33%, which
    // is only possible because the input is stored beside the result (ADR-0007).
    expect(data).toMatchObject({
      description: 'Hotel',
      amount: '123.45',
      date: '2026-10-03',
      category: 'travel',
      note: 'two nights',
      splitType: 'percentage',
      payers: [{ membershipId: ada, displayName: 'Ada', amount: '123.45' }],
    });
    expect(
      data?.participants.map((participant) => [
        participant.displayName,
        participant.included,
        participant.value,
      ]),
    ).toEqual([
      ['Ada', true, '33.33'],
      ['Bo', true, '66.67'],
      // A current member the expense never counted is offered, and offered left out: including
      // them would move money on a save that was meant to change something else.
      ['Cy', false, ''],
    ]);
  });

  it('leaves a member who joined after the expense was written out of its split', async () => {
    await redirectUrl(
      createExpense(
        IDLE_EXPENSE_STATE,
        expenseForm({
          groupId,
          description: 'Dinner',
          amount: '10.00',
          date: '2026-10-05',
          payers: [{ membershipId: ada, amount: '10.00' }],
          splits: [
            { membershipId: ada, included: true },
            { membershipId: bo, included: true },
          ],
        }),
      ),
    );
    const expenseId = (await onlyExpense(groupId)).id;
    const dee = await createAccount('dee@example.co', 'Dee');
    await withDb((handle) =>
      handle.db
        .insert(memberships)
        .values({ groupId, userId: dee, displayName: 'Dee', role: 'member' }),
    );

    const data = await withDb((handle) => getExpenseEditorData(handle.db, groupId, expenseId, ada));
    const latecomer = data?.participants.find((participant) => participant.displayName === 'Dee');

    expect(latecomer).toMatchObject({ included: false, value: '' });
  });

  it('reads nothing for an expense in another group, or one that does not exist', async () => {
    const other = await seedGroup('Somebody else', { members: [cyId] });

    expect(await withDb((handle) => loadExpense(handle.db, other.groupId, NO_SUCH_ID))).toBeNull();
    expect(await withDb((handle) => loadExpense(handle.db, groupId, NO_SUCH_ID))).toBeNull();
    expect(
      await withDb((handle) => getExpenseEditorData(handle.db, groupId, NO_SUCH_ID, ada)),
    ).toBeNull();
  });
});
