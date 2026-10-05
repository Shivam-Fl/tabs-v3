import { hashPassword } from '../auth/password';
import type { Db } from '../db/client';
import {
  activityEvents,
  expensePayers,
  expenses,
  groups,
  memberships,
  payments,
  sessions,
  splitLines,
  users,
} from '../db/schema';
import { splitAmount, type SplitInput, type SplitType } from '../money/splits';

/**
 * The one set of fixture rows this product seeds, and the one loader that writes them (TR-12,
 * IAC-3).
 *
 * There is exactly one loader because there are two ways to run the seed and they must produce
 * the same database: through the serving application (`scripts/seed.ts` posts to the dev-only
 * `/api/seed` route when one answers, which is the only way rows can reach the in-memory
 * database the browser is being served from) and directly, for CI and for a real Postgres. Two
 * loaders would be two fixture sets within a week.
 *
 * Four rules hold here, and each of them is a rule the write paths already hold.
 *
 * **Wipe and reload.** The loader is idempotent by starting from empty: it deletes the fixture
 * tables in dependency order and writes the set again, so a second run leaves one copy of
 * everything rather than two. That is also what makes it safe to run against a development
 * database whose fixtures somebody has been editing.
 *
 * **Fixed timestamps.** Every row is stamped from one fixed schedule rather than from the clock,
 * so two runs of the seed produce the same feed in the same order and a test can assert on it.
 * The schedule runs oldest-first in fixture order, which is what makes the feed — read newest
 * first — come back as the reverse of the list below.
 *
 * **Money through the money core.** Shares are computed by `splitAmount`, never written by hand,
 * and the inputs each member typed are stored beside the shares they produce (ADR-0007), so the
 * fixtures are a real ledger rather than a plausible-looking one.
 *
 * **The feed is written with the rows it describes.** There is no screen that derives history
 * from the ledger, so a fixture that wrote expenses without their `expense-created` rows would
 * seed a group with nothing in its feed. Each helper below writes its own event in the shape the
 * corresponding action writes it.
 */

/** The password every seeded account shares, printed by the seed and documented in the README. */
export const SEED_PASSWORD = 'tabs-demo-password';

/**
 * The header `scripts/seed.ts` sets on the request that asks a running app to seed itself, and
 * the value it sets it to. It lives here because it is part of the seed's contract and all three
 * sides of it — the script, the route and the route's test — have to agree.
 *
 * It is a same-origin guard rather than a credential: a custom header makes a cross-site `POST`
 * preflighted, and the dev server answers no preflight, so a page in the developer's browser
 * cannot reach `POST /api/seed` behind their back. Anyone who can read this file can forge the
 * header, and that is fine — the guard is not protecting the fixtures from a person, it is
 * stopping a drive-by from a tab they happen to have open.
 */
export const SEED_REQUEST_HEADER = 'x-tabs-seed';
export const SEED_REQUEST_VALUE = '1';

export interface SeedAccount {
  email: string;
  displayName: string;
  currency: string;
}

/**
 * The accounts QA signs in as. The domain is reserved for testing (RFC 2606), so no address
 * here can ever belong to a person, and the names are the ones the fixture's own history uses.
 */
export const SEED_ACCOUNTS: readonly SeedAccount[] = [
  { email: 'ada@tabs.test', displayName: 'Ada', currency: 'INR' },
  { email: 'bo@tabs.test', displayName: 'Bo', currency: 'INR' },
  { email: 'cy@tabs.test', displayName: 'Cy', currency: 'INR' },
];

/** How many rows of each kind the loader left behind. */
export interface SeedSummary {
  users: number;
  groups: number;
  memberships: number;
  expenses: number;
  payments: number;
  activity: number;
}

/** The first moment in the fixture schedule: one fixture day per event, oldest first. */
const FIXTURE_START = Date.parse('2026-01-05T09:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/** The nth fixture day. Distinct, increasing, and the same on every run of the seed. */
function dayAt(step: number): Date {
  return new Date(FIXTURE_START + step * DAY_MS);
}

/** How many rows of each kind are in the fixture tables right now. */
async function countRows(db: Db): Promise<SeedSummary> {
  return {
    users: (await db.select({ id: users.id }).from(users)).length,
    groups: (await db.select({ id: groups.id }).from(groups)).length,
    memberships: (await db.select({ id: memberships.id }).from(memberships)).length,
    expenses: (await db.select({ id: expenses.id }).from(expenses)).length,
    payments: (await db.select({ id: payments.id }).from(payments)).length,
    activity: (await db.select({ id: activityEvents.id }).from(activityEvents)).length,
  };
}

/**
 * Empties the fixture tables, children before parents.
 *
 * The order is the foreign keys' order rather than the cascade's convenience: deleting `users`
 * first would take most of this with it, but it would also take anything a person had added by
 * hand since, and the seed is supposed to replace its own fixtures, not to be a delete-everything
 * button whose blast radius is whatever the schema happens to reference today.
 */
async function wipe(db: Db): Promise<void> {
  await db.delete(activityEvents);
  await db.delete(splitLines);
  await db.delete(expensePayers);
  await db.delete(expenses);
  await db.delete(payments);
  await db.delete(memberships);
  await db.delete(sessions);
  await db.delete(groups);
  await db.delete(users);
}

/** One seat: a membership row, and the feed row the write path records for it. */
async function addSeat(
  db: Db,
  seat: {
    groupId: string;
    userId: string | null;
    displayName: string;
    role: string;
    at: Date;
    /**
     * The event this seat writes. Null for the owner's own seat, because creating a group is the
     * one membership change the product records no event for — the group's existence is its own
     * record, and a feed whose first row says the founder joined would be inventing history.
     */
    event: { actorUserId: string; kind: string } | null;
  },
): Promise<string> {
  const [membership] = await db
    .insert(memberships)
    .values({
      groupId: seat.groupId,
      userId: seat.userId,
      displayName: seat.displayName,
      role: seat.role,
      createdAt: seat.at,
      updatedAt: seat.at,
    })
    .returning({ id: memberships.id });

  if (seat.event) {
    await db.insert(activityEvents).values({
      groupId: seat.groupId,
      actorUserId: seat.event.actorUserId,
      subjectUserId: seat.userId,
      subjectName: seat.displayName,
      kind: seat.event.kind,
      createdAt: seat.at,
    });
  }

  return membership.id;
}

interface FixturePayer {
  membershipId: string;
  displayName: string;
  amountMinor: number;
}

interface FixtureSplit {
  membershipId: string;
  displayName: string;
  included: boolean;
  /** Minor units for exact, basis points for percentage, a count for shares, null for equal. */
  value: number | null;
}

/** An expense with its payers, its split lines and the feed row that records it. */
async function addExpense(
  db: Db,
  fixture: {
    groupId: string;
    actorUserId: string;
    description: string;
    amountMinor: number;
    category: string;
    note?: string;
    splitType: SplitType;
    payers: FixturePayer[];
    splits: FixtureSplit[];
    at: Date;
  },
): Promise<void> {
  const [expense] = await db
    .insert(expenses)
    .values({
      groupId: fixture.groupId,
      description: fixture.description,
      amountMinor: fixture.amountMinor,
      date: fixture.at.toISOString().slice(0, 10),
      category: fixture.category,
      note: fixture.note ?? null,
      splitType: fixture.splitType,
      createdAt: fixture.at,
    })
    .returning({ id: expenses.id });

  const inputs: SplitInput[] = fixture.splits.map((line) => ({
    membershipId: line.membershipId,
    included: line.included,
    value: line.value,
  }));

  // The shares are computed, never typed in: the rule and its result are stored together, which
  // is what ADR-0007 asks of every writer, and it is what keeps the fixture's balances honest
  // against its own amounts.
  const shares = new Map(
    splitAmount(
      fixture.amountMinor,
      fixture.splitType,
      inputs,
      fixture.payers.map((payer) => payer.membershipId),
    ).map((share) => [share.membershipId, share.shareMinor]),
  );

  await db.insert(expensePayers).values(
    fixture.payers.map((payer, index) => ({
      expenseId: expense.id,
      membershipId: payer.membershipId,
      displayName: payer.displayName,
      amountMinor: payer.amountMinor,
      position: index,
    })),
  );

  await db.insert(splitLines).values(
    fixture.splits.map((line) => ({
      expenseId: expense.id,
      membershipId: line.membershipId,
      displayName: line.displayName,
      included: line.included,
      inputValue: line.value,
      shareMinor: shares.get(line.membershipId) ?? 0,
    })),
  );

  await db.insert(activityEvents).values({
    groupId: fixture.groupId,
    actorUserId: fixture.actorUserId,
    subjectName: fixture.description,
    kind: 'expense-created',
    expenseId: expense.id,
    createdAt: fixture.at,
  });
}

interface FixtureEndpoint {
  membershipId: string;
  displayName: string;
}

/** A settle-up payment and the feed row that records it, snapshot and all. */
async function addPayment(
  db: Db,
  fixture: {
    groupId: string;
    actorUserId: string;
    from: FixtureEndpoint;
    to: FixtureEndpoint;
    amountMinor: number;
    at: Date;
  },
): Promise<void> {
  const [payment] = await db
    .insert(payments)
    .values({
      groupId: fixture.groupId,
      fromMembershipId: fixture.from.membershipId,
      fromDisplayName: fixture.from.displayName,
      toMembershipId: fixture.to.membershipId,
      toDisplayName: fixture.to.displayName,
      amountMinor: fixture.amountMinor,
      createdAt: fixture.at,
    })
    .returning({ id: payments.id });

  // The snapshot rides the event as well as the row, exactly as `createPayment` writes it: when
  // the payment is later deleted its link is nulled, and the snapshot is what is left to render.
  await db.insert(activityEvents).values({
    groupId: fixture.groupId,
    actorUserId: fixture.actorUserId,
    subjectName: `${fixture.from.displayName} paid ${fixture.to.displayName}`,
    kind: 'payment-created',
    paymentId: payment.id,
    payload: {
      amountMinor: fixture.amountMinor,
      fromMembershipId: fixture.from.membershipId,
      fromDisplayName: fixture.from.displayName,
      toMembershipId: fixture.to.membershipId,
      toDisplayName: fixture.to.displayName,
    },
    createdAt: fixture.at,
  });
}

/**
 * Wipes the fixture tables and writes the set again, returning what is there afterwards.
 *
 * The password is hashed once for every account rather than once per account: the fixture's
 * accounts share one published password, and bcrypt at cost 12 takes a third of a second a
 * call — a loader a test invokes repeatedly should not spend a second per run proving the same
 * string hashes three ways.
 */
export async function loadFixtures(db: Db): Promise<SeedSummary> {
  const passwordHash = await hashPassword(SEED_PASSWORD);

  await wipe(db);

  const userIds = new Map<string, string>();
  for (const account of SEED_ACCOUNTS) {
    const [user] = await db
      .insert(users)
      .values({
        email: account.email,
        passwordHash,
        displayName: account.displayName,
        currency: account.currency,
        createdAt: dayAt(0),
      })
      .returning({ id: users.id });

    userIds.set(account.displayName, user.id);
  }

  const ada = userIds.get('Ada') as string;
  const bo = userIds.get('Bo') as string;
  const cy = userIds.get('Cy') as string;

  // --- The trip: three members, a held seat, and every split type ---

  const [trip] = await db
    .insert(groups)
    .values({
      name: 'Goa trip',
      currency: 'INR',
      type: 'trip',
      inviteEnabled: true,
      createdAt: dayAt(0),
      updatedAt: dayAt(0),
    })
    .returning({ id: groups.id });

  const adaTrip = await addSeat(db, {
    groupId: trip.id,
    userId: ada,
    displayName: 'Ada',
    role: 'owner',
    at: dayAt(0),
    event: null,
  });
  const boTrip = await addSeat(db, {
    groupId: trip.id,
    userId: bo,
    displayName: 'Bo',
    role: 'member',
    at: dayAt(1),
    event: { actorUserId: bo, kind: 'join' },
  });
  const cyTrip = await addSeat(db, {
    groupId: trip.id,
    userId: cy,
    displayName: 'Cy',
    role: 'member',
    at: dayAt(2),
    event: { actorUserId: cy, kind: 'join' },
  });
  // A seat held by name for somebody who has no account yet — the one membership change with no
  // person behind it, and the row the feed can only render from its snapshot.
  const deeTrip = await addSeat(db, {
    groupId: trip.id,
    userId: null,
    displayName: 'Dee',
    role: 'member',
    at: dayAt(3),
    event: { actorUserId: ada, kind: 'member-added' },
  });

  const tripMembers = [
    { membershipId: adaTrip, displayName: 'Ada' },
    { membershipId: boTrip, displayName: 'Bo' },
    { membershipId: cyTrip, displayName: 'Cy' },
  ];

  /** The held seat as the split lines carry it: offered, and left out. */
  const heldSeat: FixtureSplit = {
    membershipId: deeTrip,
    displayName: 'Dee',
    included: false,
    value: null,
  };

  /**
   * The lines one of this group's expenses stores: a row for every seat the editor offers, the
   * held seat among them and marked out rather than absent.
   *
   * That is the write path's shape, not a tidy-up of it. The editor renders a row per member of
   * the group and the save keeps a line for each one — as `splitAmount` puts it, "the ones left
   * out marked rather than absent ... because that is the row the expense stores". A fixture
   * holding three lines where the app holds four would be a ledger no screen produces, and the
   * first edit QA made to it would show a participants change nobody made: the held seat
   * arriving, when all that happened was the expense being read back into the form.
   */
  const withHeldSeat = (lines: FixtureSplit[]): FixtureSplit[] => [...lines, heldSeat];

  const inSplit = (value: number | null = null): FixtureSplit[] =>
    withHeldSeat(tripMembers.map((member) => ({ ...member, included: true, value })));

  await addExpense(db, {
    groupId: trip.id,
    actorUserId: ada,
    description: 'Beach shack dinner',
    amountMinor: 100_000,
    category: 'food',
    splitType: 'equal',
    payers: [{ membershipId: adaTrip, displayName: 'Ada', amountMinor: 100_000 }],
    // 1000.00 three ways does not divide, so the paisa goes to the first payer (TR-4) — which is
    // why this expense is here rather than a rounder one.
    splits: inSplit(),
    at: dayAt(4),
  });

  await addExpense(db, {
    groupId: trip.id,
    actorUserId: bo,
    description: 'Cab to the airport',
    amountMinor: 90_000,
    category: 'travel',
    splitType: 'exact',
    payers: [{ membershipId: boTrip, displayName: 'Bo', amountMinor: 90_000 }],
    splits: withHeldSeat(
      tripMembers.map((member) => ({ ...member, included: true, value: 30_000 })),
    ),
    at: dayAt(5),
  });

  await addExpense(db, {
    groupId: trip.id,
    actorUserId: cy,
    description: 'Groceries for the week',
    amountMinor: 125_000,
    category: 'food',
    note: 'split 50/25/25',
    splitType: 'percentage',
    payers: [{ membershipId: cyTrip, displayName: 'Cy', amountMinor: 125_000 }],
    splits: withHeldSeat([
      { membershipId: adaTrip, displayName: 'Ada', included: true, value: 5000 },
      { membershipId: boTrip, displayName: 'Bo', included: true, value: 2500 },
      { membershipId: cyTrip, displayName: 'Cy', included: true, value: 2500 },
    ]),
    at: dayAt(6),
  });

  await addExpense(db, {
    groupId: trip.id,
    actorUserId: ada,
    description: 'Villa for four nights',
    amountMinor: 600_000,
    category: 'travel',
    splitType: 'shares',
    payers: [{ membershipId: adaTrip, displayName: 'Ada', amountMinor: 600_000 }],
    splits: withHeldSeat([
      { membershipId: adaTrip, displayName: 'Ada', included: true, value: 2 },
      { membershipId: boTrip, displayName: 'Bo', included: true, value: 1 },
      { membershipId: cyTrip, displayName: 'Cy', included: true, value: 1 },
    ]),
    at: dayAt(7),
  });

  // Two payers on one expense: parts that sum to the total rather than one person fronting it.
  await addExpense(db, {
    groupId: trip.id,
    actorUserId: ada,
    description: 'Boat rental',
    amountMinor: 300_000,
    category: 'entertainment',
    splitType: 'equal',
    payers: [
      { membershipId: adaTrip, displayName: 'Ada', amountMinor: 200_000 },
      { membershipId: boTrip, displayName: 'Bo', amountMinor: 100_000 },
    ],
    splits: inSplit(),
    at: dayAt(8),
  });

  await addPayment(db, {
    groupId: trip.id,
    actorUserId: cy,
    from: { membershipId: cyTrip, displayName: 'Cy' },
    to: { membershipId: adaTrip, displayName: 'Ada' },
    amountMinor: 50_000,
    at: dayAt(9),
  });

  // --- A second group, so the cross-group feed has more than one group to cross ---

  const [flat] = await db
    .insert(groups)
    .values({
      name: 'Flat 4B',
      currency: 'INR',
      type: 'home',
      inviteEnabled: true,
      createdAt: dayAt(10),
      updatedAt: dayAt(10),
    })
    .returning({ id: groups.id });

  const adaFlat = await addSeat(db, {
    groupId: flat.id,
    userId: ada,
    displayName: 'Ada',
    role: 'owner',
    at: dayAt(10),
    event: null,
  });
  const boFlat = await addSeat(db, {
    groupId: flat.id,
    userId: bo,
    displayName: 'Bo',
    role: 'member',
    at: dayAt(11),
    event: { actorUserId: bo, kind: 'join' },
  });

  await addExpense(db, {
    groupId: flat.id,
    actorUserId: ada,
    description: 'Internet for the month',
    amountMinor: 99_900,
    category: 'utilities',
    splitType: 'equal',
    payers: [{ membershipId: adaFlat, displayName: 'Ada', amountMinor: 99_900 }],
    splits: [
      { membershipId: adaFlat, displayName: 'Ada', included: true, value: null },
      { membershipId: boFlat, displayName: 'Bo', included: true, value: null },
    ],
    at: dayAt(12),
  });

  await addPayment(db, {
    groupId: flat.id,
    actorUserId: bo,
    from: { membershipId: boFlat, displayName: 'Bo' },
    to: { membershipId: adaFlat, displayName: 'Ada' },
    amountMinor: 25_000,
    at: dayAt(13),
  });

  return countRows(db);
}
