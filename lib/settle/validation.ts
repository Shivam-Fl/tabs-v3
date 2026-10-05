import { z } from 'zod';
import { fieldErrorsFrom, type FieldErrors } from '../auth/validation';
import { formatMinorUnits } from '../money/format';
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
export const PAYMENT_BOTH_DEPARTED_MESSAGE = 'A payment must include someone still in the group.';

/**
 * What the feed row for a payment says happened, in the words the two seats carried at the time.
 *
 * Pure, and here rather than in the `'use server'` module beside it, so the write path can import
 * it *inside* the transaction: it is the call between the payment insert and the activity insert,
 * and a test that mocks it can fail the write at exactly that point and prove the two rows come
 * back together or not at all.
 */
export function paymentSubject(snapshot: PaymentSnapshot): string {
  return `${snapshot.fromDisplayName} paid ${snapshot.toDisplayName}`;
}

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

// --- How a settle-up success reaches the debts card (ADR-0008, AC-6) ---

/**
 * The notice a recorded or deleted payment rides home on.
 *
 * Recording pays a suggested transfer off, which takes that row out of the list the form lived
 * in — so the island that held the message is unmounted by the very success it is announcing, and
 * an inline `StateMessage` there announces nothing. The outcome therefore travels as a query on
 * the group page, the way the expense and group notices already do, and the parameter and its
 * values are shared between the redirect that writes them and the page that reads them so neither
 * half can drift into a second spelling.
 *
 * The pair is in the URL because the sentence has to say what is *left*, and only the caller that
 * recomputes the ledger knows that: `from` and `to` are the endpoints as submitted, and the page
 * finds that pair in the current suggestions and reads the remainder back off it.
 */
export const PAYMENT_NOTICE_PARAM = 'payment';
export const PAYMENT_RECORDED = 'recorded';
export const PAYMENT_DELETED = 'deleted';

/** The two query keys that carry the pair the notice is about. */
export const PAYMENT_NOTICE_FROM_PARAM = 'from';
export const PAYMENT_NOTICE_TO_PARAM = 'to';

export interface PaymentNoticePair {
  fromMembershipId: string;
  toMembershipId: string;
}

/**
 * The pair a notice names, or null when it names no pair this group has.
 *
 * Both ends are checked here rather than trusted, for the same reason every other query value is:
 * the URL is a value anybody can type. An id that is not a uuid, and an id that is a seat in some
 * *other* group, both fail the same way and render the same amount of notice — nothing — so a
 * forged link cannot be used to make the page say something that did not happen, nor to probe
 * which ids exist.
 */
export function paymentNoticePair(
  raw: { from?: string | undefined; to?: string | undefined },
  seatIds: ReadonlySet<string>,
): PaymentNoticePair | null {
  const from = z.uuid().safeParse(raw.from ?? '');
  const to = z.uuid().safeParse(raw.to ?? '');
  if (!from.success || !to.success) return null;
  if (!seatIds.has(from.data) || !seatIds.has(to.data)) return null;

  return { fromMembershipId: from.data, toMembershipId: to.data };
}

/** The little of a suggested transfer this module needs: the pair and what it is for. */
export interface DirectedTransfer {
  fromMembershipId: string;
  toMembershipId: string;
  amountMinor: number;
}

/**
 * What is still owed between a pair, read from the current suggestions and signed by direction.
 *
 * Positive means the pair still owes in the direction the notice recorded — the suggestion is
 * still there, for the remainder. Negative means the suggestion now runs *back* the other way,
 * which is what an over-payment produces: the payer paid more than they owed, and the honest
 * thing to say is that the pair owes the other way now. Zero — no suggestion between them at all
 * — is the settled case.
 *
 * The transfers come in as a structural parameter rather than a `Transfer`, so this module keeps
 * its promise of reaching for no database: `lib/settle/simplify.ts` imports the balance read, and
 * this file is imported by the settle panels, which are a client island.
 */
export function directedRemainderMinor(
  transfers: readonly DirectedTransfer[],
  fromMembershipId: string,
  toMembershipId: string,
): number {
  const forward = transfers.find(
    (transfer) =>
      transfer.fromMembershipId === fromMembershipId && transfer.toMembershipId === toMembershipId,
  );
  if (forward) return forward.amountMinor;

  const reversed = transfers.find(
    (transfer) =>
      transfer.fromMembershipId === toMembershipId && transfer.toMembershipId === fromMembershipId,
  );
  return reversed ? -reversed.amountMinor : 0;
}

/**
 * The sentence a notice query carries, or null when it carries none.
 *
 * A closed vocabulary and a total mapper, like the expense and invite notices beside it: an
 * absent, blank, unknown or invented value says nothing rather than reflecting a stranger's string
 * back into the page. The remainder is *not* from the query — it is recomputed from the ledger by
 * the caller — so the only thing a caller controls here is which of two verbs the sentence uses.
 */
export function paymentNoticeText(
  raw: string | undefined,
  remainderMinor: number,
  currency: string,
): string | null {
  const done =
    raw === PAYMENT_RECORDED
      ? 'Payment recorded.'
      : raw === PAYMENT_DELETED
        ? 'Payment deleted.'
        : null;
  if (done === null) return null;

  if (remainderMinor === 0) return `${done} The two of them are settled up.`;

  const amount = formatMinorUnits(Math.abs(remainderMinor), currency);
  return remainderMinor > 0
    ? `${done} ${amount} still to pay between them.`
    : `${done} They now owe ${amount} the other way.`;
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
