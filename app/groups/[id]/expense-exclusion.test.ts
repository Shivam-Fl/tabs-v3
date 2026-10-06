import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExpenseEditor } from '../../../components/expense-editor';
import type { ExpenseEditorData } from '../../../lib/expenses/queries';

/**
 * What leaving a member out of a split does to that row's value field (AC-9, repro of BUG-1/T-4).
 *
 * The defect was not in the arithmetic and not on the server. The excluded row's value input was
 * rendered `disabled`, and a disabled control contributes nothing to a submission — so the 40 a
 * person typed beside the member they took out never reached the FormData, the boundary read the
 * missing `split.1.value` as `''`, `parseSplitValue` answered `null`, and the row reopened blank.
 * The exclusion itself persisted, which is what made it look like a display bug; the value was
 * gone at submit. `readOnly` keeps the field out of the person's way without keeping it out of
 * the payload, and `aria-disabled` says the same thing to a screen reader that the dimmed
 * treatment says to the eye.
 *
 * The one thing a cold render can prove is the markup a person is handed, so this file pins
 * exactly that: the excluded row carries its typed value and no `disabled` attribute, an included
 * row is an ordinary editable input, and the include checkbox stays the only control that emits
 * `split.N.included` — one emitter, no hidden mirror for the value either.
 *
 * It lives here rather than beside the component because `vitest.config.ts` includes `lib/**`,
 * `app/**` and `scripts/**` only: a `components/*.test.ts` would be collected by nothing and would
 * prove nothing. The sibling `settle-row-identity.test.ts` renders its island from this directory
 * for the same reason.
 *
 * The honest limit: nothing here types into a live field or round-trips a save through the
 * database. That the typed value survives a real save and reopen is AC-9 in the browser, on a
 * running stack.
 */

const ADA = '11111111-1111-4111-8111-111111111111';
const BO = '22222222-2222-4222-8222-222222222222';

/**
 * The T-4 expense as the editor reopens it: an exact split of 100.00, the second member taken out
 * with their typed 40.00 kept beside them — which is the state the old `disabled` input could
 * never have produced, because it destroyed the number before the save.
 */
const EXCLUDED_SPEC: ExpenseEditorData = {
  description: 'Dinner',
  amount: '100.00',
  date: '2026-10-05',
  category: 'food',
  note: '',
  splitType: 'exact',
  payers: [{ membershipId: ADA, displayName: 'Ada', amount: '100.00' }],
  participants: [
    { membershipId: ADA, displayName: 'Ada', included: true, value: '40.00' },
    { membershipId: BO, displayName: 'Bo', included: false, value: '40.00' },
  ],
};

function editor(data: ExpenseEditorData = EXCLUDED_SPEC): string {
  return renderToStaticMarkup(
    createElement(ExpenseEditor, {
      groupId: 'group-1',
      expenseId: 'expense-1',
      currency: 'INR',
      data,
    }),
  );
}

/** The whole `<input …>` tag carrying one field name, or null when nothing renders it. */
function inputTag(html: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.match(new RegExp(`<input[^>]*name="${escaped}"[^>]*>`))?.[0] ?? null;
}

/** How many inputs carry a field name — one emitter is what AC-9's payload contract rests on. */
function inputCount(html: string, name: string): number {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.match(new RegExp(`<input[^>]*name="${escaped}"[^>]*>`, 'g'))?.length ?? 0;
}

function valueOf(tag: string): string | null {
  return tag.match(/value="([^"]*)"/)?.[1] ?? null;
}

describe('a member left out of an exact split', () => {
  it('renders their typed value, so it survives the submission that stores it', () => {
    // The T-4 blank: the row was rendered with value="" because the stored number was already
    // lost. The number has to be in the markup for a save to carry it.
    const tag = inputTag(editor(), 'split.1.value');

    expect(tag).not.toBeNull();
    expect(valueOf(tag ?? '')).toBe('40.00');
  });

  it('leaves the value input out of the disabled set, which is what dropped the field', () => {
    // The root cause in one assertion: a disabled control submits nothing. `readOnly` keeps the
    // field visible and submittable; `aria-disabled` carries the state to assistive technology.
    const tag = inputTag(editor(), 'split.1.value') ?? '';

    expect(tag).not.toMatch(/\sdisabled(?:=|\s|>)/);
    expect(tag).toMatch(/\sreadOnly(?:=|\s|\/|>)/);
    expect(tag).toContain('aria-disabled="true"');
  });

  it('keeps an included member an ordinary editable input', () => {
    // The other side of the branch: nothing about the fix may dim or freeze a row that is in the
    // split.
    const tag = inputTag(editor(), 'split.0.value') ?? '';

    expect(valueOf(tag)).toBe('40.00');
    expect(tag).not.toMatch(/\sreadOnly(?:=|\s|\/|>)/);
    expect(tag).not.toMatch(/\sdisabled(?:=|\s|>)/);
  });

  it('submits the value under one name and the inclusion under exactly one control', () => {
    // The payload names are unchanged and each has a single emitter: the checkbox for
    // split.N.included, the readOnly input for split.N.value, nothing hidden beside either.
    const html = editor();

    expect(inputCount(html, 'split.1.value')).toBe(1);
    expect(inputCount(html, 'split.1.included')).toBe(1);
    expect(inputTag(html, 'split.1.included')).toContain('type="checkbox"');
    expect(inputTag(html, 'split.1.included')).toContain('role="switch"');
    // Unchecked sends nothing, which the boundary reads as included=false — the exclusion that
    // was never broken.
    expect(inputTag(html, 'split.1.included')).not.toContain('checked');
  });
});
