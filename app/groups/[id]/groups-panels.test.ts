import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { settleUpHref } from '../../../components/groups-panels';

/**
 * Where a blocked removal or leave points the reader (AC-15, repro of BUG-1/T-15).
 *
 * The defect: both refusals used to hand back `/groups/<id>#debts-heading`, a fragment on a heading
 * the group page's rewrite deleted. Settling now lives on a tab, so a bare fragment landed the
 * reader on the expenses panel with no settle form anywhere — the link looked alive and pointed at
 * nothing. The fix is one helper that carries the section *and* the panel id, so the two call sites
 * cannot drift apart again, and this file pins the string it produces.
 *
 * It lives here rather than beside the component because `vitest.config.ts` collects `lib/**`,
 * `app/**` and `scripts/**` only: a `components/*.test.ts` would be collected by nothing and would
 * prove nothing. The sibling `settle-row-identity.test.ts` sits here for the same reason.
 */

const GROUPS_PANELS = new URL('../../../components/groups-panels.tsx', import.meta.url);

describe('settle-up link behind a blocked removal or leave', () => {
  it('resolves to the Balances panel that holds the live settle form', () => {
    expect(settleUpHref('group-1')).toBe('/groups/group-1?section=balances#panel-balances');
  });

  it('carries the group id it was given, not a fixed one', () => {
    const id = '22222222-2222-4222-8222-222222222222';

    const href = settleUpHref(id);
    expect(href).toContain(`/groups/${id}?`);
    expect(href).toContain('#panel-balances');
  });

  it('names the section as well as the fragment, so the right tab is open on arrival', () => {
    // The half BUG-1 was missing: on the default expenses tab the fragment resolves to nothing the
    // reader needs, so the section parameter has to be there too.
    expect(settleUpHref('group-1')).toContain('?section=balances');
  });

  it('never points at the #debts-heading anchor the group page no longer renders', () => {
    // BUG-1 itself: the fragment outlived the heading that used to carry it. Pin the target, then
    // pin the file that holds both refusal call sites — the islands cannot be mounted in a unit
    // test (they read the database the group page reads), so the module that renders them is
    // checked directly for the starved href and for both refusals actually routing through the
    // helper.
    expect(settleUpHref('group-1')).not.toContain('#debts-heading');

    const source = readFileSync(GROUPS_PANELS, 'utf8');
    expect(source).not.toContain('#debts-heading');

    const callSites = source.match(/href=\{settleUpHref\(groupId\)\}/g) ?? [];
    expect(callSites.length).toBeGreaterThanOrEqual(2);
  });
});
