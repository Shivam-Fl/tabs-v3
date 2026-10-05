/**
 * The membership rules that need no database (TR-7's non-zero-balance block).
 *
 * The rule itself is a pure function of a balance and a name, so it is proved without a
 * fixture and both callers — removal and leave — go through the same one rather than each
 * deciding for itself what "settled up" means.
 */

/** A removal or a leave the ledger does not allow yet. Carries who and how much, for logs. */
export class NonZeroBalanceError extends Error {
  constructor(
    readonly displayName: string,
    readonly balanceMinor: number,
  ) {
    super(`${displayName} has a non-zero balance. Settle up first, then try again.`);
    this.name = 'NonZeroBalanceError';
  }
}

/**
 * The balance seam. Balances are derived from the expense and payment ledger, which does not
 * exist yet (TR-8, TR-9), so every membership is zero until it does — which is the truthful
 * answer, not a placeholder: with no expenses recorded, nobody owes anybody.
 *
 * TR-9 replaces the body with a read of the ledger for this membership's group. Everything on
 * both sides of it already exists: the callers below check the result, and the actions call
 * through here, so the guard starts doing real work the day the number does.
 */
export function getMemberBalance(_groupId: string, _membershipId: string): number {
  return 0;
}

/** Throws when the membership carries a balance; a no-op at zero. */
export function assertZeroBalance(balanceMinor: number, displayName: string): void {
  if (balanceMinor !== 0) throw new NonZeroBalanceError(displayName, balanceMinor);
}
