import { describe, expect, it } from 'vitest';
import { expenseNoticeText, EXPENSE_DELETED } from '../expenses/validation';
import {
  PAYMENT_DELETED,
  PAYMENT_NOTICE_PARAM,
  PAYMENT_RECORDED,
  directedRemainderMinor,
  paymentNoticePair,
  paymentNoticeText,
} from './validation';

/**
 * The settle-up notice vocabulary (ADR-0008, AC-6).
 *
 * A success notice rides the query because the form that would have shown it is unmounted by the
 * change it describes, and a query is a value a stranger can type. So the two halves pinned here
 * are the two halves of that contract: the composer is *total* — every input a URL can carry maps
 * to a sentence or to nothing, never to something reflected back — and the pair it names is
 * checked against the guarded group's seats, so an id from somewhere else renders exactly as much
 * as a forged value does.
 *
 * `today` has no analogue here: the remainder is recomputed from the ledger by the caller and
 * handed in, which is what keeps this module pure and testable without a database.
 */

const ADA = '11111111-1111-4111-8111-111111111111';
const BO = '22222222-2222-4222-8222-222222222222';
const STRANGER = '99999999-9999-4999-8999-999999999999';

const SEATS = new Set([ADA, BO]);

describe('the parameter and its values', () => {
  it('is the one the redirect writes and the page reads', () => {
    // Spelled out because it is the contract between two files that never see each other.
    expect(PAYMENT_NOTICE_PARAM).toBe('payment');
    expect(PAYMENT_RECORDED).toBe('recorded');
    expect(PAYMENT_DELETED).toBe('deleted');
  });
});

describe('paymentNoticeText', () => {
  it('names the recording and the remainder still to pay between the pair', () => {
    const text = paymentNoticeText(PAYMENT_RECORDED, 2000, 'USD');

    expect(text).toContain('Payment recorded.');
    expect(text).toContain('$20.00');
  });

  it('names the flipped pair when the payment overshot', () => {
    // Over-payment is accepted by design (there is no rule comparing the amount to the
    // suggestion), so the notice has to be honest about the direction reversing rather than
    // claiming a remainder that no longer runs that way.
    const text = paymentNoticeText(PAYMENT_RECORDED, -500, 'USD');

    expect(text).toContain('Payment recorded.');
    expect(text).toContain('$5.00');
    expect(text).toContain('the other way');
  });

  it('says settled when the pair no longer owes anything', () => {
    expect(paymentNoticeText(PAYMENT_RECORDED, 0, 'USD')).toContain('settled up');
  });

  it('says the same three things for a deletion, in the deletion’s words', () => {
    expect(paymentNoticeText(PAYMENT_DELETED, 2000, 'USD')).toContain('Payment deleted.');
    expect(paymentNoticeText(PAYMENT_DELETED, 2000, 'USD')).toContain('$20.00');
    expect(paymentNoticeText(PAYMENT_DELETED, -500, 'USD')).toContain('the other way');
    expect(paymentNoticeText(PAYMENT_DELETED, 0, 'USD')).toContain('settled up');
  });

  it('renders nothing for an absent, blank or unknown value', () => {
    expect(paymentNoticeText(undefined, 0, 'USD')).toBeNull();
    expect(paymentNoticeText('', 1250, 'USD')).toBeNull();
    expect(paymentNoticeText('recorded ', 1250, 'USD')).toBeNull();
    expect(paymentNoticeText('RECORDED', 1250, 'USD')).toBeNull();
    expect(paymentNoticeText('deletedx', 1250, 'USD')).toBeNull();
  });

  it('renders nothing for markup or a value meant to be read back as a sentence', () => {
    // The whole point of a closed vocabulary: nothing a caller sends is ever reflected into the
    // page, so a script tag in the query is a value that matches no sentence and produces none.
    expect(paymentNoticeText('<script>alert(1)</script>', 1250, 'USD')).toBeNull();
    expect(paymentNoticeText('recorded<script>', 1250, 'USD')).toBeNull();
  });

  it('is not the expense notice wearing a different parameter', () => {
    // Two parameters share the page's notice slots. If the copy were shared, a forged
    // `?payment=deleted` would read as "Expense deleted." and nobody could tell which happened.
    const expense = expenseNoticeText(EXPENSE_DELETED);
    expect(expense).not.toBeNull();
    expect(paymentNoticeText(PAYMENT_DELETED, 0, 'USD')).not.toBe(expense);
    expect(paymentNoticeText(PAYMENT_DELETED, 0, 'USD')).not.toContain('Expense');
  });
});

describe('paymentNoticePair', () => {
  it('accepts a pair of ids that are both seats in this group', () => {
    expect(paymentNoticePair({ from: ADA, to: BO }, SEATS)).toEqual({
      fromMembershipId: ADA,
      toMembershipId: BO,
    });
  });

  it('renders nothing when either end is not a seat in this group', () => {
    // Exactly what a forged value gets: another group's seat is answered as no seat at all.
    expect(paymentNoticePair({ from: STRANGER, to: BO }, SEATS)).toBeNull();
    expect(paymentNoticePair({ from: ADA, to: STRANGER }, SEATS)).toBeNull();
  });

  it('renders nothing when either end is missing, blank or not an id', () => {
    expect(paymentNoticePair({}, SEATS)).toBeNull();
    expect(paymentNoticePair({ from: ADA }, SEATS)).toBeNull();
    expect(paymentNoticePair({ to: BO }, SEATS)).toBeNull();
    expect(paymentNoticePair({ from: '', to: BO }, SEATS)).toBeNull();
    expect(paymentNoticePair({ from: 'ada', to: BO }, SEATS)).toBeNull();
    expect(paymentNoticePair({ from: ADA, to: `${BO} ` }, SEATS)).toBeNull();
  });
});

describe('directedRemainderMinor', () => {
  const pair = (fromMembershipId: string, toMembershipId: string, amountMinor: number) => ({
    fromMembershipId,
    toMembershipId,
    amountMinor,
  });

  it('reads the suggestion in the recorded direction as it stands', () => {
    expect(directedRemainderMinor([pair(BO, ADA, 2000)], BO, ADA)).toBe(2000);
  });

  it('reads a reversed suggestion as the same money the other way', () => {
    expect(directedRemainderMinor([pair(ADA, BO, 500)], BO, ADA)).toBe(-500);
  });

  it('is zero when the pair is in no suggestion at all — the settled case', () => {
    expect(directedRemainderMinor([], BO, ADA)).toBe(0);
    expect(directedRemainderMinor([pair(BO, STRANGER, 2000)], BO, ADA)).toBe(0);
  });
});
