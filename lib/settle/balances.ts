import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { expensePayers, expenses, memberships, payments, splitLines } from '../db/schema';

/**
 * The one recompute path (TR-9, invariants).
 *
 * A balance is never stored: it is what the ledger says right now, derived here and nowhere
 * else, so the group page, the members page, the home screen and the non-zero-balance guard on
 * removal cannot disagree about a number. Every screen and every guard reads this function; the
 * only writes anything else makes are to the ledger it reads.
 *
 * The arithmetic is one line per membership: what they paid, minus what they owe, plus what they
 * have since paid out, minus what they have since been paid. In minor units, integers throughout
 * — a payment is the mirror image of a share, and the ledger's rows already sum to their
 * expenses, so the nets sum to zero by construction rather than by rounding.
 *
 * The direction of the payment terms is the one thing here that is easy to get backwards, so it
 * is stated as the thing it must achieve: a payment exists to move two seats *towards* zero.
 * Somebody who owed 20 and hands over 20 must end at zero, so the money's **sender** moves up
 * (their debt is discharged) and its **recipient** moves down (what the group owed them is
 * settled). The opposite sign would make recording a payment deepen the very debt it was
 * recorded to clear, which is how this was caught — by the case that settles a group to zero.
 *
 * Two classes of seat appear, and both matter:
 *
 * - every **current member**, in the group's own order, including members no expense has touched
 *   yet — their row is a real zero, not a missing one, and a screen that omitted it would be
 *   making the reader wonder where somebody went;
 * - every **departed ledger participant** (ADR-0007): a seat whose membership row is deleted
 *   still owns its payer parts, its shares and its payments, so its net is still true and has to
 *   appear or the group's numbers would stop summing to zero. It is named from the snapshot each
 *   ledger row carries, most recent first, because the seat itself is no longer there to be
 *   asked.
 */

export interface MemberBalance {
  membershipId: string;
  /** Null for a placeholder and for a departed seat: neither has an account to point at. */
  userId: string | null;
  /** The live name for a current member; the snapshot the ledger kept, for a departed seat. */
  displayName: string;
  /** Minor units. Positive: the group owes them. Negative: they owe the group. */
  balanceMinor: number;
}

interface LedgerEntry {
  displayName: string;
  /** When the row that gave this name was written, so the newest snapshot wins. */
  at: number;
  balanceMinor: number;
}

interface LedgerRow {
  membershipId: string;
  displayName: string;
  amountMinor: number;
  at: Date;
}

/**
 * Every seat this group's ledger mentions, with the name its most recent row carried. A seat
 * whose ledger rows disagree — a placeholder claimed and renamed between two expenses — reads
 * under the newest name, which is the one the last write stood behind.
 */
function foldLedgerRows(
  entries: Map<string, LedgerEntry>,
  rows: readonly LedgerRow[],
  sign: 1 | -1,
): void {
  for (const row of rows) {
    const entry = entries.get(row.membershipId) ?? {
      displayName: row.displayName,
      at: Number.NEGATIVE_INFINITY,
      balanceMinor: 0,
    };

    entry.balanceMinor += sign * row.amountMinor;

    const at = row.at.getTime();
    if (at > entry.at) {
      entry.at = at;
      entry.displayName = row.displayName;
    }

    entries.set(row.membershipId, entry);
  }
}

/**
 * One group's net balance per membership, current members first in the group's own order and
 * departed participants behind them, each sorted by their snapshot name.
 *
 * The reads are sequential rather than concurrent on purpose: the embedded backend serves one
 * connection, so two queries in flight together are a queue pretending to be a race.
 */
export async function computeNetBalances(db: Db, groupId: string): Promise<MemberBalance[]> {
  const seats = await db
    .select({
      id: memberships.id,
      userId: memberships.userId,
      displayName: memberships.displayName,
    })
    .from(memberships)
    .where(eq(memberships.groupId, groupId))
    .orderBy(asc(memberships.createdAt), asc(memberships.id));

  // What each seat paid towards an expense: credit.
  const paid = await db
    .select({
      membershipId: expensePayers.membershipId,
      displayName: expensePayers.displayName,
      amountMinor: expensePayers.amountMinor,
      at: expenses.createdAt,
    })
    .from(expensePayers)
    .innerJoin(expenses, eq(expenses.id, expensePayers.expenseId))
    .where(eq(expenses.groupId, groupId));

  // What each seat owes of it: debit.
  const owed = await db
    .select({
      membershipId: splitLines.membershipId,
      displayName: splitLines.displayName,
      amountMinor: splitLines.shareMinor,
      at: expenses.createdAt,
    })
    .from(splitLines)
    .innerJoin(expenses, eq(expenses.id, splitLines.expenseId))
    .where(eq(expenses.groupId, groupId));

  // Money a seat handed over to settle up: what they owed is discharged, so their net moves up.
  const sent = await db
    .select({
      membershipId: payments.fromMembershipId,
      displayName: payments.fromDisplayName,
      amountMinor: payments.amountMinor,
      at: payments.createdAt,
    })
    .from(payments)
    .where(eq(payments.groupId, groupId));

  // Money a seat was paid: what the group owed them is settled, so their net moves down.
  const received = await db
    .select({
      membershipId: payments.toMembershipId,
      displayName: payments.toDisplayName,
      amountMinor: payments.amountMinor,
      at: payments.createdAt,
    })
    .from(payments)
    .where(eq(payments.groupId, groupId));

  const entries = new Map<string, LedgerEntry>();
  foldLedgerRows(entries, paid, 1);
  foldLedgerRows(entries, owed, -1);
  foldLedgerRows(entries, sent, 1);
  foldLedgerRows(entries, received, -1);

  const balances: MemberBalance[] = seats.map((seat) => ({
    membershipId: seat.id,
    userId: seat.userId,
    displayName: seat.displayName,
    balanceMinor: entries.get(seat.id)?.balanceMinor ?? 0,
  }));

  const current = new Set(seats.map((seat) => seat.id));
  const departed = [...entries.entries()]
    .filter(([membershipId]) => !current.has(membershipId))
    .sort(
      ([leftId, left], [rightId, right]) =>
        left.displayName.localeCompare(right.displayName) || leftId.localeCompare(rightId),
    );

  for (const [membershipId, entry] of departed) {
    balances.push({
      membershipId,
      userId: null,
      displayName: entry.displayName,
      balanceMinor: entry.balanceMinor,
    });
  }

  return balances;
}

/** One membership's net, or zero for a seat the group's ledger has never mentioned. */
export async function memberBalanceMinor(
  db: Db,
  groupId: string,
  membershipId: string,
): Promise<number> {
  const balances = await computeNetBalances(db, groupId);
  return balances.find((balance) => balance.membershipId === membershipId)?.balanceMinor ?? 0;
}
