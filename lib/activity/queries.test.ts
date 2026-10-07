import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { activityEvents, expenses, groups, memberships, users } from '../db/schema';
import type { PaymentSnapshot } from '../settle/validation';
import {
  ACTIVITY_FILTERS,
  activityFilterFrom,
  activityHref,
  failedFeedScope,
  listGroupActivity,
  listUserActivity,
  rawGroupScope,
  type ActivityFilter,
  type ActivityRow,
} from './queries';

/**
 * The two feed readers, against a real database.
 *
 * What these cases are about is the three ways a feed can be quietly wrong rather than broken: a
 * chip that shows the wrong set of kinds, a scope that includes a group the reader is not in (or
 * drops one they are), and an order that depends on which row the planner happened to return
 * first. The last one is why the tie case is written at all — several events written in one
 * transaction share `created_at` to the microsecond, and a feed whose order changes between reads
 * is the defect that does not look like one.
 *
 * The other half is what a row is *made of*: the subject name is a snapshot on the row itself,
 * and the two cases that would fail if it were resolved by joining are the placeholder (no
 * account to join to) and the delete (nothing left to join to).
 */

const HASH = '$2b$12$fixture-not-a-real-hash';

/** A fixture instant, so every case states its own order rather than sharing a clock. */
function at(minutes: number): Date {
  return new Date(Date.UTC(2026, 0, 5, 9, minutes));
}

interface Fixture {
  ada: string;
  bo: string;
  cy: string;
  /** The group both feeds are mostly about. */
  trip: string;
  /** Ada's, archived: in scope, so archiving cannot be a hole in the record. */
  flat: string;
  /** Cy's, and nobody else's: the group no other reader may see. */
  elsewhere: string;
  tripEvents: Record<string, string>;
  flatEvent: string;
  elsewhereEvent: string;
}

let fixture: Fixture;

async function account(email: string, displayName: string): Promise<string> {
  return withDb(async (handle) => {
    const [user] = await handle.db
      .insert(users)
      .values({ email, passwordHash: HASH, displayName })
      .returning({ id: users.id });
    return user.id;
  });
}

async function group(name: string, ownerId: string, archived = false): Promise<string> {
  return withDb(async (handle) => {
    const [row] = await handle.db
      .insert(groups)
      .values({ name, currency: 'INR', type: 'trip', archived })
      .returning({ id: groups.id });

    await handle.db
      .insert(memberships)
      .values({ groupId: row.id, userId: ownerId, displayName: 'Owner', role: 'owner' });

    return row.id;
  });
}

async function seat(groupId: string, userId: string, displayName: string): Promise<string> {
  return withDb(async (handle) => {
    const [row] = await handle.db
      .insert(memberships)
      .values({ groupId, userId, displayName, role: 'member' })
      .returning({ id: memberships.id });
    return row.id;
  });
}

async function addEvent(event: {
  groupId: string;
  actorUserId: string;
  kind: string;
  subjectName: string;
  createdAt: Date;
  subjectUserId?: string | null;
  expenseId?: string | null;
  payload?: PaymentSnapshot | null;
}): Promise<string> {
  return withDb(async (handle) => {
    const [row] = await handle.db
      .insert(activityEvents)
      .values({
        groupId: event.groupId,
        actorUserId: event.actorUserId,
        kind: event.kind,
        subjectName: event.subjectName,
        subjectUserId: event.subjectUserId ?? null,
        expenseId: event.expenseId ?? null,
        payload: event.payload ?? null,
        createdAt: event.createdAt,
      })
      .returning({ id: activityEvents.id });
    return row.id;
  });
}

async function addExpense(groupId: string, description: string): Promise<string> {
  return withDb(async (handle) => {
    const [row] = await handle.db
      .insert(expenses)
      .values({
        groupId,
        description,
        amountMinor: 10_000,
        date: '2026-01-05',
        splitType: 'equal',
      })
      .returning({ id: expenses.id });
    return row.id;
  });
}

function ids(rows: ActivityRow[]): string[] {
  return rows.map((row) => row.id);
}

/** The ids of one chip's rows in the trip, as a set — the fixture's order is not what is under test. */
function kindSet(rows: ActivityRow[]): string[] {
  return rows.map((row) => row.kind).sort();
}

beforeAll(async () => {
  await withDb((handle) => runMigrations(handle.db));
});

beforeEach(async () => {
  await withDb(async (handle) => {
    await handle.db.delete(activityEvents);
    await handle.db.delete(expenses);
    await handle.db.delete(memberships);
    await handle.db.delete(groups);
    await handle.db.delete(users);
  });

  const ada = await account('ada@example.co', 'Ada');
  const bo = await account('bo@example.co', 'Bo');
  const cy = await account('cy@example.co', 'Cy');

  const trip = await group('Goa trip', ada);
  const boSeat = await seat(trip, bo, 'Bo');
  const flat = await group('Flat 4B', ada, true);
  const elsewhere = await group('Somebody else', cy);

  const dinner = await addExpense(trip, 'Beach shack dinner');

  const tripEvents: Record<string, string> = {};
  tripEvents.dinner = await addEvent({
    groupId: trip,
    actorUserId: ada,
    kind: 'expense-created',
    subjectName: 'Beach shack dinner',
    createdAt: at(0),
    expenseId: dinner,
  });
  tripEvents.boJoined = await addEvent({
    groupId: trip,
    actorUserId: bo,
    kind: 'join',
    subjectName: 'Bo',
    createdAt: at(1),
    subjectUserId: bo,
  });
  // Dee holds a seat with no account behind it: there is no user row this could ever join to.
  tripEvents.deeAdded = await addEvent({
    groupId: trip,
    actorUserId: ada,
    kind: 'member-added',
    subjectName: 'Dee',
    createdAt: at(2),
    subjectUserId: null,
  });
  tripEvents.paid = await addEvent({
    groupId: trip,
    actorUserId: bo,
    kind: 'payment-created',
    subjectName: 'Bo paid Ada',
    createdAt: at(3),
    payload: {
      amountMinor: 5_000,
      fromMembershipId: boSeat,
      fromDisplayName: 'Bo',
      toMembershipId: 'to-seat',
      toDisplayName: 'Ada',
    },
  });
  // A kind from some future ticket. Nothing names it, and it must still be visible under All.
  tripEvents.renamed = await addEvent({
    groupId: trip,
    actorUserId: ada,
    kind: 'group-renamed',
    subjectName: 'Goa trip',
    createdAt: at(4),
  });
  // Two events written in the same instant, which is what one transaction looks like.
  tripEvents.edited = await addEvent({
    groupId: trip,
    actorUserId: ada,
    kind: 'expense-edited',
    subjectName: 'Beach shack dinner',
    createdAt: at(5),
    expenseId: dinner,
  });
  tripEvents.editedTie = await addEvent({
    groupId: trip,
    actorUserId: bo,
    kind: 'expense-edited',
    subjectName: 'Beach shack dinner',
    createdAt: at(5),
    expenseId: dinner,
  });

  const flatEvent = await addEvent({
    groupId: flat,
    actorUserId: ada,
    kind: 'expense-created',
    subjectName: 'Internet',
    createdAt: at(6),
  });

  const elsewhereEvent = await addEvent({
    groupId: elsewhere,
    actorUserId: cy,
    kind: 'expense-created',
    subjectName: 'Secret',
    createdAt: at(7),
  });

  fixture = { ada, bo, cy, trip, flat, elsewhere, tripEvents, flatEvent, elsewhereEvent };
});

describe('the chip filter', () => {
  it('shows every kind under All, including one no chip names', async () => {
    const rows = await withDb((handle) => listGroupActivity(handle.db, fixture.trip, 'all'));

    expect(kindSet(rows)).toEqual([
      'expense-created',
      'expense-edited',
      'expense-edited',
      'group-renamed',
      'join',
      'member-added',
      'payment-created',
    ]);
  });

  it('shows exactly the three expense kinds under Expenses', async () => {
    const rows = await withDb((handle) => listGroupActivity(handle.db, fixture.trip, 'expenses'));

    expect(kindSet(rows)).toEqual(['expense-created', 'expense-edited', 'expense-edited']);
  });

  it('shows exactly the payment kinds under Payments', async () => {
    const rows = await withDb((handle) => listGroupActivity(handle.db, fixture.trip, 'payments'));

    expect(kindSet(rows)).toEqual(['payment-created']);
  });

  it('shows the membership kinds under Members, member-added among them', async () => {
    const rows = await withDb((handle) => listGroupActivity(handle.db, fixture.trip, 'members'));

    expect(kindSet(rows)).toEqual(['join', 'member-added']);
  });

  it('keeps the unknown kind out of every named chip', async () => {
    for (const filter of ACTIVITY_FILTERS.filter((value) => value !== 'all')) {
      const rows = await withDb((handle) => listGroupActivity(handle.db, fixture.trip, filter));
      expect(ids(rows)).not.toContain(fixture.tripEvents.renamed);
    }
  });
});

describe('the cross-group reader', () => {
  it('reads every group the caller is in, archived ones included', async () => {
    const rows = await withDb((handle) => listUserActivity(handle.db, fixture.ada, 'all'));

    expect(ids(rows)).toContain(fixture.flatEvent);
    expect(rows.find((row) => row.id === fixture.flatEvent)?.groupArchived).toBe(true);
  });

  it('never reads a group the caller holds no seat in', async () => {
    const rows = await withDb((handle) => listUserActivity(handle.db, fixture.ada, 'all'));

    expect(ids(rows)).not.toContain(fixture.elsewhereEvent);
    expect(rows.map((row) => row.groupId)).not.toContain(fixture.elsewhere);
  });

  it('reads only their own group for somebody who is in one', async () => {
    const rows = await withDb((handle) => listUserActivity(handle.db, fixture.cy, 'all'));

    expect(ids(rows)).toEqual([fixture.elsewhereEvent]);
  });

  it('reads nothing, rather than everything, for somebody in no group', async () => {
    const stranger = await account('nobody@example.co', 'Nobody');

    const rows = await withDb((handle) => listUserActivity(handle.db, stranger, 'all'));

    expect(rows).toEqual([]);
  });

  it('applies the chip to the cross-group list too', async () => {
    const rows = await withDb((handle) => listUserActivity(handle.db, fixture.ada, 'payments'));

    expect(kindSet(rows)).toEqual(['payment-created']);
  });
});

describe('the order', () => {
  it('reads newest first', async () => {
    const rows = await withDb((handle) => listGroupActivity(handle.db, fixture.trip, 'all'));

    for (let index = 1; index < rows.length; index += 1) {
      expect(rows[index - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        rows[index].createdAt.getTime(),
      );
    }
  });

  it('breaks a shared timestamp by id, descending, so the order is total', async () => {
    const rows = await withDb((handle) => listGroupActivity(handle.db, fixture.trip, 'all'));
    const tied = rows.filter((row) => row.createdAt.getTime() === at(5).getTime());

    // The two ids as strings, ascending: the reader must give them back the other way round.
    const [lower, higher] = [fixture.tripEvents.edited, fixture.tripEvents.editedTie].sort();

    expect(tied.map((row) => row.id)).toEqual([higher, lower]);
  });

  it('gives the same answer twice, which is what a total order means', async () => {
    const first = await withDb((handle) => listUserActivity(handle.db, fixture.ada, 'all'));
    const second = await withDb((handle) => listUserActivity(handle.db, fixture.ada, 'all'));

    expect(ids(second)).toEqual(ids(first));
  });
});

describe('the names on a row', () => {
  it('resolves the actor through a left join', async () => {
    const rows = await withDb((handle) => listGroupActivity(handle.db, fixture.trip, 'all'));

    expect(rows.find((row) => row.id === fixture.tripEvents.boJoined)?.actorName).toBe('Bo');
  });

  it('keeps a placeholder row whose subject has no account, reading its snapshot name', async () => {
    const rows = await withDb((handle) => listGroupActivity(handle.db, fixture.trip, 'members'));
    const placeholder = rows.find((row) => row.id === fixture.tripEvents.deeAdded);

    expect(placeholder?.subjectName).toBe('Dee');
    expect(placeholder?.kind).toBe('member-added');
  });

  it('keeps a deleted expense row, with nothing left to point at', async () => {
    // Its own expense rather than one of the fixture's, so the case states its own preconditions.
    const doomed = await addExpense(fixture.trip, 'Doomed');
    const eventId = await addEvent({
      groupId: fixture.trip,
      actorUserId: fixture.ada,
      kind: 'expense-deleted',
      subjectName: 'Doomed',
      createdAt: at(8),
      expenseId: doomed,
    });

    await withDb((handle) => handle.db.delete(expenses).where(eq(expenses.id, doomed)));

    const rows = await withDb((handle) => listGroupActivity(handle.db, fixture.trip, 'all'));
    const survivor = rows.find((row) => row.id === eventId);

    // The description it snapshotted is now the only thing that says what was deleted.
    expect(survivor?.subjectName).toBe('Doomed');
    expect(survivor?.expenseId).toBeNull();
  });
});

describe('the filter value a URL carries', () => {
  it('is one of the four chips, whatever case or padding it arrives in', () => {
    for (const filter of ACTIVITY_FILTERS) {
      expect(activityFilterFrom(filter)).toBe(filter);
      expect(activityFilterFrom(` ${filter.toUpperCase()} `)).toBe(filter);
    }
  });

  it('falls back to All for anything else, rather than refusing the reader', () => {
    for (const value of ['', '   ', 'everything', 'expense', '42', undefined]) {
      expect(activityFilterFrom(value)).toBe('all');
    }
  });

  it('uses the first value of a repeated key instead of throwing', () => {
    expect(activityFilterFrom(['expenses', 'members'])).toBe('expenses');
    expect(activityFilterFrom(['bogus', 'members'])).toBe('all');
    expect(activityFilterFrom([])).toBe('all');
  });
});

const SCOPE_ID = '11111111-1111-4111-8111-111111111111';

describe('the feed link', () => {
  it('is bare for the unscoped, unfiltered feed', () => {
    expect(activityHref('all', null)).toBe('/activity');
  });

  it('carries the scope alone, the filter alone, or both', () => {
    expect(activityHref('all', SCOPE_ID)).toBe(`/activity?group=${SCOPE_ID}`);
    expect(activityHref('expenses', null)).toBe('/activity?activity=expenses');
    expect(activityHref('expenses', SCOPE_ID)).toBe(`/activity?group=${SCOPE_ID}&activity=expenses`);
  });
});

describe('the raw group scope', () => {
  it('is the first value when it is a uuid', () => {
    expect(rawGroupScope(SCOPE_ID)).toBe(SCOPE_ID);
    expect(rawGroupScope([SCOPE_ID, 'whatever'])).toBe(SCOPE_ID);
  });

  it('is null for anything that is not a uuid', () => {
    for (const value of ['nope', '', '   ', [], ['nope', SCOPE_ID], undefined]) {
      expect(rawGroupScope(value)).toBeNull();
    }
  });
});

describe('the scope a failed feed carries', () => {
  const OWN = { id: SCOPE_ID, name: 'Trip', archived: false, currency: 'INR' };
  const STRANGER = '22222222-2222-4222-8222-222222222222';

  it('is the raw uuid when the groups read did not complete', () => {
    expect(failedFeedScope(false, [], SCOPE_ID)).toBe(SCOPE_ID);
    expect(failedFeedScope(false, [], [SCOPE_ID, STRANGER])).toBe(SCOPE_ID);
  });

  it('is null when the groups read did not complete and the value is not a uuid', () => {
    for (const value of ['nope', '', [], undefined]) {
      expect(failedFeedScope(false, [], value)).toBeNull();
    }
  });

  it('drops a uuid that is not one of the viewer’s groups once the groups read completed', () => {
    expect(failedFeedScope(true, [OWN], STRANGER)).toBeNull();
    expect(failedFeedScope(true, [], SCOPE_ID)).toBeNull();
  });

  it('keeps the id of one of the viewer’s groups once the groups read completed', () => {
    expect(failedFeedScope(true, [OWN], SCOPE_ID)).toBe(SCOPE_ID);
  });
});
