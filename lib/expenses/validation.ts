import { z } from 'zod';
import { formatBasisPoints, formatMinorUnits } from '../money/format';
import {
  DEFAULT_SPLIT_TYPE,
  MAX_MINOR_UNITS,
  PERCENT_SCALE,
  SPLIT_TYPES,
  minorUnitsText,
  parseMinorUnits,
  parseSplitValue,
  shortfallMinor,
  type SplitInput,
  type SplitType,
} from '../money/splits';
import { fieldErrorsFrom, type FieldErrors } from '../auth/validation';

export type { FieldErrors };

/**
 * The one boundary every expense input crosses (TR-8, TR-4, AC-7).
 *
 * Three things about this module are load-bearing.
 *
 * **Everything arrives as the text a form holds and leaves as an integer.** The amount is
 * "12.50" on the way in and 1250 minor units on the way out; a percentage is "33.33" on the way
 * in and 3333 basis points on the way out. The conversion is `lib/money/splits.ts`' arithmetic,
 * not a `parseFloat`, so nothing here can invent or lose a paisa. The schemas below only decide
 * whether the text is acceptable and word the refusal.
 *
 * **The rules that need two fields at once live in one `superRefine`.** A payer's part is only
 * wrong against the total, an exact split's parts only against the amount, percentages only
 * against 100%. They are checked together, at the object, which is the only place all of them
 * are visible — and every message names what is off and by how much, because "invalid split" is
 * a sentence that helps nobody.
 *
 * **It knows nothing about the database or the session.** The group's currency is a parameter,
 * so a message can format an amount without this module reaching for a group, and every rule
 * that needs to know who is in the group (a membership id that is not a member) is decided by
 * the action that has already loaded them.
 */

/** The closed set from the spec — the same list the seed, the filter and the editor share. */
export const EXPENSE_CATEGORIES = [
  'food',
  'travel',
  'rent',
  'utilities',
  'shopping',
  'entertainment',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const DEFAULT_EXPENSE_CATEGORY: ExpenseCategory = 'other';

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  food: 'Food',
  travel: 'Travel',
  rent: 'Rent',
  utilities: 'Utilities',
  shopping: 'Shopping',
  entertainment: 'Entertainment',
  other: 'Other',
};

/** The human name for a stored category, falling back to the stored text if it is ever widened. */
export function expenseCategoryLabel(value: string): string {
  return EXPENSE_CATEGORY_LABELS[value as ExpenseCategory] ?? value;
}

export const SPLIT_TYPE_LABELS: Record<SplitType, string> = {
  equal: 'Equally',
  exact: 'Exact amounts',
  percentage: 'Percentages',
  shares: 'Shares',
};

export const DESCRIPTION_MAX = 200;
export const NOTE_MAX = 500;
export const EXPENSE_SEARCH_MAX = 100;

/**
 * The messages a caller sees. They live beside the schemas for the reason the group ones do:
 * two call sites cannot drift into two phrasings of the same refusal, and the shortfall wording
 * is the sentence `docs/ui.md` asks for ("parts sum to 450, 50 short of 500") rather than a
 * generic "invalid split".
 */
export const EXPENSE_FIELDS_MESSAGE = 'Check the highlighted fields.';
export const EXPENSE_NOT_FOUND_MESSAGE = 'That expense is not available.';
export const DESCRIPTION_REQUIRED_MESSAGE = 'Enter a description.';
export const DESCRIPTION_TOO_LONG_MESSAGE = `Description must be at most ${DESCRIPTION_MAX} characters.`;
export const AMOUNT_INVALID_MESSAGE = 'Enter the amount as a number, like 12.50.';
export const AMOUNT_POSITIVE_MESSAGE = 'Enter an amount more than zero.';
export const AMOUNT_TOO_LARGE_MESSAGE = `Enter an amount no more than ${minorUnitsText(MAX_MINOR_UNITS)}.`;
export const DATE_INVALID_MESSAGE = 'Enter the date as YYYY-MM-DD.';
export const NOTE_TOO_LONG_MESSAGE = `Note must be at most ${NOTE_MAX} characters.`;
export const CATEGORY_INVALID_MESSAGE = `Choose one of ${EXPENSE_CATEGORIES.join(', ')}.`;
export const SPLIT_TYPE_INVALID_MESSAGE = `Choose one of ${SPLIT_TYPES.join(', ')}.`;
export const NO_PAYER_MESSAGE = 'Add at least one payer.';
export const PAYER_PART_INVALID_MESSAGE = "Enter each payer's part as a number, like 12.50.";
export const PAYER_PART_POSITIVE_MESSAGE = "Every payer's part must be more than zero.";
export const NO_PARTICIPANT_MESSAGE = 'Include at least one member in the split.';
export const DUPLICATE_MEMBER_MESSAGE = 'Each member can appear only once in this expense.';
export const SPLIT_AMOUNT_INVALID_MESSAGE = 'Enter an amount more than zero for everyone in the split.';
export const SPLIT_PERCENT_INVALID_MESSAGE = 'Enter a percentage for everyone in the split.';
export const SPLIT_SHARES_INVALID_MESSAGE = 'Give everyone in the split at least one share.';
export const UNKNOWN_MEMBER_MESSAGE = 'Someone in this expense is not a member of this group.';

/** The refusal for one member's input, in the unit their split type names. */
export function splitValueMessage(splitType: SplitType): string {
  if (splitType === 'percentage') return SPLIT_PERCENT_INVALID_MESSAGE;
  if (splitType === 'shares') return SPLIT_SHARES_INVALID_MESSAGE;
  return SPLIT_AMOUNT_INVALID_MESSAGE;
}

/**
 * "The paid parts sum to ₹4.50, ₹0.50 short of ₹5.00." Both halves of a mismatch are worth
 * saying: the size is what tells someone whether they mistyped a digit or left a payer out.
 *
 * Exported, unlike the rule that calls it, because the editor says the same sentence under the
 * payer rows as the person types — in the same words, from the same arithmetic, so the advice
 * before the save and the refusal after it cannot disagree about what is wrong.
 */
export function paidPartsMessage(paidMinor: number, totalMinor: number, currency: string): string {
  const gap = Math.abs(totalMinor - paidMinor);
  const direction = paidMinor < totalMinor ? 'short of' : 'over';
  return `The paid parts sum to ${formatMinorUnits(paidMinor, currency)}, ${formatMinorUnits(gap, currency)} ${direction} the ${formatMinorUnits(totalMinor, currency)} expense.`;
}

/** The same sentence for an exact split's parts, which is the same kind of number. */
export function splitPartsMessage(splitMinor: number, totalMinor: number, currency: string): string {
  const gap = Math.abs(totalMinor - splitMinor);
  const direction = splitMinor < totalMinor ? 'short of' : 'over';
  return `The split parts sum to ${formatMinorUnits(splitMinor, currency)}, ${formatMinorUnits(gap, currency)} ${direction} the ${formatMinorUnits(totalMinor, currency)} expense.`;
}

/** And for percentages, which are not money and must not be dressed as any. */
export function percentPartsMessage(sumBasisPoints: number): string {
  const gap = Math.abs(PERCENT_SCALE - sumBasisPoints);
  const direction = sumBasisPoints < PERCENT_SCALE ? 'short of' : 'over';
  return `The percentages add up to ${formatBasisPoints(sumBasisPoints)}, ${formatBasisPoints(gap)} ${direction} 100%.`;
}

// --- What an edited expense records (TR-10) ---

/**
 * The vocabulary of an `expense-edited` activity row: the fields the feed names as diffable,
 * each as it stood before the edit and as it stands after.
 *
 * These types live here, not in the action that builds the payload, because `lib/db/schema.ts`
 * types the `payload` column with them and the schema file may only import a module that does
 * not itself reach for a database — which this one does not. Only the fields that actually
 * changed appear in either half, so an edit that moved the amount and nothing else records the
 * amount and nothing else.
 */
export interface ExpensePayerSnapshot {
  membershipId: string;
  displayName: string;
  amountMinor: number;
}

export interface ExpenseParticipantSnapshot {
  membershipId: string;
  displayName: string;
  included: boolean;
}

export interface ExpenseInputSnapshot {
  membershipId: string;
  /** Minor units, basis points or a share count, per the expense's split type. */
  value: number | null;
}

export interface ExpenseSnapshot {
  description: string;
  amountMinor: number;
  date: string;
  payers: ExpensePayerSnapshot[];
  participants: ExpenseParticipantSnapshot[];
  splitType: SplitType;
  inputs: ExpenseInputSnapshot[];
  category: string;
  note: string | null;
}

export interface ExpenseEditPayload {
  before: Partial<ExpenseSnapshot>;
  after: Partial<ExpenseSnapshot>;
}

/** Every field name the diff can carry, in the order the feed should read them. */
export const EXPENSE_SNAPSHOT_FIELDS = [
  'description',
  'amountMinor',
  'date',
  'payers',
  'participants',
  'splitType',
  'inputs',
  'category',
  'note',
] as const satisfies readonly (keyof ExpenseSnapshot)[];

/**
 * The before and after of an edit, holding only the fields that moved — or null when the save
 * changed nothing, which is what keeps a second press of Save from writing a feed row claiming
 * an edit that did not happen.
 *
 * Compared by value, deep: reordering two payers is a change, and so is swapping one member out
 * of the split and another in, neither of which a shallow comparison would notice.
 */
export function expenseChanges(
  before: ExpenseSnapshot,
  after: ExpenseSnapshot,
): ExpenseEditPayload | null {
  const changedBefore: Partial<ExpenseSnapshot> = {};
  const changedAfter: Partial<ExpenseSnapshot> = {};
  let changed = false;

  for (const field of EXPENSE_SNAPSHOT_FIELDS) {
    if (JSON.stringify(before[field]) === JSON.stringify(after[field])) continue;

    changed = true;
    // One assignment per field, widened once: the loop is over a union of keys, so TypeScript
    // cannot prove a single generic write is sound for every member of it.
    (changedBefore as Record<string, unknown>)[field] = before[field];
    (changedAfter as Record<string, unknown>)[field] = after[field];
  }

  return changed ? { before: changedBefore, after: changedAfter } : null;
}

// --- Reading the form ---

/**
 * The rows of an indexed form section — `payer.0.membershipId`, `payer.1.amount` — read back as
 * an array in index order.
 *
 * Indexed names rather than repeated ones because a repeated name is positional: one row that
 * submits nothing for a field, or a checkbox that sends nothing when it is cleared, shifts
 * every row after it and silently pairs one member's amount with another member's seat.
 * Reading by index means a row can be incomplete without moving anybody else.
 */
export function indexedRows(formData: FormData, prefix: string): Record<string, string>[] {
  const pattern = new RegExp(`^${prefix}\\.(\\d+)\\.([A-Za-z]+)$`);
  const rows = new Map<number, Record<string, string>>();

  for (const [key, value] of formData.entries()) {
    if (typeof value !== 'string') continue;
    const match = pattern.exec(key);
    if (!match) continue;

    const index = Number(match[1]);
    const row = rows.get(index) ?? {};
    row[match[2]] = value;
    rows.set(index, row);
  }

  return [...rows.entries()].sort(([left], [right]) => left - right).map(([, row]) => row);
}

/** Exactly the fields the form carries, unvalidated. */
export interface RawExpenseForm {
  description: string;
  amount: string;
  date: string;
  category: string;
  note: string;
  splitType: string;
  payers: Record<string, string>[];
  splits: Record<string, string>[];
}

export function readExpenseForm(formData: FormData): RawExpenseForm {
  const field = (name: string): string => {
    const value = formData.get(name);
    return typeof value === 'string' ? value : '';
  };

  return {
    description: field('description'),
    amount: field('amount'),
    date: field('date'),
    category: field('category'),
    note: field('note'),
    splitType: field('splitType'),
    payers: indexedRows(formData, 'payer'),
    splits: indexedRows(formData, 'split'),
  };
}

// --- The schemas ---

const trimmed = z.string().transform((value) => value.trim());

const descriptionField = trimmed
  .refine((value) => value.length > 0, { message: DESCRIPTION_REQUIRED_MESSAGE })
  .refine((value) => value.length <= DESCRIPTION_MAX, { message: DESCRIPTION_TOO_LONG_MESSAGE });

/** A calendar date as `YYYY-MM-DD`, checked against the calendar rather than the pattern alone. */
function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const dateField = z.string().transform((raw, ctx) => {
  const value = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !isCalendarDate(value)) {
    ctx.addIssue({ code: 'custom', message: DATE_INVALID_MESSAGE });
  }
  return value;
});

/** Above this the integer columns cannot hold the number, so the boundary refuses it first. */
function tooLarge(amountMinor: number): boolean {
  return amountMinor > MAX_MINOR_UNITS;
}

const amountField = z.string().transform((raw, ctx) => {
  const amountMinor = parseMinorUnits(raw);
  if (amountMinor === null) {
    ctx.addIssue({ code: 'custom', message: AMOUNT_INVALID_MESSAGE });
    return 0;
  }
  if (amountMinor <= 0) {
    ctx.addIssue({ code: 'custom', message: AMOUNT_POSITIVE_MESSAGE });
    return 0;
  }
  if (tooLarge(amountMinor)) {
    ctx.addIssue({ code: 'custom', message: AMOUNT_TOO_LARGE_MESSAGE });
    return 0;
  }
  return amountMinor;
});

const payerAmountField = z.string().transform((raw, ctx) => {
  const amountMinor = parseMinorUnits(raw);
  if (amountMinor === null) {
    ctx.addIssue({ code: 'custom', message: PAYER_PART_INVALID_MESSAGE });
    return 0;
  }
  if (amountMinor <= 0) {
    ctx.addIssue({ code: 'custom', message: PAYER_PART_POSITIVE_MESSAGE });
    return 0;
  }
  if (tooLarge(amountMinor)) {
    ctx.addIssue({ code: 'custom', message: AMOUNT_TOO_LARGE_MESSAGE });
    return 0;
  }
  return amountMinor;
});

/** Absent, blank or explicit — every one of them is `other`, which is what the form preselects. */
const categoryField = z
  .string()
  .optional()
  .transform((value) => (value ?? '').trim().toLowerCase() || DEFAULT_EXPENSE_CATEGORY)
  .pipe(z.enum(EXPENSE_CATEGORIES, { message: CATEGORY_INVALID_MESSAGE }));

/** Blank means nobody said, which is `equal`: the default the editor opens on. */
const splitTypeField = z
  .string()
  .optional()
  .transform((value) => (value ?? '').trim().toLowerCase() || DEFAULT_SPLIT_TYPE)
  .pipe(z.enum(SPLIT_TYPES, { message: SPLIT_TYPE_INVALID_MESSAGE }));

/** A note nobody wrote is null, not an empty string: "no note" and "a note of nothing" differ. */
const noteField = z
  .string()
  .optional()
  .transform((value) => (value ?? '').trim())
  .transform((value) => (value === '' ? null : value))
  .refine((value) => value === null || value.length <= NOTE_MAX, {
    message: NOTE_TOO_LONG_MESSAGE,
  });

/** A row's checkbox: the island sends "1" when the member is in and nothing when they are not. */
const includedField = z
  .string()
  .optional()
  .transform((value) => value === '1');

const payerLine = z.object({
  membershipId: z.uuid({ message: UNKNOWN_MEMBER_MESSAGE }),
  amount: payerAmountField,
});

/**
 * One member's row in the split. Its `value` stays text here and is turned into the integer its
 * split type names by the object's transform, once the type is known — which is also the check
 * that the text was a number at all.
 */
const splitLine = z.object({
  membershipId: z.uuid({ message: UNKNOWN_MEMBER_MESSAGE }),
  included: includedField,
  value: z
    .string()
    .optional()
    .transform((value) => value ?? ''),
});

function duplicateIds(ids: readonly string[]): boolean {
  return new Set(ids).size !== ids.length;
}

/** The draft a valid form produces: everything the action needs, every number an integer. */
export interface ExpenseDraft {
  description: string;
  amountMinor: number;
  date: string;
  category: ExpenseCategory;
  note: string | null;
  splitType: SplitType;
  payers: { membershipId: string; amountMinor: number }[];
  splits: SplitInput[];
}

export function expenseFormSchema(currency: string) {
  return z
    .object({
      description: descriptionField,
      amount: amountField,
      date: dateField,
      category: categoryField,
      note: noteField,
      splitType: splitTypeField,
      payers: z.array(payerLine).min(1, { message: NO_PAYER_MESSAGE }),
      splits: z.array(splitLine).min(1, { message: NO_PARTICIPANT_MESSAGE }),
    })
    .superRefine((value, ctx) => {
      const included = value.splits.filter((line) => line.included);

      // Cross-field rules report against the section they are about, so the editor can put the
      // sentence beside the rows it is talking about rather than only at the top of the form.
      if (included.length === 0) {
        ctx.addIssue({ code: 'custom', message: NO_PARTICIPANT_MESSAGE, path: ['splits'] });
      }
      if (duplicateIds(value.payers.map((payer) => payer.membershipId))) {
        ctx.addIssue({ code: 'custom', message: DUPLICATE_MEMBER_MESSAGE, path: ['payers'] });
      }
      if (duplicateIds(value.splits.map((line) => line.membershipId))) {
        ctx.addIssue({ code: 'custom', message: DUPLICATE_MEMBER_MESSAGE, path: ['splits'] });
      }

      // Reported against the payer rows rather than the amount: this is a rule about the parts,
      // and it is the parts the person has to change to satisfy it.
      const paidMinor = value.payers.reduce((sum, payer) => sum + payer.amount, 0);
      if (shortfallMinor(value.amount, [paidMinor]) !== 0) {
        ctx.addIssue({
          code: 'custom',
          message: paidPartsMessage(paidMinor, value.amount, currency),
          path: ['payers'],
        });
      }

      // Equal splits have no per-member input; the other three do, and only the members who are
      // in the split owe one. A row left out keeps whatever was typed beside it, which is how
      // reopening shows the rule exactly as it was entered rather than reset.
      if (value.splitType !== 'equal') {
        const values = included.map((line) => parseSplitValue(value.splitType, line.value));
        if (values.some((parsed) => parsed === null)) {
          ctx.addIssue({
            code: 'custom',
            message: splitValueMessage(value.splitType),
            path: ['splits'],
          });
        } else if (value.splitType === 'exact') {
          const partsMinor = values as number[];
          if (shortfallMinor(value.amount, partsMinor) !== 0) {
            ctx.addIssue({
              code: 'custom',
              message: splitPartsMessage(
                value.amount - shortfallMinor(value.amount, partsMinor),
                value.amount,
                currency,
              ),
              path: ['splits'],
            });
          }
        } else if (value.splitType === 'percentage') {
          const basisPoints = (values as number[]).reduce((sum, parsed) => sum + parsed, 0);
          if (basisPoints !== PERCENT_SCALE) {
            ctx.addIssue({
              code: 'custom',
              message: percentPartsMessage(basisPoints),
              path: ['splits'],
            });
          }
        }
      }
    })
    .transform((value): ExpenseDraft => ({
      description: value.description,
      amountMinor: value.amount,
      date: value.date,
      category: value.category,
      note: value.note,
      splitType: value.splitType,
      payers: value.payers.map((payer) => ({
        membershipId: payer.membershipId,
        amountMinor: payer.amount,
      })),
      splits: value.splits.map((line) => ({
        membershipId: line.membershipId,
        included: line.included,
        // Proven non-null for every included row by the check above; a row left out may carry
        // nothing, which is the same state it was stored in.
        value: parseSplitValue(value.splitType, line.value),
      })),
    }));
}

export type ExpenseParseResult =
  | { ok: true; draft: ExpenseDraft }
  | { ok: false; message: string; fieldErrors: FieldErrors };

/**
 * A submitted expense form, parsed. The message is the first thing wrong with it rather than a
 * generic "check the fields", because on this screen the first thing wrong is usually the
 * shortfall and its size — which is the sentence `docs/ui.md` wants in the summary line.
 */
export function parseExpenseInput(formData: FormData, currency: string): ExpenseParseResult {
  const parsed = expenseFormSchema(currency).safeParse(readExpenseForm(formData));

  if (parsed.success) return { ok: true, draft: parsed.data };

  const [issue] = parsed.error.issues;
  return {
    ok: false,
    message: issue?.message ?? EXPENSE_FIELDS_MESSAGE,
    fieldErrors: fieldErrorsFrom(parsed.error),
  };
}

// --- The list's filter and search ---

/**
 * A raw expense id, parsed before it reaches a query. A malformed one never gets there: the
 * column is a uuid, and handing a driver a string it cannot cast is a 500 where a 404 belongs.
 * The page and the two actions that take an id through the form all read it through here.
 */
export const expenseScope = z.uuid();

export interface ExpenseFilters {
  memberId: string | null;
  category: ExpenseCategory | null;
  search: string | null;
}

export const NO_EXPENSE_FILTERS: ExpenseFilters = { memberId: null, category: null, search: null };

/** The query keys the filter form and the page that reads it share. */
export const EXPENSE_MEMBER_PARAM = 'member';
export const EXPENSE_CATEGORY_PARAM = 'category';
export const EXPENSE_SEARCH_PARAM = 'q';

/**
 * The list's filter, read off the query. A value that is not one of ours — a member id that is
 * not an id, a category that is not in the set, a page somebody hand-edited — is dropped rather
 * than refused: this is a filter on a page someone is reading, and the useful answer to a bad
 * filter is the unfiltered list, not an error card.
 */
export function expenseFiltersFrom(query: {
  member?: string;
  category?: string;
  q?: string;
}): ExpenseFilters {
  const member = (query[EXPENSE_MEMBER_PARAM as 'member'] ?? '').trim();
  const category = (query[EXPENSE_CATEGORY_PARAM as 'category'] ?? '').trim().toLowerCase();
  const search = (query[EXPENSE_SEARCH_PARAM as 'q'] ?? '').trim().slice(0, EXPENSE_SEARCH_MAX);

  return {
    memberId: z.uuid().safeParse(member).success ? member : null,
    category: (EXPENSE_CATEGORIES as readonly string[]).includes(category)
      ? (category as ExpenseCategory)
      : null,
    search: search === '' ? null : search,
  };
}

// --- What an expense action hands back to its island ---

/**
 * Declared here rather than in the `'use server'` module beside it, for the reason the group
 * state is: a server-action file may export only async functions.
 */
export interface ExpenseActionState {
  status: 'idle' | 'error' | 'success';
  message: string;
  fieldErrors?: FieldErrors;
}

export const IDLE_EXPENSE_STATE: ExpenseActionState = { status: 'idle', message: '' };

/**
 * How a successful create or delete reaches the page it lands on. Both take their own form with
 * them — a create redirects to the group so the new row is visible in the list, a delete to the
 * group because the expense it was editing no longer exists — so the confirmation rides the
 * query, the way the group notices do. One parameter and a closed set of values, so nothing a
 * caller sends can be reflected into the page as a sentence.
 */
export const EXPENSE_NOTICE_PARAM = 'expense';
export const EXPENSE_ADDED = 'added';
export const EXPENSE_UPDATED = 'updated';
/** A save that found the stored expense already equal to what was submitted, so nothing moved. */
export const EXPENSE_UNCHANGED = 'unchanged';
export const EXPENSE_DELETED = 'deleted';

export function expenseNoticeText(raw: string | undefined): string | null {
  if (raw === EXPENSE_ADDED) return 'Expense added.';
  if (raw === EXPENSE_UPDATED) return 'Expense updated.';
  if (raw === EXPENSE_UNCHANGED) return 'Nothing to change.';
  if (raw === EXPENSE_DELETED) return 'Expense deleted.';
  return null;
}
