import { describe, expect, it } from 'vitest';
import type { MemberBalance } from './balances';
import type { Transfer } from './simplify';
import { summarizeHome, type GroupBalanceInput } from './summary';

/**
 * The home screen's cross-group arithmetic (AC-2).
 *
 * Pure, like the simplification beside it: groups in, one summary out. Two rules are what these
 * cases are for — that the totals add up only groups in the viewer's own currency (and say which
 * ones they left out), and that two groups with the same person in them produce one row and not
 * two. The last case pins the property that keeps home and the group page agreeing: the rows sum
 * to the viewer's own net in each group, because they *are* that group's simplified transfers
 * seen from the viewer's side.
 */

function seat(
  membershipId: string,
  displayName: string,
  balanceMinor: number,
  userId: string | null = null,
): MemberBalance {
  return { membershipId, userId, displayName, balanceMinor };
}

/** A plan for the viewer's own group: one transfer per counterpart, which is what the viewer sees. */
function viewerGroup(spec: {
  groupId: string;
  groupName?: string;
  currency?: string;
  viewer: string;
  viewerBalance: number;
  others?: Array<{ seat: string; name: string; userId?: string | null; amountMinor: number; owed: boolean }>;
}): GroupBalanceInput {
  const others = spec.others ?? [];
  const balances: MemberBalance[] = [
    seat(spec.viewer, 'Ada', spec.viewerBalance, 'user-ada'),
    ...others.map((other) =>
      seat(other.seat, other.name, other.owed ? -other.amountMinor : other.amountMinor, other.userId ?? null),
    ),
  ];

  return {
    groupId: spec.groupId,
    groupName: spec.groupName ?? spec.groupId,
    currency: spec.currency ?? 'INR',
    viewerMembershipId: spec.viewer,
    balances,
    transfers: others.map(
      (other): Transfer => ({
        fromMembershipId: other.owed ? other.seat : spec.viewer,
        fromDisplayName: other.owed ? other.name : 'Ada',
        toMembershipId: other.owed ? spec.viewer : other.seat,
        toDisplayName: other.owed ? 'Ada' : other.name,
        amountMinor: other.amountMinor,
      }),
    ),
  };
}

describe('summarizeHome', () => {
  it('says nothing and owes nothing when there are no groups at all', () => {
    expect(summarizeHome([], 'INR')).toEqual({
      owedMinor: 0,
      oweMinor: 0,
      people: [],
      excluded: [],
      perGroup: [],
    });
  });

  it('splits one person’s balance across groups: what they owe minus what you owe them', () => {
    // Bo owes 100 in the trip; you owe the same Bo 30 in the flat. One row, netted, not two.
    const summary = summarizeHome(
      [
        viewerGroup({
          groupId: 'trip',
          viewer: 'ada-trip',
          viewerBalance: 1000,
          others: [{ seat: 'bo-trip', name: 'Bo', userId: 'user-bo', amountMinor: 1000, owed: true }],
        }),
        viewerGroup({
          groupId: 'flat',
          viewer: 'ada-flat',
          viewerBalance: -300,
          others: [{ seat: 'bo-flat', name: 'Bo', userId: 'user-bo', amountMinor: 300, owed: false }],
        }),
      ],
      'INR',
    );

    expect(summary.people).toEqual([{ key: 'user-bo', displayName: 'Bo', netMinor: 700 }]);
    expect(summary.owedMinor).toBe(700);
    expect(summary.oweMinor).toBe(0);
  });

  it('keys a person with no account by the seat, so a placeholder is nobody else’s row', () => {
    const summary = summarizeHome(
      [
        viewerGroup({
          groupId: 'trip',
          viewer: 'ada-trip',
          viewerBalance: -500,
          others: [{ seat: 'seat-2', name: 'Bo', amountMinor: 500, owed: false }],
        }),
      ],
      'INR',
    );

    expect(summary.people).toEqual([{ key: 'seat-2', displayName: 'Bo', netMinor: -500 }]);
    expect(summary.oweMinor).toBe(500);
    expect(summary.owedMinor).toBe(0);
  });

  it('adds up one currency only, and names the groups it left out', () => {
    const summary = summarizeHome(
      [
        viewerGroup({
          groupId: 'trip',
          viewer: 'ada-trip',
          viewerBalance: 1000,
          others: [{ seat: 'bo-trip', name: 'Bo', amountMinor: 1000, owed: true }],
        }),
        viewerGroup({
          groupId: 'berlin',
          groupName: 'Berlin',
          currency: 'EUR',
          viewer: 'ada-berlin',
          viewerBalance: -2000,
          others: [{ seat: 'cy-berlin', name: 'Cy', amountMinor: 2000, owed: false }],
        }),
      ],
      'INR',
    );

    // The euro group's 20 is not added to the rupee 10 — it is listed, named, and left out.
    expect(summary.owedMinor).toBe(1000);
    expect(summary.oweMinor).toBe(0);
    expect(summary.people).toEqual([
      { key: 'bo-trip', displayName: 'Bo', netMinor: 1000 },
    ]);
    expect(summary.excluded).toEqual([{ groupId: 'berlin', groupName: 'Berlin', currency: 'EUR' }]);
  });

  it('reports the viewer’s own balance in every group, in that group’s currency', () => {
    const summary = summarizeHome(
      [
        viewerGroup({ groupId: 'trip', viewer: 'ada-trip', viewerBalance: 1000 }),
        viewerGroup({
          groupId: 'berlin',
          currency: 'EUR',
          viewer: 'ada-berlin',
          viewerBalance: -2000,
        }),
      ],
      'INR',
    );

    expect(summary.perGroup).toEqual([
      { groupId: 'trip', balanceMinor: 1000 },
      { groupId: 'berlin', balanceMinor: -2000 },
    ]);
  });

  it('ignores transfers between two other people, which are none of the viewer’s business', () => {
    const summary = summarizeHome(
      [
        {
          groupId: 'trip',
          groupName: 'Trip',
          currency: 'INR',
          viewerMembershipId: 'ada',
          balances: [
            seat('ada', 'Ada', 0, 'user-ada'),
            seat('bo', 'Bo', 500, 'user-bo'),
            seat('cy', 'Cy', -500, 'user-cy'),
          ],
          transfers: [
            {
              fromMembershipId: 'cy',
              fromDisplayName: 'Cy',
              toMembershipId: 'bo',
              toDisplayName: 'Bo',
              amountMinor: 500,
            },
          ],
        },
      ],
      'INR',
    );

    expect(summary.people).toEqual([]);
    expect(summary.owedMinor).toBe(0);
    expect(summary.oweMinor).toBe(0);
    expect(summary.perGroup).toEqual([{ groupId: 'trip', balanceMinor: 0 }]);
  });

  it('lists the biggest debtor first and uses the first name it saw for a person', () => {
    const summary = summarizeHome(
      [
        viewerGroup({
          groupId: 'trip',
          viewer: 'ada-trip',
          viewerBalance: 100,
          others: [
            { seat: 'bo-trip', name: 'Bo', userId: 'user-bo', amountMinor: 900, owed: false },
            { seat: 'cy-trip', name: 'Cy', userId: 'user-cy', amountMinor: 1000, owed: true },
          ],
        }),
        viewerGroup({
          groupId: 'flat',
          viewer: 'ada-flat',
          viewerBalance: 400,
          // The same person as the trip's Bo, under the newer name the flat spells.
          others: [{ seat: 'bo-flat', name: 'Bobby', userId: 'user-bo', amountMinor: 400, owed: true }],
        }),
      ],
      'INR',
    );

    // Bobby's 400 and Bo's −900 are one person: 500 owed to the viewer, behind Cy's 1000.
    expect(summary.people).toEqual([
      { key: 'user-cy', displayName: 'Cy', netMinor: 1000 },
      { key: 'user-bo', displayName: 'Bo', netMinor: -500 },
    ]);
    expect(summary.owedMinor).toBe(1000);
    expect(summary.oweMinor).toBe(500);
  });

  it('sums to the viewer’s own net in each group, because the rows are that group’s transfers', () => {
    const groups = [
      viewerGroup({
        groupId: 'trip',
        viewer: 'ada-trip',
        viewerBalance: 700,
        others: [
          { seat: 'bo-trip', name: 'Bo', userId: 'user-bo', amountMinor: 500, owed: true },
          { seat: 'cy-trip', name: 'Cy', userId: 'user-cy', amountMinor: 200, owed: true },
        ],
      }),
      viewerGroup({
        groupId: 'flat',
        viewer: 'ada-flat',
        viewerBalance: -300,
        others: [{ seat: 'bo-flat', name: 'Bo', userId: 'user-bo', amountMinor: 300, owed: false }],
      }),
    ];

    const summary = summarizeHome(groups, 'INR');

    // Home's rows and the group page's debts card are the same statement seen from two sides.
    expect(summary.owedMinor - summary.oweMinor).toBe(
      summary.perGroup.reduce((sum, group) => sum + group.balanceMinor, 0),
    );
  });
});
