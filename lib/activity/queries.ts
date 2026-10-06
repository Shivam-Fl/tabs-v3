import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client';
import { activityEvents, groups, memberships, users } from '../db/schema';
import type { ExpenseEditPayload } from '../expenses/validation';
import { MEMBERSHIP_EVENTS } from '../groups/validation';
import { PAYMENT_EVENTS, type PaymentSnapshot } from '../settle/validation';

/**
 * The activity reads the two feeds render (TR-10, AC-1, AC-5).
 *
 * They sit beside the boundary rather than inside the pages for the reason the expense reads do:
 * "these rows, this order" is one query a test can call, not a `where` clause retyped into each
 * screen where a missing scope looks fine on screen until another group's history appears in the
 * list. Nothing here decides access either — the per-group reader takes the id `guardGroup`
 * authorized, and the cross-group one takes the caller's own user id and derives the groups it
 * may read from their memberships.
 *
 * Three decisions are load-bearing.
 *
 * **One query, ordered once.** The cross-group feed does not loop over the caller's groups and
 * merge the results: it resolves the group ids first and makes a single `IN` query ordered by
 * `created_at desc, id desc`. A per-group loop cannot produce a correct global order without
 * sorting in memory, and its cost grows with every group a person joins.
 *
 * **Archived groups are included.** The membership read behind the cross-group feed has no
 * `archived` filter, so a group that was archived still shows its history in both feeds — which
 * is what makes the group page and the cross-group feed agree about the same events, and what
 * makes archiving a change to what can be *written* rather than a hole in the record.
 *
 * **The subject name is read from the row, not joined.** `activity_event.subject_name` is a
 * snapshot taken when the event was written, because the membership it came from is deleted by
 * the event that records it and a placeholder has no account to join to at all. Resolving it
 * through a join would drop exactly the rows the feed exists to keep.
 */

/** The four chips, and the closed set of values `?activity=` may carry (AC-1). */
export const ACTIVITY_FILTERS = ['all', 'expenses', 'payments', 'members'] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];
export const DEFAULT_ACTIVITY_FILTER: ActivityFilter = 'all';

/** The query key the chip form writes and both pages read. */
export const ACTIVITY_FILTER_PARAM = 'activity';

/**
 * The query key that scopes the cross-group feed to one group (IAC-2).
 *
 * The group page's excerpt is the newest five rows of one group and it links here; without this
 * parameter that link would land the reader on every group at once, which is a different screen
 * from the one the excerpt was showing them. It is a **page-level filter, not a read**: the rows
 * are the caller's own either way, and this narrows what is rendered by `row.groupId`, so no
 * query, endpoint or index changes for it.
 *
 * It lives here, beside the filter key, so the page that writes the link and the page that reads
 * the parameter cannot drift into two spellings of the same thing.
 */
export const ACTIVITY_GROUP_PARAM = 'group';

export const ACTIVITY_FILTER_LABELS: Record<ActivityFilter, string> = {
  all: 'All',
  expenses: 'Expenses',
  payments: 'Payments',
  members: 'Members',
};

/**
 * Which kinds each chip shows. `all` is deliberately absent: it is not a set of kinds but the
 * absence of a filter, which is also what makes an event whose kind nobody planned (a future
 * ticket's) visible under All rather than invisible everywhere.
 *
 * Each set mirrors the module that writes those rows. Payments and the membership events read
 * the writers' own constants so a kind added there cannot be forgotten here; the expense kinds
 * have no such constant, so they are named here and pinned by the queries test.
 */
const FILTER_KINDS: Record<Exclude<ActivityFilter, 'all'>, readonly string[]> = {
  expenses: ['expense-created', 'expense-edited', 'expense-deleted'],
  payments: PAYMENT_EVENTS,
  members: MEMBERSHIP_EVENTS,
};

/** The kind filter for a chip, or undefined for `all` — which is the unfiltered query. */
function kindCondition(filter: ActivityFilter): SQL | undefined {
  if (filter === 'all') return undefined;
  return inArray(activityEvents.kind, [...FILTER_KINDS[filter]]);
}

/**
 * The filter a URL carries, or `all`.
 *
 * A value that is not one of ours — a chip somebody hand-edited, a stale bookmark, a typo — is
 * not refused. This is a filter on a feed somebody is reading, and the useful answer to a bad
 * filter is every row with the chips still on screen, not an error card (AC-1).
 */
export function activityFilterFrom(raw: string | undefined): ActivityFilter {
  const value = (raw ?? '').trim().toLowerCase();
  return (ACTIVITY_FILTERS as readonly string[]).includes(value)
    ? (value as ActivityFilter)
    : DEFAULT_ACTIVITY_FILTER;
}

/** One row of either feed, already resolved into the names and links a view renders. */
export interface ActivityRow {
  id: string;
  /** The stored kind. Anything the chips do not name still renders, under `all`. */
  kind: string;
  groupId: string;
  groupName: string;
  /** Archived groups stay in the feed; a row in one links to the group rather than to an editor. */
  groupArchived: boolean;
  /** The group's currency, so a payment or an edited amount is formatted in it (AC-1, AC-9). */
  currency: string;
  /** Who did it. Never null in practice: an actor's row cascades with their account. */
  actorName: string;
  /** Who or what it happened to, as it was named at the time. */
  subjectName: string;
  createdAt: Date;
  /** The expense this row is about, or null once that expense is deleted. */
  expenseId: string | null;
  /** The payment this row is about, or null once that payment is deleted. */
  paymentId: string | null;
  /** The before/after of an edit, or a payment's snapshot; null on the events that need neither. */
  payload: ExpenseEditPayload | PaymentSnapshot | null;
}

/**
 * The columns both feeds select, so a field added to one cannot go missing from the other.
 *
 * The group join is what puts a name, a currency and an archived flag on every row, which is
 * what lets one component render both feeds — and the actor join is a LEFT JOIN so a row can
 * never be dropped for want of a name.
 */
const ACTIVITY_COLUMNS = {
  id: activityEvents.id,
  kind: activityEvents.kind,
  groupId: activityEvents.groupId,
  groupName: groups.name,
  groupArchived: groups.archived,
  currency: groups.currency,
  actorName: users.displayName,
  subjectName: activityEvents.subjectName,
  createdAt: activityEvents.createdAt,
  expenseId: activityEvents.expenseId,
  paymentId: activityEvents.paymentId,
  payload: activityEvents.payload,
};

/**
 * The actor's row always exists: `actor_user_id` cascades with the account, so deleting the
 * person deletes the events they caused rather than leaving an event with no actor. The
 * fallback is therefore unreachable and exists only so the row type is total — it is not a
 * name the feed can ever show.
 */
function asRow(row: {
  id: string;
  kind: string;
  groupId: string;
  groupName: string;
  groupArchived: boolean;
  currency: string;
  actorName: string | null;
  subjectName: string;
  createdAt: Date;
  expenseId: string | null;
  paymentId: string | null;
  payload: ExpenseEditPayload | PaymentSnapshot | null;
}): ActivityRow {
  return { ...row, actorName: row.actorName ?? '' };
}

/**
 * The order both feeds read in: newest first, and total.
 *
 * `created_at` alone is not enough. It defaults to the transaction clock, so several rows
 * written in one transaction share it to the microsecond — which is exactly how the seed writes
 * its fixtures and how a future bulk write would — and an order that ties would put them in a
 * different sequence on every read. The id breaks the tie so the feed is stable.
 */
const ACTIVITY_ORDER = [desc(activityEvents.createdAt), desc(activityEvents.id)] as const;

/**
 * One group's events, newest first (AC-1).
 *
 * The group id is the one `guardGroup` authorized: this decides nothing about who may read it,
 * and its failure mode is an empty feed rather than a leak.
 */
export async function listGroupActivity(
  db: Db,
  groupId: string,
  filter: ActivityFilter,
): Promise<ActivityRow[]> {
  const kind = kindCondition(filter);
  const scope = eq(activityEvents.groupId, groupId);

  const rows = await db
    .select(ACTIVITY_COLUMNS)
    .from(activityEvents)
    .innerJoin(groups, eq(groups.id, activityEvents.groupId))
    .leftJoin(users, eq(users.id, activityEvents.actorUserId))
    .where(kind ? and(scope, kind) : scope)
    .orderBy(...ACTIVITY_ORDER);

  return rows.map(asRow);
}

/** A group the caller holds a seat in, archived or not — the scope of the cross-group feed. */
export interface ActivityGroup {
  id: string;
  name: string;
  archived: boolean;
  currency: string;
}

/**
 * Every group the caller belongs to, archived included, by name.
 *
 * This is the cross-group feed's scope, and it is the question TR-3 asks: the caller's own
 * memberships, not a group list filtered by anything else. The page reads it as well as the
 * feed so it can tell "no groups yet" from "all your groups are archived" from "nothing has
 * happened" — three empty screens that would otherwise read identically.
 */
export async function listActivityGroups(db: Db, userId: string): Promise<ActivityGroup[]> {
  return db
    .select({
      id: groups.id,
      name: groups.name,
      archived: groups.archived,
      currency: groups.currency,
    })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(groups.name), asc(groups.id));
}

/**
 * The cross-group feed: every event in every group the caller belongs to, in one global order
 * (AC-5).
 *
 * Two reads, both bounded. The membership read is the authorization — a group the caller is not
 * in contributes no id and therefore no event — and the activity read is a single `IN` query
 * over those ids, so the ordering is the database's and does not depend on how many groups the
 * caller happens to be in. Archived groups are in scope on purpose: archiving stops writes, it
 * does not erase history.
 */
export async function listUserActivity(
  db: Db,
  userId: string,
  filter: ActivityFilter,
): Promise<ActivityRow[]> {
  const visible = await listActivityGroups(db, userId);
  // Nobody in a group reads no events. Returning early rather than passing an empty list keeps
  // the compiled statement a query with a scope in it, which is the same shape for the planner
  // as any other.
  if (visible.length === 0) return [];

  const kind = kindCondition(filter);
  const scope = inArray(
    activityEvents.groupId,
    visible.map((group) => group.id),
  );

  const rows = await db
    .select(ACTIVITY_COLUMNS)
    .from(activityEvents)
    .innerJoin(groups, eq(groups.id, activityEvents.groupId))
    .leftJoin(users, eq(users.id, activityEvents.actorUserId))
    .where(kind ? and(scope, kind) : scope)
    .orderBy(...ACTIVITY_ORDER);

  return rows.map(asRow);
}
