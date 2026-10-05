import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { expensePayers, expenses, groups, memberships, splitLines, users } from '../db/schema';
import { splitAmount } from '../money/splits';
import { NonZeroBalanceError, assertZeroBalance, getMemberBalance } from './members';

/**
 * The removal rule and the seam it reads (TR-9).
 *
 * `assertZeroBalance` is still proved without a database — it is a function of a number and a
 * name — but the number it is handed comes from the ledger now, so `getMemberBalance` is proved
 * against a real one: the same group, the same expense, read through the one recompute path the
 * group page reads. A guard tested against a constant would pass on the day it stopped agreeing
 * with the page it is protecting, which is exactly the failure this pair of tests exists to catch.
 */

let adaId: string;
let boId: string;
let groupId: string;
let ada: string;
let bo: string;

async function createAccount(email: string, displayName: string): Promise<string> {
  const [user] = await withDb((handle) =>
    handle.db
      .insert(users)
      .values({ email, passwordHash: 'x', displayName })
      .returning({ id: users.id }),
  );
  return user.id;
}

beforeAll(async () => {
  await withDb((handle) => runMigrations(handle.db));
});

beforeEach(async () => {
  await withDb(async (handle) => {
    await handle.db.delete(expensePayers);
    await handle.db.delete(splitLines);
    await handle.db.delete(expenses);
    await handle.db.delete(memberships);
    await handle.db.delete(groups);
    await handle.db.delete(users);
  });

  adaId = await createAccount('ada@example.co', 'Ada');
  boId = await createAccount('bo@example.co', 'Bo');

  ({ groupId, ada, bo } = await withDb(async (handle) => {
    const [group] = await handle.db
      .insert(groups)
      .values({ name: 'Goa trip', currency: 'INR', type: 'trip' })
      .returning({ id: groups.id });

    const [adaSeat] = await handle.db
      .insert(memberships)
      .values({ groupId: group.id, userId: adaId, displayName: 'Ada', role: 'owner' })
      .returning({ id: memberships.id });

    const [boSeat] = await handle.db
      .insert(memberships)
      .values({ groupId: group.id, userId: boId, displayName: 'Bo', role: 'member' })
      .returning({ id: memberships.id });

    return { groupId: group.id, ada: adaSeat.id, bo: boSeat.id };
  }));
});

/** Ada pays 30, split equally between the two of them: 15 each. */
async function recordDinner(): Promise<void> {
  await withDb(async (handle) => {
    const [expense] = await handle.db
      .insert(expenses)
      .values({
        groupId,
        description: 'Dinner',
        amountMinor: 3000,
        date: '2026-10-05',
        category: 'food',
        splitType: 'equal',
      })
      .returning({ id: expenses.id });

    await handle.db.insert(expensePayers).values({
      expenseId: expense.id,
      membershipId: ada,
      displayName: 'Ada',
      amountMinor: 3000,
      position: 0,
    });

    const shares = splitAmount(3000, 'equal', [
      { membershipId: ada, included: true, value: null },
      { membershipId: bo, included: true, value: null },
    ]);

    for (const share of shares) {
      await handle.db.insert(splitLines).values({
        expenseId: expense.id,
        membershipId: share.membershipId,
        displayName: share.membershipId === ada ? 'Ada' : 'Bo',
        shareMinor: share.shareMinor,
      });
    }
  });
}

describe('assertZeroBalance', () => {
  it('passes a settled membership through', () => {
    expect(() => assertZeroBalance(0, 'Bo')).not.toThrow();
  });

  it('throws for a membership whose balance is not zero, pointing at settle-up', () => {
    expect(() => assertZeroBalance(500, 'Bo')).toThrow(NonZeroBalanceError);

    try {
      assertZeroBalance(500, 'Bo');
      throw new Error('expected the guard to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(NonZeroBalanceError);
      if (!(error instanceof NonZeroBalanceError)) return;

      expect(error.message).toContain('Bo');
      expect(error.message).toMatch(/settle up/i);
      expect(error.displayName).toBe('Bo');
      expect(error.balanceMinor).toBe(500);
    }
  });

  it('treats a negative balance as unsettled too — owing the group is not settled', () => {
    expect(() => assertZeroBalance(-1, 'Bo')).toThrow(NonZeroBalanceError);
  });
});

describe('getMemberBalance', () => {
  it('is zero for a membership the group’s ledger has never mentioned', async () => {
    expect(await withDb((handle) => getMemberBalance(handle.db, groupId, bo))).toBe(0);
  });

  it('reads the seat’s share of the ledger: payer credited, sharer debited', async () => {
    await recordDinner();

    // Ada paid the 30 and owes 15 of it; Bo owes their 15. The guard reads what the group page
    // shows, so a removal blocked here is blocked by the number the member can see.
    expect(await withDb((handle) => getMemberBalance(handle.db, groupId, ada))).toBe(1500);
    expect(await withDb((handle) => getMemberBalance(handle.db, groupId, bo))).toBe(-1500);
  });
});
