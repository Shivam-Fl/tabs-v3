import { describe, expect, it } from 'vitest';
import type { MemberBalance } from './balances';
import { simplifyDebts, type Transfer } from './simplify';

/**
 * Debt simplification (ADR-0005, AC-6).
 *
 * The function is pure, so these cases are fixtures rather than a database: a set of nets in, a
 * list of transfers out. What they pin is the guarantee the product actually makes — every side
 * ends at zero, in at most N-1 transfers, in a deterministic order — and not the stronger claim
 * the algorithm cannot support, which is that no shorter list exists.
 */

function balance(membershipId: string, displayName: string, balanceMinor: number): MemberBalance {
  return { membershipId, userId: null, displayName, balanceMinor };
}

/** Apply a plan to the nets it was made from; a correct plan leaves every one at zero. */
function settle(balances: readonly MemberBalance[], transfers: readonly Transfer[]): number[] {
  const nets = new Map(balances.map((entry) => [entry.membershipId, entry.balanceMinor]));

  for (const transfer of transfers) {
    nets.set(
      transfer.fromMembershipId,
      (nets.get(transfer.fromMembershipId) ?? 0) + transfer.amountMinor,
    );
    nets.set(
      transfer.toMembershipId,
      (nets.get(transfer.toMembershipId) ?? 0) - transfer.amountMinor,
    );
  }

  return [...nets.values()];
}

describe('simplifyDebts', () => {
  it('returns nothing at all for a group with nothing outstanding', () => {
    expect(
      simplifyDebts([
        balance('a', 'Ada', 0),
        balance('b', 'Bo', 0),
        balance('c', 'Cy', 0),
      ]),
    ).toEqual([]);
    expect(simplifyDebts([])).toEqual([]);
  });

  it('settles two people with one transfer, from the debtor to the creditor', () => {
    const balances = [balance('a', 'Ada', 1000), balance('b', 'Bo', -1000)];

    expect(simplifyDebts(balances)).toEqual([
      {
        fromMembershipId: 'b',
        fromDisplayName: 'Bo',
        toMembershipId: 'a',
        toDisplayName: 'Ada',
        amountMinor: 1000,
      },
    ]);
  });

  it('settles the largest debtor against the largest creditor, one side at a time', () => {
    // Cy owes 20, Bo owes 10, Ada is owed 30: Cy clears against Ada in full, then Bo does.
    const balances = [
      balance('a', 'Ada', 3000),
      balance('b', 'Bo', -1000),
      balance('c', 'Cy', -2000),
    ];

    expect(simplifyDebts(balances)).toEqual([
      {
        fromMembershipId: 'c',
        fromDisplayName: 'Cy',
        toMembershipId: 'a',
        toDisplayName: 'Ada',
        amountMinor: 2000,
      },
      {
        fromMembershipId: 'b',
        fromDisplayName: 'Bo',
        toMembershipId: 'a',
        toDisplayName: 'Ada',
        amountMinor: 1000,
      },
    ]);
  });

  it('never emits more transfers than one fewer than the number of outstanding seats', () => {
    const balances = [
      balance('a', 'Ada', 5000),
      balance('b', 'Bo', 3000),
      balance('c', 'Cy', -2000),
      balance('d', 'Dee', -2000),
      balance('e', 'Eve', -2500),
      balance('f', 'Fay', -1500),
    ];

    const transfers = simplifyDebts(balances);

    expect(transfers.length).toBeLessThanOrEqual(balances.length - 1);
    expect(settle(balances, transfers).every((net) => net === 0)).toBe(true);
  });

  it('pays every transfer forward and in a positive amount', () => {
    const balances = [
      balance('a', 'Ada', 3333),
      balance('b', 'Bo', -1111),
      balance('c', 'Cy', -2222),
    ];

    for (const transfer of simplifyDebts(balances)) {
      expect(transfer.amountMinor).toBeGreaterThan(0);
      expect(transfer.fromMembershipId).not.toBe(transfer.toMembershipId);
    }
  });

  it('breaks ties by display name and then by id, so the same ledger always plans the same way', () => {
    const balances = [
      balance('z', 'Zoe', -1000),
      balance('b', 'Bo', -1000),
      balance('a', 'Ada', 2000),
    ];

    const transfers = simplifyDebts(balances);

    // Bo sorts before Zoe, so Bo's transfer comes first — and reversing the input does not
    // change the output, which is what makes a plan diffable and testable at all.
    expect(transfers.map((transfer) => transfer.fromDisplayName)).toEqual(['Bo', 'Zoe']);
    expect(simplifyDebts([...balances].reverse())).toEqual(transfers);
  });

  it('carries the names the nets were read under, departed seats included', () => {
    const balances = [
      balance('a', 'Ada', 1000),
      balance('b', 'Seat 2', -1000),
    ];

    expect(simplifyDebts(balances)[0]).toMatchObject({
      fromDisplayName: 'Seat 2',
      toDisplayName: 'Ada',
    });
  });
});
