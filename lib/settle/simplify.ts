import type { MemberBalance } from './balances';

/**
 * Debt simplification (ADR-0005, TR-9).
 *
 * The algorithm is greedy min-cash-flow, and it is stated here with everything it guarantees
 * and everything it does not: repeatedly settle the largest remaining debtor against the
 * largest remaining creditor, in full for whichever of the two runs out first, until nobody is
 * owed anything. Each step zeroes at least one side, so a group of N outstanding seats is
 * settled in at most N-1 transfers and never in a cycle.
 *
 * It does **not** guarantee the fewest transfers possible. That problem is NP-complete
 * (subset-sum), and a claim of optimality would be false; what the product says on screen is
 * what this guarantee is — as few as this algorithm achieves, which is at most one fewer than
 * the number of people.
 *
 * Ties are broken deterministically: the biggest debt first, then the display name, then the
 * membership id. Two runs over the same ledger therefore produce the same list, which is what
 * makes it testable at all.
 */

export interface Transfer {
  fromMembershipId: string;
  fromDisplayName: string;
  toMembershipId: string;
  toDisplayName: string;
  /** Minor units, always positive: a transfer of nothing would be a row with no meaning. */
  amountMinor: number;
}

interface Side {
  membershipId: string;
  displayName: string;
  /** What this side still owes or is still owed, always positive while it is in the list. */
  outstanding: number;
}

function bySizeThenName(left: Side, right: Side): number {
  return (
    right.outstanding - left.outstanding ||
    left.displayName.localeCompare(right.displayName) ||
    left.membershipId.localeCompare(right.membershipId)
  );
}

function side(balance: MemberBalance, outstanding: number): Side {
  return {
    membershipId: balance.membershipId,
    displayName: balance.displayName,
    outstanding,
  };
}

/**
 * The transfers that settle every net in `balances` to zero.
 *
 * An all-zero group — the ordinary state of a group that has settled up — returns nothing at
 * all rather than a list of zeroes; that empty result is what the group page renders as its
 * explicit settled state (TR-9).
 */
export function simplifyDebts(balances: readonly MemberBalance[]): Transfer[] {
  const debtors = balances
    .filter((balance) => balance.balanceMinor < 0)
    .map((balance) => side(balance, -balance.balanceMinor));
  const creditors = balances
    .filter((balance) => balance.balanceMinor > 0)
    .map((balance) => side(balance, balance.balanceMinor));

  const transfers: Transfer[] = [];

  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort(bySizeThenName);
    creditors.sort(bySizeThenName);

    const debtor = debtors[0];
    const creditor = creditors[0];
    const amountMinor = Math.min(debtor.outstanding, creditor.outstanding);

    transfers.push({
      fromMembershipId: debtor.membershipId,
      fromDisplayName: debtor.displayName,
      toMembershipId: creditor.membershipId,
      toDisplayName: creditor.displayName,
      amountMinor,
    });

    debtor.outstanding -= amountMinor;
    creditor.outstanding -= amountMinor;

    // Whichever side is now square leaves the list, so the next pass picks the next largest.
    if (debtor.outstanding === 0) debtors.shift();
    if (creditor.outstanding === 0) creditors.shift();
  }

  return transfers;
}
