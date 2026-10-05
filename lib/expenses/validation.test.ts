import { describe, expect, it } from 'vitest';
import {
  AMOUNT_POSITIVE_MESSAGE,
  AMOUNT_TOO_LARGE_MESSAGE,
  DATE_INVALID_MESSAGE,
  DESCRIPTION_REQUIRED_MESSAGE,
  DUPLICATE_MEMBER_MESSAGE,
  EXPENSE_ADDED,
  EXPENSE_DELETED,
  EXPENSE_UPDATED,
  NO_PARTICIPANT_MESSAGE,
  NO_PAYER_MESSAGE,
  SPLIT_SHARES_INVALID_MESSAGE,
  expenseChanges,
  expenseFiltersFrom,
  expenseNoticeText,
  expenseScope,
  indexedRows,
  parseExpenseInput,
} from './validation';

/**
 * The expense boundary, proved without a database (TR-8, TR-4).
 *
 * Everything here is a form the browser could actually send: the same field names, the same
 * indexed rows, the same habit of sending nothing at all for an unchecked box. What the tests
 * are really about is the two halves of the ticket's arithmetic — text becomes an integer that
 * means exactly what was typed, and a set of parts that does not add up is refused with a
 * sentence naming the shortfall and its size.
 */

const CURRENCY = 'INR';
const ADa = '11111111-1111-4111-8111-111111111111';
const BO = '22222222-2222-4222-8222-222222222222';
const CY = '33333333-3333-4333-8333-333333333333';

interface FormSpec {
  description?: string;
  amount?: string;
  date?: string;
  category?: string;
  note?: string;
  splitType?: string;
  payers?: Array<{ membershipId: string; amount: string }>;
  splits?: Array<{ membershipId: string; included?: boolean; value?: string }>;
}

/** A submitted expense, encoded the way the editor encodes one. */
function expenseForm(spec: FormSpec): FormData {
  const data = new FormData();
  if (spec.description !== undefined) data.set('description', spec.description);
  if (spec.amount !== undefined) data.set('amount', spec.amount);
  if (spec.date !== undefined) data.set('date', spec.date);
  if (spec.category !== undefined) data.set('category', spec.category);
  if (spec.note !== undefined) data.set('note', spec.note);
  if (spec.splitType !== undefined) data.set('splitType', spec.splitType);

  (spec.payers ?? []).forEach((payer, index) => {
    data.set(`payer.${index}.membershipId`, payer.membershipId);
    data.set(`payer.${index}.amount`, payer.amount);
  });

  (spec.splits ?? []).forEach((split, index) => {
    data.set(`split.${index}.membershipId`, split.membershipId);
    if (split.included) data.set(`split.${index}.included`, '1');
    if (split.value !== undefined) data.set(`split.${index}.value`, split.value);
  });

  return data;
}

/** A form every test can lean on, and override one thing at a time. */
function validSpec(overrides: FormSpec = {}): FormSpec {
  return {
    description: 'Dinner',
    amount: '12.50',
    date: '2026-10-05',
    category: 'food',
    splitType: 'equal',
    payers: [{ membershipId: ADa, amount: '12.50' }],
    splits: [
      { membershipId: ADa, included: true },
      { membershipId: BO, included: true, value: 'typed but ignored' },
      { membershipId: CY, included: false, value: '12.50' },
    ],
    ...overrides,
  };
}

function parse(spec: FormSpec) {
  return parseExpenseInput(expenseForm(spec), CURRENCY);
}

describe('parseExpenseInput', () => {
  it('reads an equal split: one payer, everyone in, no per-member input', () => {
    const result = parse(validSpec());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.draft).toEqual({
      description: 'Dinner',
      amountMinor: 1250,
      date: '2026-10-05',
      category: 'food',
      note: null,
      splitType: 'equal',
      payers: [{ membershipId: ADa, amountMinor: 1250 }],
      splits: [
        { membershipId: ADa, included: true, value: null },
        { membershipId: BO, included: true, value: null },
        { membershipId: CY, included: false, value: null },
      ],
    });
  });

  it('puts every number it hands on an integer', () => {
    const result = parse(
      validSpec({
        amount: '1.15',
        splitType: 'percentage',
        payers: [{ membershipId: ADa, amount: '1.15' }],
        splits: [
          { membershipId: ADa, included: true, value: '33.33' },
          { membershipId: BO, included: true, value: '66.67' },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 1.15 * 100 is 114.99999999999999. Nothing here is allowed to be that.
    expect(result.draft.amountMinor).toBe(115);
    expect(result.draft.payers[0].amountMinor).toBe(115);
    expect(result.draft.splits.map((split) => split.value)).toEqual([3333, 6667]);
    for (const value of [
      result.draft.amountMinor,
      ...result.draft.payers.map((payer) => payer.amountMinor),
      ...result.draft.splits.map((split) => split.value ?? 0),
    ]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('reads an exact split as minor units', () => {
    const result = parse(
      validSpec({
        splitType: 'exact',
        amount: '5.00',
        payers: [{ membershipId: ADa, amount: '5.00' }],
        splits: [
          { membershipId: ADa, included: true, value: '3.00' },
          { membershipId: BO, included: true, value: '2' },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.splits.map((split) => split.value)).toEqual([300, 200]);
  });

  it('reads a share split as counts', () => {
    const result = parse(
      validSpec({
        splitType: 'shares',
        splits: [
          { membershipId: ADa, included: true, value: '2' },
          { membershipId: BO, included: true, value: '1' },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.splits.map((split) => split.value)).toEqual([2, 1]);
  });

  it('defaults the fields a form may leave out', () => {
    const result = parse(
      validSpec({ category: undefined, splitType: undefined, note: '   ' }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.category).toBe('other');
    expect(result.draft.splitType).toBe('equal');
    expect(result.draft.note).toBeNull();
  });

  it('keeps a value typed beside a member who was left out of the split', () => {
    // What was typed is stored as typed, so reopening shows the rule as it was entered rather
    // than resetting the row somebody deliberately took out.
    const result = parse(
      validSpec({
        splitType: 'shares',
        splits: [
          { membershipId: ADa, included: true, value: '3' },
          { membershipId: BO, included: false, value: '5' },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.splits).toEqual([
      { membershipId: ADa, included: true, value: 3 },
      { membershipId: BO, included: false, value: 5 },
    ]);
  });
});

describe('a split that does not add up', () => {
  it('names the shortfall in the paid parts and how much it is', () => {
    const result = parse(
      validSpec({ amount: '5.00', payers: [{ membershipId: ADa, amount: '4.50' }] }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    // The sentence ui.md asks for: what the parts come to, how far off, and what they are off
    // from — and it is reported against the payer rows, which are what has to change.
    expect(result.fieldErrors.payers).toBe(result.message);
    expect(result.message).toContain('4.50');
    expect(result.message).toContain('0.50');
    expect(result.message).toContain('5.00');
    expect(result.message).toMatch(/short of/i);
  });

  it('says when the parts are over rather than short', () => {
    const result = parse(
      validSpec({ amount: '5.00', payers: [{ membershipId: ADa, amount: '6.00' }] }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/over/i);
    expect(result.message).toContain('1.00');
  });

  it('names the missing amount in an exact split', () => {
    const result = parse(
      validSpec({
        splitType: 'exact',
        amount: '10.00',
        payers: [{ membershipId: ADa, amount: '10.00' }],
        splits: [
          { membershipId: ADa, included: true, value: '4.00' },
          { membershipId: BO, included: true, value: '3.00' },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.splits).toBe(result.message);
    expect(result.message).toContain('7.00');
    expect(result.message).toContain('3.00');
    expect(result.message).toContain('10.00');
  });

  it('names the percentages that do not make a whole', () => {
    const result = parse(
      validSpec({
        splitType: 'percentage',
        splits: [
          { membershipId: ADa, included: true, value: '49.75' },
          { membershipId: BO, included: true, value: '49.75' },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // 99.5% of the way there, said as the percentage that is missing and not as 9950 of 10000.
    expect(result.message).toContain('99.5%');
    expect(result.message).toContain('0.5%');
    expect(result.message).not.toContain('99.50%');
  });

  it('refuses a share count that is not a whole positive number', () => {
    const result = parse(
      validSpec({
        splitType: 'shares',
        splits: [
          { membershipId: ADa, included: true, value: '2' },
          { membershipId: BO, included: true, value: '0' },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.splits).toBe(SPLIT_SHARES_INVALID_MESSAGE);
  });

  it('refuses a percentage above a whole', () => {
    const result = parse(
      validSpec({
        splitType: 'percentage',
        splits: [{ membershipId: ADa, included: true, value: '120' }],
      }),
    );

    expect(result.ok).toBe(false);
  });
});

describe('a form that is wrong in the fields', () => {
  it('asks for a description', () => {
    const result = parse(validSpec({ description: '   ' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.description).toBe(DESCRIPTION_REQUIRED_MESSAGE);
  });

  it('refuses an amount that is not a number, and one that is zero', () => {
    expect(parse(validSpec({ amount: 'twelve' })).ok).toBe(false);
    expect(parse(validSpec({ amount: '' })).ok).toBe(false);

    const zero = parse(validSpec({ amount: '0' }));
    expect(zero.ok).toBe(false);
    if (zero.ok) return;
    expect(zero.fieldErrors.amount).toBe(AMOUNT_POSITIVE_MESSAGE);
  });

  it('refuses an amount larger than the ledger can hold', () => {
    // 99999999.99 parses as a number and does not fit an integer column: refused at the
    // boundary, where the answer is a sentence, rather than at the database, where it is a 500.
    const result = parse(
      validSpec({ amount: '99999999.99', payers: [{ membershipId: ADa, amount: '99999999.99' }] }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.amount).toBe(AMOUNT_TOO_LARGE_MESSAGE);
  });

  it('refuses a date that is not a day on the calendar', () => {
    expect(parse(validSpec({ date: '2026-02-30' })).ok).toBe(false);
    expect(parse(validSpec({ date: '05/10/2026' })).ok).toBe(false);

    const result = parse(validSpec({ date: '2026-02-30' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.date).toBe(DATE_INVALID_MESSAGE);
  });

  it('accepts a leap day, which is a day on the calendar', () => {
    expect(parse(validSpec({ date: '2028-02-29' })).ok).toBe(true);
  });

  it('refuses a category outside the set', () => {
    expect(parse(validSpec({ category: 'yachts' })).ok).toBe(false);
  });

  it('refuses a split type outside the set', () => {
    expect(parse(validSpec({ splitType: 'vibes' })).ok).toBe(false);
  });

  it('refuses an expense with no payers at all', () => {
    const result = parse(validSpec({ payers: [] }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.payers).toBe(NO_PAYER_MESSAGE);
  });

  it('refuses an expense nobody is in', () => {
    const result = parse(
      validSpec({
        splits: [
          { membershipId: ADa, included: false },
          { membershipId: BO, included: false },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.splits).toBe(NO_PARTICIPANT_MESSAGE);
  });

  it('refuses the same member twice, on either side of the expense', () => {
    const twicePaying = parse(
      validSpec({
        payers: [
          { membershipId: ADa, amount: '6.25' },
          { membershipId: ADa, amount: '6.25' },
        ],
      }),
    );
    expect(twicePaying.ok).toBe(false);
    if (twicePaying.ok) return;
    expect(twicePaying.fieldErrors.payers).toBe(DUPLICATE_MEMBER_MESSAGE);

    const twiceSplit = parse(
      validSpec({
        splits: [
          { membershipId: ADa, included: true },
          { membershipId: ADa, included: true },
        ],
      }),
    );
    expect(twiceSplit.ok).toBe(false);
    if (twiceSplit.ok) return;
    expect(twiceSplit.fieldErrors.splits).toBe(DUPLICATE_MEMBER_MESSAGE);
  });

  it('refuses a membership id that is not an id', () => {
    const result = parse(validSpec({ payers: [{ membershipId: 'me', amount: '12.50' }] }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.payers).toBeDefined();
  });
});

describe('indexedRows', () => {
  it('gathers indexed fields back into rows, in order, whatever order they arrived in', () => {
    const data = new FormData();
    data.set('split.1.membershipId', BO);
    data.set('split.0.membershipId', ADa);
    data.set('split.0.included', '1');
    data.set('split.10.membershipId', CY);

    expect(indexedRows(data, 'split')).toEqual([
      { membershipId: ADa, included: '1' },
      { membershipId: BO },
      { membershipId: CY },
    ]);
  });

  it('ignores anything that is not one of its rows', () => {
    const data = new FormData();
    data.set('split.0.membershipId', ADa);
    data.set('split.x.membershipId', BO);
    data.set('payer.nonsense', 'yes');
    data.set('description', 'Dinner');

    expect(indexedRows(data, 'split')).toEqual([{ membershipId: ADa }]);
    expect(indexedRows(data, 'payer')).toEqual([]);
  });
});

describe('expenseFiltersFrom', () => {
  it('reads the three filters the list offers', () => {
    expect(expenseFiltersFrom({ member: ADa, category: 'Food', q: '  dinner ' })).toEqual({
      memberId: ADa,
      category: 'food',
      search: 'dinner',
    });
  });

  it('reads an absent filter as no filter', () => {
    expect(expenseFiltersFrom({})).toEqual({ memberId: null, category: null, search: null });
    expect(expenseFiltersFrom({ member: '  ', category: '', q: '   ' })).toEqual({
      memberId: null,
      category: null,
      search: null,
    });
  });

  it('drops a filter that is not one of ours rather than refusing the page', () => {
    // A hand-edited URL is a person looking at a list; the useful answer is the unfiltered list.
    expect(expenseFiltersFrom({ member: 'not-an-id', category: 'yachts', q: 'x' })).toEqual({
      memberId: null,
      category: null,
      search: 'x',
    });
  });
});

describe('expenseScope', () => {
  it('accepts an id and refuses anything that is not one', () => {
    expect(expenseScope.safeParse(ADa).success).toBe(true);
    expect(expenseScope.safeParse('not-an-id').success).toBe(false);
    expect(expenseScope.safeParse('').success).toBe(false);
  });
});

describe('expenseNoticeText', () => {
  it('turns the three notice values into their sentences', () => {
    expect(expenseNoticeText(EXPENSE_ADDED)).toBe('Expense added.');
    expect(expenseNoticeText(EXPENSE_UPDATED)).toBe('Expense updated.');
    expect(expenseNoticeText(EXPENSE_DELETED)).toBe('Expense deleted.');
  });

  it('says nothing for anything else, so nothing a caller sends is reflected back', () => {
    expect(expenseNoticeText(undefined)).toBeNull();
    expect(expenseNoticeText('')).toBeNull();
    expect(expenseNoticeText('<script>')).toBeNull();
  });
});

describe('expenseChanges', () => {
  const before = {
    description: 'Dinner',
    amountMinor: 1250,
    date: '2026-10-05',
    payers: [{ membershipId: ADa, displayName: 'Ada', amountMinor: 1250 }],
    participants: [{ membershipId: ADa, displayName: 'Ada', included: true }],
    splitType: 'equal' as const,
    inputs: [{ membershipId: ADa, value: null }],
    category: 'food',
    note: null,
  };

  it('carries only the fields that moved, as they were and as they are', () => {
    const payload = expenseChanges(before, { ...before, amountMinor: 2000 });

    expect(payload).toEqual({
      before: { amountMinor: 1250 },
      after: { amountMinor: 2000 },
    });
  });

  it('is null when nothing changed, which is what stops a second Save recording an edit', () => {
    expect(expenseChanges(before, { ...before })).toBeNull();
  });

  it('notices a change deep inside the rows, not just the top level', () => {
    const payload = expenseChanges(before, {
      ...before,
      payers: [
        { membershipId: ADa, displayName: 'Ada', amountMinor: 1000 },
        { membershipId: BO, displayName: 'Bo', amountMinor: 250 },
      ],
    });

    expect(payload?.after.payers).toHaveLength(2);
    expect(payload?.before.payers).toHaveLength(1);
  });

  it('counts a reordering as a change, because payer order decides the remainder', () => {
    const twoPayers = {
      ...before,
      payers: [
        { membershipId: ADa, displayName: 'Ada', amountMinor: 1000 },
        { membershipId: BO, displayName: 'Bo', amountMinor: 250 },
      ],
    };

    const payload = expenseChanges(twoPayers, {
      ...twoPayers,
      payers: [...twoPayers.payers].reverse(),
    });

    expect(payload).not.toBeNull();
  });
});
