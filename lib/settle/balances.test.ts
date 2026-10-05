import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client';
import { withDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import {
  expensePayers,
  expenses,
  groups,
  memberships,
  payments,
  splitLines,
  users,
} from '../db/schema';
import { splitAmount, type SplitInput, type SplitType } from '../money/splits';
import { computeNetBalances, memberBalanceMinor, type MemberBalance } from './balances';

/**
 * The one recompute path, against a real ledger (TR-9, AC-6).
 *
 * The fixtures are written the way the expense editor writes them — the payer rows it stores and
 * the split lines `splitAmount` produces for the type the expense names — because the point of
 * these cases is that all four split types, a multi-payer expense and a payment all land in the
 * same four folds of arithmetic rather than each being a special case.
 *
 * Every case also asserts the property that makes the whole design work: the nets sum to zero.
 * A balance that is derived can still be wrong, and the sum is the cheapest way to notice.
 */

let adaId: string;
let boId: string;
let cyId: string;
let groupId: string;
let ada: string;
let bo: string;
let cy: string;
let counter = 0;

async function createAccount(email: string, displayName: string): Promise<string> {
  const [user] = await withDb((handle) =>
    handle.db
      .insert(users)
      .values({ email, passwordHash: 'x', displayName })
      .returning({ id: users.id }),
  );
  return user.id;
}

/**
 * One expense, with the payers and the shares the editor would have stored.
 *
 * The payer parts are given as minor units directly — a multi-payer expense is several of them —
 * and the split lines come from the money core, so the arithmetic under test is the balances
 * module's folding and not a second implementation of it.
 */
async function recordExpense(spec: {
  description: string;
  amountMinor: number;
  splitType: SplitType;
  payers: Array<{ seat: string; name: string; amountMinor: number }>;
  splits: Array<{ seat: string; name: string; included: boolean; value: number | null }>;
}): Promise<string> {
  counter += 1;

  return withDb(async (handle) => {
    const [expense] = await handle.db
      .insert(expenses)
      .values({
        groupId,
        description: spec.description,
        amountMinor: spec.amountMinor,
        date: '2026-10-05',
        category: 'food',
        splitType: spec.splitType,
        // Pinned so "the newest ledger row names the seat" is decided by the test, not the clock.
        createdAt: new Date(Date.parse('2026-01-01T00:00:00Z') + counter * 60_000),
      })
      .returning({ id: expenses.id });

    for (const [position, payer] of spec.payers.entries()) {
      await handle.db.insert(expensePayers).values({
        expenseId: expense.id,
        membershipId: payer.seat,
        displayName: payer.name,
        amountMinor: payer.amountMinor,
        position,
      });
    }

    const inputs: SplitInput[] = spec.splits.map((split) => ({
      membershipId: split.seat,
      included: split.included,
      value: split.value,
    }));

    const shares = splitAmount(
      spec.amountMinor,
      spec.splitType,
      inputs,
      spec.payers.map((payer) => payer.seat),
    );

    for (const share of shares) {
      const line = spec.splits.find((split) => split.seat === share.membershipId);
      await handle.db.insert(splitLines).values({
        expenseId: expense.id,
        membershipId: share.membershipId,
        displayName: line?.name ?? 'Unknown',
        included: line?.included ?? true,
        inputValue: line?.value ?? null,
        shareMinor: share.shareMinor,
      });
    }

    return expense.id;
  });
}

async function recordPayment(spec: {
  from: { seat: string; name: string };
  to: { seat: string; name: string };
  amountMinor: number;
  at: string;
}): Promise<string> {
  return withDb(async (handle) => {
    const [payment] = await handle.db
      .insert(payments)
      .values({
        groupId,
        fromMembershipId: spec.from.seat,
        fromDisplayName: spec.from.name,
        toMembershipId: spec.to.seat,
        toDisplayName: spec.to.name,
        amountMinor: spec.amountMinor,
        createdAt: new Date(Date.parse(spec.at)),
      })
      .returning({ id: payments.id });

    return payment.id;
  });
}

async function netOf(seat: string): Promise<number> {
  const balances = await withDb((handle) => computeNetBalances(handle.db, groupId));
  return balances.find((balance) => balance.membershipId === seat)?.balanceMinor ?? 0;
}

async function read(): Promise<MemberBalance[]> {
  return withDb((handle) => computeNetBalances(handle.db, groupId));
}

function expectZeroSum(balances: readonly MemberBalance[]): void {
  expect(balances.reduce((sum, balance) => sum + balance.balanceMinor, 0)).toBe(0);
}

function balanceOf(balances: readonly MemberBalance[], seat: string): MemberBalance {
  const found = balances.find((balance) => balance.membershipId === seat);
  if (!found) throw new Error(`no balance for ${seat}`);
  return found;
}

beforeAll(async () => {
  await withDb((handle) => runMigrations(handle.db));
});

beforeEach(async () => {
  await withDb(async (handle) => {
    await handle.db.delete(payments);
    await handle.db.delete(expensePayers);
    await handle.db.delete(splitLines);
    await handle.db.delete(expenses);
    await handle.db.delete(memberships);
    await handle.db.delete(groups);
    await handle.db.delete(users);
  });

  adaId = await createAccount('ada@example.co', 'Ada');
  boId = await createAccount('bo@example.co', 'Bo');
  cyId = await createAccount('cy@example.co', 'Cy');

  ({ groupId, ada, bo, cy } = await withDb(async (handle) => {
    const [group] = await handle.db
      .insert(groups)
      .values({ name: 'Goa trip', currency: 'INR', type: 'trip' })
      .returning({ id: groups.id });

    const seats: string[] = [];
    const joinedAt = Date.parse('2026-01-01T00:00:00Z');
    for (const [index, userId] of [adaId, boId, cyId].entries()) {
      const [seat] = await handle.db
        .insert(memberships)
        .values({
          groupId: group.id,
          userId,
          displayName: ['Ada', 'Bo', 'Cy'][index],
          role: index === 0 ? 'owner' : 'member',
          createdAt: new Date(joinedAt + index * 60_000),
        })
        .returning({ id: memberships.id });
      seats.push(seat.id);
    }

    return { groupId: group.id, ada: seats[0], bo: seats[1], cy: seats[2] };
  }));
});

describe('computeNetBalances', () => {
  it('lists every current member at the group’s own order, untouched ones at zero', async () => {
    await recordExpense({
      description: 'Dinner',
      amountMinor: 3000,
      splitType: 'equal',
      payers: [{ seat: ada, name: 'Ada', amountMinor: 3000 }],
      splits: [
        { seat: ada, name: 'Ada', included: true, value: null },
        { seat: bo, name: 'Bo', included: true, value: null },
      ],
    });

    const balances = await read();

    // Cy is in nothing, and Cy is still on the list: a member with a real zero is not a member
    // the screen is allowed to omit.
    expect(balances.map((balance) => balance.membershipId)).toEqual([ada, bo, cy]);
    expect(balanceOf(balances, cy)).toMatchObject({ balanceMinor: 0, displayName: 'Cy' });
    expectZeroSum(balances);
  });

  it('folds an equal split: the payer is credited the whole, every sharer debited a share', async () => {
    await recordExpense({
      description: 'Dinner',
      amountMinor: 3000,
      splitType: 'equal',
      payers: [{ seat: ada, name: 'Ada', amountMinor: 3000 }],
      splits: [
        { seat: ada, name: 'Ada', included: true, value: null },
        { seat: bo, name: 'Bo', included: true, value: null },
        { seat: cy, name: 'Cy', included: true, value: null },
      ],
    });

    expect(await netOf(ada)).toBe(2000);
    expect(await netOf(bo)).toBe(-1000);
    expect(await netOf(cy)).toBe(-1000);
  });

  it('folds an exact split with two payers, where parts and shares differ', async () => {
    await recordExpense({
      description: 'Cab',
      amountMinor: 3000,
      splitType: 'exact',
      payers: [
        { seat: ada, name: 'Ada', amountMinor: 1000 },
        { seat: bo, name: 'Bo', amountMinor: 2000 },
      ],
      splits: [
        { seat: ada, name: 'Ada', included: true, value: 500 },
        { seat: bo, name: 'Bo', included: true, value: 1000 },
        { seat: cy, name: 'Cy', included: true, value: 1500 },
      ],
    });

    // Ada paid 10 and owes 5; Bo paid 20 and owes 10; Cy paid nothing and owes 15.
    expect(await netOf(ada)).toBe(500);
    expect(await netOf(bo)).toBe(1000);
    expect(await netOf(cy)).toBe(-1500);
  });

  it('folds a percentage split', async () => {
    await recordExpense({
      description: 'Hotel',
      amountMinor: 10_000,
      splitType: 'percentage',
      payers: [{ seat: cy, name: 'Cy', amountMinor: 10_000 }],
      splits: [
        { seat: ada, name: 'Ada', included: true, value: 5000 },
        { seat: bo, name: 'Bo', included: true, value: 3000 },
        { seat: cy, name: 'Cy', included: true, value: 2000 },
      ],
    });

    expect(await netOf(ada)).toBe(-5000);
    expect(await netOf(bo)).toBe(-3000);
    expect(await netOf(cy)).toBe(8000);
  });

  it('folds a shares split and gives the rounding remainder to the first payer', async () => {
    // 10.00 over shares 1/1/1 cannot divide: two get 333 and the payer takes the odd minor unit.
    await recordExpense({
      description: 'Snacks',
      amountMinor: 1000,
      splitType: 'shares',
      payers: [{ seat: bo, name: 'Bo', amountMinor: 1000 }],
      splits: [
        { seat: ada, name: 'Ada', included: true, value: 1 },
        { seat: bo, name: 'Bo', included: true, value: 1 },
        { seat: cy, name: 'Cy', included: true, value: 1 },
      ],
    });

    const balances = await read();

    expect(await netOf(ada)).toBe(-333);
    expect(await netOf(cy)).toBe(-333);
    // Bo paid the 1000, owes 333, and absorbed the 334th minor unit the division stranded.
    expect(await netOf(bo)).toBe(666);
    expectZeroSum(balances);
  });

  it('leaves a member who is out of the split owing nothing', async () => {
    await recordExpense({
      description: 'Dinner',
      amountMinor: 2000,
      splitType: 'equal',
      payers: [{ seat: ada, name: 'Ada', amountMinor: 2000 }],
      splits: [
        { seat: ada, name: 'Ada', included: true, value: null },
        { seat: bo, name: 'Bo', included: true, value: null },
        { seat: cy, name: 'Cy', included: false, value: null },
      ],
    });

    expect(await netOf(cy)).toBe(0);
    expect(await netOf(ada)).toBe(1000);
    expect(await netOf(bo)).toBe(-1000);
  });

  it('moves the recipient of a payment up and its payer down, and settles the group', async () => {
    await recordExpense({
      description: 'Dinner',
      amountMinor: 3000,
      splitType: 'equal',
      payers: [{ seat: ada, name: 'Ada', amountMinor: 3000 }],
      splits: [
        { seat: ada, name: 'Ada', included: true, value: null },
        { seat: bo, name: 'Bo', included: true, value: null },
        { seat: cy, name: 'Cy', included: true, value: null },
      ],
    });

    await recordPayment({
      from: { seat: bo, name: 'Bo' },
      to: { seat: ada, name: 'Ada' },
      amountMinor: 1000,
      at: '2026-02-01T00:00:00Z',
    });

    // Bo paid what they owed, so Bo and Ada are square; Cy still owes their share.
    const balances = await read();
    expect(balanceOf(balances, bo).balanceMinor).toBe(0);
    expect(balanceOf(balances, ada).balanceMinor).toBe(1000);
    expect(balanceOf(balances, cy).balanceMinor).toBe(-1000);
    expectZeroSum(balances);
  });

  it('keeps a departed seat’s net and name, so the group still sums to zero', async () => {
    await recordExpense({
      description: 'Dinner',
      amountMinor: 3000,
      splitType: 'equal',
      payers: [{ seat: ada, name: 'Ada', amountMinor: 3000 }],
      splits: [
        { seat: ada, name: 'Ada', included: true, value: null },
        { seat: bo, name: 'Bo', included: true, value: null },
        { seat: cy, name: 'Cy', included: true, value: null },
      ],
    });

    await withDb((handle) => handle.db.delete(memberships).where(eq(memberships.id, bo)));

    const balances = await read();
    const departed = balanceOf(balances, bo);

    // The seat is gone; what it owes is not. It reads under the name its ledger rows kept, and
    // it sits after the current members rather than among them (ADR-0007).
    expect(departed).toMatchObject({ displayName: 'Bo', balanceMinor: -1000, userId: null });
    expect(balances.map((balance) => balance.membershipId)).toEqual([ada, cy, bo]);
    expectZeroSum(balances);
  });

  it('names a departed seat from its newest ledger row, not its oldest', async () => {
    await recordExpense({
      description: 'Dinner',
      amountMinor: 3000,
      splitType: 'equal',
      payers: [{ seat: ada, name: 'Ada', amountMinor: 3000 }],
      splits: [
        { seat: ada, name: 'Ada', included: true, value: null },
        { seat: bo, name: 'Seat 2', included: true, value: null },
      ],
    });
    await recordPayment({
      from: { seat: bo, name: 'Bo' },
      to: { seat: ada, name: 'Ada' },
      amountMinor: 500,
      at: '2026-02-01T00:00:00Z',
    });

    await withDb((handle) => handle.db.delete(memberships).where(eq(memberships.id, bo)));

    // The seat was renamed between the expense and the payment; the later row is the one the
    // last write stood behind.
    expect(balanceOf(await read(), bo).displayName).toBe('Bo');
  });

  it('reads one membership’s net through the same path, zero for a seat it never touched', async () => {
    await recordExpense({
      description: 'Dinner',
      amountMinor: 2000,
      splitType: 'equal',
      payers: [{ seat: ada, name: 'Ada', amountMinor: 2000 }],
      splits: [
        { seat: ada, name: 'Ada', included: true, value: null },
        { seat: bo, name: 'Bo', included: true, value: null },
      ],
    });

    expect(await withDb((handle) => memberBalanceMinor(handle.db, groupId, bo))).toBe(-1000);
    expect(await withDb((handle) => memberBalanceMinor(handle.db, groupId, cy))).toBe(0);
  });

  it('never reads another group’s ledger', async () => {
    const otherGroupId = await withDb(async (handle) => {
      const [other] = await handle.db
        .insert(groups)
        .values({ name: 'Flat', currency: 'INR', type: 'home' })
        .returning({ id: groups.id });

      // The same seat id shape, but a membership row and an expense that belong to the other
      // group: the read is scoped by group, so none of this can reach the balance above.
      const [seat] = await handle.db
        .insert(memberships)
        .values({ groupId: other.id, userId: cyId, displayName: 'Cy', role: 'owner' })
        .returning({ id: memberships.id });

      const [expense] = await handle.db
        .insert(expenses)
        .values({
          groupId: other.id,
          description: 'Groceries',
          amountMinor: 4000,
          date: '2026-10-05',
          category: 'food',
          splitType: 'equal',
        })
        .returning({ id: expenses.id });

      await handle.db.insert(expensePayers).values({
        expenseId: expense.id,
        membershipId: seat.id,
        displayName: 'Cy',
        amountMinor: 4000,
        position: 0,
      });
      await handle.db.insert(splitLines).values({
        expenseId: expense.id,
        membershipId: seat.id,
        displayName: 'Cy',
        shareMinor: 4000,
      });

      return other.id;
    });

    const balances = await withDb((handle: { db: Db }) => computeNetBalances(handle.db, groupId));

    expect(balances).toHaveLength(3);
    expect(balances.every((balance) => balance.balanceMinor === 0)).toBe(true);
    expect(otherGroupId).toBeTruthy();
  });
});
