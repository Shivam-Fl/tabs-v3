import { z } from 'zod';
import { fieldErrorsFrom, type FieldErrors } from '../auth/validation';
import { MAX_MINOR_UNITS, minorUnitsText, parseMinorUnits } from '../money/splits';

/**
 * The one boundary every settle-up input crosses (TR-9).
 *
 * It is deliberately as thin as the other boundaries and knows nothing about who is asking: a
 * payment is a payer, a recipient and an amount, and whether either endpoint is *this* group's
 * is `actions.ts`'s question against the guarded group — a schema that read the database could
 * not be tested without one.
 *
 * The amount arrives as the text a person typed and leaves as integer minor units, through the
 * same `parseMinorUnits` the expense editor uses, so the two write paths cannot disagree about
 * what "12.50" means.
 */

export type { FieldErrors };

/**
 * The messages a caller sees. They live beside the schema for the reason the expense ones do:
 * two call sites cannot drift into two phrasings of "that amount is not a number", and every
 * sentence names what is off rather than saying "invalid input".
 */
export const PAYMENT_NOT_FOUND_MESSAGE = 'That payment is not available.';
export const PAYMENT_AMOUNT_INVALID_MESSAGE = 'Enter the amount as a number, like 12.50.';
export const PAYMENT_AMOUNT_POSITIVE_MESSAGE = 'Enter an amount more than zero.';
export const PAYMENT_AMOUNT_TOO_LARGE_MESSAGE = `Enter an amount no more than ${minorUnitsText(MAX_MINOR_UNITS)}.`;
export const PAYMENT_SAME_MEMBER_MESSAGE =
  'A payment moves money between two different people. Choose who paid and who received it.';

/**
 * What a payment's activity row carries so the feed can render it later (TR-10, AC-7).
 *
 * An expense event points at its expense and reads the description through it, but a payment
 * that is *deleted* has nothing left to point at: `activity_event.payment_id` is `set null`, so
 * the row outlives the payment and a feed that stored only the id would have a row it could
 * never render. The snapshot is the minimum that keeps it renderable — the amount and both
 * endpoints as they were at the moment of the event — which is why it is stored on the event
 * rather than looked up from the row it describes.
 */
export interface PaymentSnapshot {
  amountMinor: number;
  fromMembershipId: string;
  fromDisplayName: string;
  toMembershipId: string;
  toDisplayName: string;
}

/** The two rows a payment writes into the feed. Closed, like the membership events beside them. */
export const PAYMENT_EVENTS = ['payment-created', 'payment-deleted'] as const;
export type PaymentEvent = (typeof PAYMENT_EVENTS)[number];

const trimmed = z.string().transform((value) => value.trim());

/**
 * A typed amount, as integer minor units. Zero and negative are refused by name rather than by
 * a generic message: "enter an amount more than zero" is the answer, and a payment of nothing
 * would be a ledger row that moves no money.
 */
const amountField = trimmed.transform((raw, ctx) => {
  const amountMinor = parseMinorUnits(raw);
  if (amountMinor === null) {
    ctx.addIssue({ code: 'custom', message: PAYMENT_AMOUNT_INVALID_MESSAGE });
    return 0;
  }
  if (amountMinor <= 0) {
    ctx.addIssue({ code: 'custom', message: PAYMENT_AMOUNT_POSITIVE_MESSAGE });
    return 0;
  }
  if (amountMinor > MAX_MINOR_UNITS) {
    ctx.addIssue({ code: 'custom', message: PAYMENT_AMOUNT_TOO_LARGE_MESSAGE });
    return 0;
  }
  return amountMinor;
});

/**
 * A submitted payment, parsed. The two endpoints are ids and are only checked to be ids here;
 * whether they name seats in the guarded group is the action's question, against the group it
 * has already authorized the caller for.
 */
export const paymentFormSchema = z
  .object({
    fromMembershipId: z.uuid(),
    toMembershipId: z.uuid(),
    amount: amountField,
  })
  .refine((value) => value.fromMembershipId !== value.toMembershipId, {
    message: PAYMENT_SAME_MEMBER_MESSAGE,
    path: ['toMembershipId'],
  });

export type PaymentDraft = z.infer<typeof paymentFormSchema>;

/**
 * A raw payment id, parsed before it reaches a query — the same rule the expense id follows: a
 * malformed id never gets that far, because handing a driver a string the uuid column cannot
 * cast is a 500 where a refusal belongs.
 */
export const paymentScope = z.uuid();

export type PaymentParseResult =
  | { ok: true; draft: PaymentDraft }
  | { ok: false; message: string; fieldErrors: FieldErrors };

/** The submitted form, parsed once, with the first thing wrong with it as the sentence to show. */
export function parsePaymentInput(formData: FormData): PaymentParseResult {
  const field = (name: string): string => {
    const value = formData.get(name);
    return typeof value === 'string' ? value : '';
  };

  const parsed = paymentFormSchema.safeParse({
    fromMembershipId: field('fromMembershipId'),
    toMembershipId: field('toMembershipId'),
    amount: field('amount'),
  });

  if (parsed.success) return { ok: true, draft: parsed.data };

  const [issue] = parsed.error.issues;
  return {
    ok: false,
    message: issue?.message ?? PAYMENT_NOT_FOUND_MESSAGE,
    fieldErrors: fieldErrorsFrom(parsed.error),
  };
}

/**
 * Declared here rather than in the `'use server'` module beside it, for the reason the group and
 * expense states are: a server-action file may export only async functions.
 */
export interface PaymentActionState {
  status: 'idle' | 'error' | 'success';
  message: string;
  fieldErrors?: FieldErrors;
}

export const IDLE_PAYMENT_STATE: PaymentActionState = { status: 'idle', message: '' };
