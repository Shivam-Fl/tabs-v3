import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettleUpForm, transferRowKey } from '../../../components/settle-panels';

/**
 * A suggested transfer row's identity (AC-10, repro of BUG-2/T-11).
 *
 * The defect was not in the arithmetic and not in the field: a partial payment revalidates the
 * group page, the same two endpoints come back with a smaller suggestion, and — under a key made
 * of the endpoints alone — React reused the mounted row, whose amount lives in `useState`
 * initialized once. The field kept the fragment just paid while the suggestion printed beside it
 * had already moved. The row key is the one unit that decides whether that row is remounted, so
 * it is the unit this file pins: an amount-bearing key remounts exactly the row whose suggestion
 * changed, and a refusal — which moves no amount — leaves the key alone, so what was typed and
 * its field error stay where they were typed.
 *
 * It lives here rather than beside the component because `vitest.config.ts` includes `lib/**`,
 * `app/**` and `scripts/**` only: a `components/*.test.ts` would be collected by nothing and
 * would prove nothing. The sibling `debts-live-region.test.ts` already imports these panels from
 * this directory for the same reason.
 *
 * The honest limit, and it is the plan's own residual risk: the repo has no jsdom, so nothing
 * here types into a live input. Rendering fresh initializes the field from the suggestion whether
 * or not the key is right, so the key contract is asserted directly; that the key is what
 * `SettleUpForm` keys its rows by is asserted only by reading the one call site, and the
 * end-to-end proof is AC-10 in the browser.
 */

const ADA = '11111111-1111-4111-8111-111111111111';
const BO = '22222222-2222-4222-8222-222222222222';

/** The transfer pair as the two ends of the partial payment T-11 records. */
function transfer(fromMembershipId: string, toMembershipId: string, amountMinor: number) {
  return { fromMembershipId, toMembershipId, fromDisplayName: 'Ada', toDisplayName: 'Bo', amountMinor };
}

/** The value the row's amount field renders with — the text the user would see in it. */
function amountFieldValue(html: string): string | null {
  const input = html.match(/<input[^>]*name="amount"[^>]*>/)?.[0] ?? null;
  return input?.match(/value="([^"]*)"/)?.[1] ?? null;
}

function settleUp(transfers: ReturnType<typeof transfer>[]): string {
  return renderToStaticMarkup(
    createElement(SettleUpForm, {
      groupId: 'group-1',
      currency: 'USD',
      transfers,
      archived: false,
    }),
  );
}

describe('settle-up row identity', () => {
  it('changes the row key when the suggestion shrinks, so the row remounts', () => {
    // The T-11 case: Ada pays Bo 30.00, 10.00 of it recorded, so the next read suggests 20.00 for
    // the same pair. The two must not be the same row — an unchanged key is the mounted instance
    // React reuses, and the field keeps the 10.00 fragment it was typed with.
    expect(transferRowKey(transfer(ADA, BO, 2000))).not.toBe(
      transferRowKey(transfer(ADA, BO, 3000)),
    );
  });

  it('keeps the row key stable when the suggestion is unchanged, so a refusal keeps what was typed', () => {
    // The T-9 path: a refused submit revalidates nothing, so the transfer comes back identical and
    // the row must not be remounted — that remount is what would throw away the typed amount and
    // move its field error off the row that submitted.
    expect(transferRowKey(transfer(ADA, BO, 1250))).toBe(transferRowKey(transfer(ADA, BO, 1250)));
  });

  it('still tells two different endpoint pairs apart at the same amount', () => {
    // The half of the key that was already right: two people who happen to owe the same amount are
    // two rows, and a key that dropped the endpoints would collide them.
    expect(transferRowKey(transfer(ADA, BO, 1250))).not.toBe(
      transferRowKey(transfer(BO, ADA, 1250)),
    );
  });

  it('opens the amount field with the suggestion, so the shrunken row offers the remainder', () => {
    // The field renders from the transfer the key encodes, so a row mounted for the 20.00
    // remainder offers 20.00: minorUnitsText(2000) is '20.00', not the '10' fragment T-11 saw.
    expect(amountFieldValue(settleUp([transfer(ADA, BO, 2000)]))).toBe('20.00');
    expect(amountFieldValue(settleUp([transfer(ADA, BO, 3000)]))).toBe('30.00');
  });

  it('offers each row its own amount, not the first row all of them', () => {
    const html = settleUp([transfer(ADA, BO, 3000), transfer(BO, ADA, 2000)]);

    // Two rows, two fields, each opened with its own suggestion and keyed apart for it.
    expect(html.match(/name="amount"/g)).toHaveLength(2);
    expect(amountFieldValue(html)).toBe('30.00');
    expect(html).toContain('value="20.00"');
  });
});
