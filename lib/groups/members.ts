import type { Db } from '../db/client';
import { memberBalanceMinor } from '../settle/balances';
import { nonZeroBalanceMessage } from './validation';

/**
 * The membership rules that need a balance (TR-7's non-zero-balance block, TR-9's derivation).
 *
 * The rule itself is a pure function of a balance and a name, so it is proved without a
 * fixture and both callers — removal and leave — go through the same one rather than each
 * deciding for itself what "settled up" means.
 */

/**
 * A removal or a leave the ledger does not allow yet. Carries who and how much, for logs.
 *
 * The sentence comes from `validation.ts` rather than being written here, because the members
 * panel classifies the message it gets back to decide whether to offer a settle-up link — and a
 * private copy here would let the thrower and the classifier drift into two sentences that no
 * longer match (AC-2).
 */
export class NonZeroBalanceError extends Error {
  constructor(
    readonly displayName: string,
    readonly balanceMinor: number,
  ) {
    super(nonZeroBalanceMessage(displayName));
    this.name = 'NonZeroBalanceError';
  }
}

/**
 * What one membership's seat in its group's ledger is worth right now, in minor units.
 *
 * The number is derived, never stored, and it comes from the same recompute path every screen
 * reads (TR-9), so "settled up" here means exactly what the balance shown beside the member
 * means — a guard that had its own arithmetic would be free to disagree with the page it is
 * protecting, which is the one thing a guard must never do.
 *
 * A membership this group's ledger has never mentioned is zero: a member with no expenses and
 * no payments is settled up, and removing them strands nothing.
 */
export async function getMemberBalance(
  db: Db,
  groupId: string,
  membershipId: string,
): Promise<number> {
  return memberBalanceMinor(db, groupId, membershipId);
}

/** Throws when the membership carries a balance; a no-op at zero. */
export function assertZeroBalance(balanceMinor: number, displayName: string): void {
  if (balanceMinor !== 0) throw new NonZeroBalanceError(displayName, balanceMinor);
}
