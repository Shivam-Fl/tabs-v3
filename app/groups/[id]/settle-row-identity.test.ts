import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettleSheetBody, SettleUpForm, transferRowKey } from '../../../components/settle-panels';
import { minorUnitsText } from '../../../lib/money/splits';

/**
 * A suggested transfer's identity and the amount its sheet opens with (AC-5, AC-10, repro of
 * BUG-2/T-11).
 *
 * The defect was not in the arithmetic and not in the field: a partial payment revalidates the
 * group page, the same two endpoints come back with a smaller suggestion, and — under a key made
 * of the endpoints alone — React reused the mounted row, whose amount lives in `useState`
 * initialized once. The field kept the fragment just paid while the suggestion printed beside it
 * had already moved. The row key is the one unit that decides whether that row is remounted, so
 * it is the unit this file pins first: an amount-bearing key remounts exactly the row whose
 * suggestion changed, and a refusal — which moves no amount — leaves the key alone, so what was
 * typed and its field error stay where they were typed.
 *
 * The second half is where that typed amount now lives. The inline form on every row is gone
 * (AC-5): a row shows who pays whom and the suggested amount, and "Settle up" opens a sheet whose
 * amount field is prefilled with that row's own suggestion. That sheet body is exported precisely
 * so a test without a DOM can read the prefill it opens with — the repo runs vitest in node with
 * no jsdom, and the sheet is `null` while it is closed, so the alternative would be asserting
 * nothing at all about the one number the flow starts from.
 *
 * It lives here rather than beside the component because `vitest.config.ts` includes `lib/**`,
 * `app/**` and `scripts/**` only: a `components/*.test.ts` would be collected by nothing and
 * would prove nothing. The sibling `debts-live-region.test.ts` already imports these panels from
 * this directory for the same reason.
 *
 * The honest limit, and it is the plan's own residual risk: nothing here opens the sheet or types
 * into a live input. That a sheet starts clean, keeps what was typed through a refusal and
 * re-prefills on the next open is AC-6 in the browser.
 */

const ADA = '11111111-1111-4111-8111-111111111111';
const BO = '22222222-2222-4222-8222-222222222222';

/** The transfer pair as the two ends of the partial payment T-11 records. */
function transfer(fromMembershipId: string, toMembershipId: string, amountMinor: number) {
  return { fromMembershipId, toMembershipId, fromDisplayName: 'Ada', toDisplayName: 'Bo', amountMinor };
}

/** The value the amount field renders with — the text a person would see in it on open. */
function amountFieldValue(html: string): string | null {
  const input = html.match(/<input[^>]*name="amount"[^>]*>/)?.[0] ?? null;
  return input?.match(/value="([^"]*)"/)?.[1] ?? null;
}

/** The open sheet for one transfer: the markup a person gets the moment they press Settle up. */
function sheet(t: ReturnType<typeof transfer>): string {
  return renderToStaticMarkup(
    createElement(SettleSheetBody, {
      groupId: 'group-1',
      currency: 'USD',
      transfer: t,
      formAction: () => undefined,
      isPending: false,
      onCancel: () => undefined,
    }),
  );
}

function settleUp(transfers: ReturnType<typeof transfer>[], archived = false): string {
  return renderToStaticMarkup(
    createElement(SettleUpForm, {
      groupId: 'group-1',
      currency: 'USD',
      transfers,
      archived,
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
    // The sheet renders from the transfer the key encodes, so a row mounted for the 20.00
    // remainder offers 20.00: minorUnitsText(2000) is '20.00', not the '10' fragment T-11 saw.
    expect(amountFieldValue(sheet(transfer(ADA, BO, 2000)))).toBe(minorUnitsText(2000));
    expect(amountFieldValue(sheet(transfer(ADA, BO, 3000)))).toBe('30.00');
  });

  it('prefills through minorUnitsText, so the text that goes in is the text the boundary parses', () => {
    // The prefill is not a second formatting rule: minorUnitsText is the function the write path
    // reads the field back with, and it is what the suggestion is rendered from — including the
    // amounts whose text is not the obvious decimal.
    expect(amountFieldValue(sheet(transfer(ADA, BO, 1250)))).toBe(minorUnitsText(1250));
    expect(amountFieldValue(sheet(transfer(ADA, BO, 5)))).toBe('0.05');
    expect(amountFieldValue(sheet(transfer(ADA, BO, 0)))).toBe('0.00');
  });

  it('offers each sheet its own amount, not the first row all of them', () => {
    // Two rows, two sheets, each opened with its own suggestion — the same pair in both
    // directions, so a sheet reading the wrong transfer would name the wrong number.
    expect(amountFieldValue(sheet(transfer(ADA, BO, 3000)))).toBe('30.00');
    expect(amountFieldValue(sheet(transfer(BO, ADA, 2000)))).toBe('20.00');
  });

  it('records who pays whom, so the sheet says what it is about before anything is typed', () => {
    expect(sheet(transfer(ADA, BO, 1250))).toContain('Ada');
    expect(sheet(transfer(ADA, BO, 1250))).toContain('Bo');
  });

  it('leaves no amount field on the closed rows: the form lives in the sheet', () => {
    const html = settleUp([transfer(ADA, BO, 3000), transfer(BO, ADA, 2000)]);

    // Both rows offer the flow, and neither carries an inline field — that is the shape AC-5
    // bans, and the one thing about this redesign a cold render can prove.
    expect(html.match(/Settle up/g)).toHaveLength(2);
    expect(html).not.toContain('name="amount"');
    expect(html).not.toContain('<form');
  });

  it('offers an archived group no flow at all, only the numbers', () => {
    const html = settleUp([transfer(ADA, BO, 3000)], true);

    expect(html).toContain('30.00');
    expect(html).not.toContain('Settle up');
    expect(html).not.toContain('name="amount"');
  });
});
