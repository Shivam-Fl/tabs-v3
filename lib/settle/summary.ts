import type { MemberBalance } from './balances';
import type { Transfer } from './simplify';

/**
 * The home screen's cross-group arithmetic (TR-9, AC-2) — pure, so the rule about which groups
 * count is one function a test can call rather than a filter re-decided in a Server Component.
 *
 * Two rules are worth stating because neither is obvious from the numbers alone.
 *
 * **One currency at a time.** Totals and per-person rows add up only the groups whose currency
 * matches the viewer's own; a group in another currency is still listed, with its own balance in
 * its own currency, and is named in the note beside the totals. Adding rupees to dollars would
 * produce a number that means nothing, and this version has no exchange rates (spec: multiple
 * currencies inside one group and conversion are explicitly out of scope).
 *
 * **Per person, netted.** A row is what the viewer and one other *person* owe each other across
 * every group they share, and each row is a single net — being owed 100 in one group and owing
 * 30 in another is one row of 70, not two. The rows are the group's own simplified transfers
 * seen from the viewer's side, so a group page that says "Cy pays you 100" and a home row that
 * says "Cy owes you 100" are the same statement, and the rows sum to the viewer's per-group
 * balances by construction.
 */

export interface GroupBalanceInput {
  groupId: string;
  groupName: string;
  currency: string;
  /** The viewer's seat in this group, which is the one side of every transfer that is theirs. */
  viewerMembershipId: string;
  balances: readonly MemberBalance[];
  transfers: readonly Transfer[];
}

export interface PersonRow {
  /**
   * The person: their account when the seat has one, so two groups with the same friend produce
   * one row, and the seat's own id otherwise — a placeholder or a departed seat is nobody else's.
   */
  key: string;
  displayName: string;
  /** Positive: they owe the viewer. Negative: the viewer owes them. */
  netMinor: number;
}

export interface ExcludedGroup {
  groupId: string;
  groupName: string;
  currency: string;
}

export interface HomeSummary {
  /** What people owe the viewer, summed across the rows. */
  owedMinor: number;
  /** What the viewer owes, summed across the rows, as a positive number. */
  oweMinor: number;
  people: PersonRow[];
  /** Groups left out of the totals above because their currency is not the viewer's. */
  excluded: ExcludedGroup[];
  /** The viewer's own net in every group, whatever its currency — the per-group balance rows. */
  perGroup: { groupId: string; balanceMinor: number }[];
}

/** Account key for a seat: the person it belongs to, or the seat itself when it has none. */
function personKey(balances: ReadonlyMap<string, MemberBalance>, membershipId: string): string {
  return balances.get(membershipId)?.userId ?? membershipId;
}

/**
 * Fold the viewer's groups into the totals, per-person rows and per-group balances home renders.
 *
 * Groups arrive in the order the home list shows them, and that order decides which of a
 * person's names is used when the same friend is a different string in two groups — the first
 * one seen wins, which is the newest membership the list puts first.
 */
export function summarizeHome(
  groups: readonly GroupBalanceInput[],
  viewerCurrency: string,
): HomeSummary {
  const people = new Map<string, PersonRow>();
  const excluded: ExcludedGroup[] = [];
  const perGroup: { groupId: string; balanceMinor: number }[] = [];

  for (const group of groups) {
    const own = group.balances.find(
      (balance) => balance.membershipId === group.viewerMembershipId,
    );
    perGroup.push({ groupId: group.groupId, balanceMinor: own?.balanceMinor ?? 0 });

    if (group.currency !== viewerCurrency) {
      excluded.push({
        groupId: group.groupId,
        groupName: group.groupName,
        currency: group.currency,
      });
      continue;
    }

    const byMembership = new Map(group.balances.map((balance) => [balance.membershipId, balance]));

    for (const transfer of group.transfers) {
      // The viewer is a party or this transfer is somebody else's business.
      const isPayer = transfer.fromMembershipId === group.viewerMembershipId;
      const isRecipient = transfer.toMembershipId === group.viewerMembershipId;
      if (!isPayer && !isRecipient) continue;

      const counterpartId = isPayer ? transfer.toMembershipId : transfer.fromMembershipId;
      const counterpartName = isPayer ? transfer.toDisplayName : transfer.fromDisplayName;
      const key = personKey(byMembership, counterpartId);
      const signed = isPayer ? -transfer.amountMinor : transfer.amountMinor;

      const existing = people.get(key);
      if (existing) {
        existing.netMinor += signed;
      } else {
        people.set(key, { key, displayName: counterpartName, netMinor: signed });
      }
    }
  }

  const rows = [...people.values()].sort(
    (left, right) =>
      right.netMinor - left.netMinor ||
      left.displayName.localeCompare(right.displayName) ||
      left.key.localeCompare(right.key),
  );

  let owedMinor = 0;
  let oweMinor = 0;
  for (const row of rows) {
    if (row.netMinor > 0) owedMinor += row.netMinor;
    else oweMinor += -row.netMinor;
  }

  return { owedMinor, oweMinor, people: rows, excluded, perGroup };
}
