'use client';

import { useActionState, useState } from 'react';
import { formatMinorUnits } from '../lib/money/format';
import { minorUnitsText, parseMinorUnits } from '../lib/money/splits';
import { createPayment, deletePayment } from '../lib/settle/actions';
import type { Transfer } from '../lib/settle/simplify';
import { IDLE_PAYMENT_STATE, type PaymentActionState } from '../lib/settle/validation';
import { ConfirmStep, StateMessage } from './groups-panels';

/**
 * The settle-up islands (TR-9, AC-3).
 *
 * Both exports are panels rather than the single row each one looks like it should be, and that
 * is the whole reason for the shape: **a recorded payment changes the list it was recorded from**.
 * Pay a suggested transfer in full and the next read no longer suggests it; delete a payment and
 * its row is gone. A message owned by the row would therefore be destroyed by the very success it
 * is announcing — the transfer disappears, the island unmounts, and the live region announces
 * nothing at all. So the panel holds the one `useActionState` and the one `StateMessage` (TR-9's
 * announcement, AC-3) and outlives every row inside it, while the rows hold only what has to
 * survive a *refusal*: what the user typed, and whether the confirm is open.
 *
 * Nothing here decides anything. The group, the caller's membership and both endpoints are checked
 * again on the server, inside the transaction the payment commits in, so the worst a tampered form
 * achieves is a refusal rendered in the region below it.
 *
 * The amounts are text in a field, not rendered money: `minorUnitsText` is what goes in (the
 * suggested amount, ready to submit unchanged for a full settle-up), `parseMinorUnits` is what
 * comes back out, and `formatMinorUnits` prints whatever is currently typed for the confirm to
 * name — the same three functions the expense editor uses, so a partial payment means there what
 * it means here.
 */

const INPUT_CLASSES =
  'min-h-11 w-full rounded-token border border-muted/40 bg-surface px-3 text-ink placeholder:text-muted';
const QUIET_BUTTON = 'min-h-11 rounded-token border border-muted/40 px-4 font-medium';

/** A recorded payment, as this panel needs it — the row the server read, plus nothing else. */
interface RecordedPayment {
  id: string;
  fromDisplayName: string;
  toDisplayName: string;
  amountMinor: number;
}

/** The text a row's amount field opens with: the whole suggested transfer, ready to submit. */
function suggestedAmountText(amountMinor: number): string {
  return minorUnitsText(amountMinor);
}

function amountLabel(amount: string, currency: string): string {
  const parsed = parseMinorUnits(amount);
  return parsed === null ? amount.trim() : formatMinorUnits(parsed, currency);
}

function TransferRow({
  groupId,
  currency,
  transfer,
  formAction,
  isPending,
  showFieldError,
  onSubmitted,
}: {
  groupId: string;
  currency: string;
  transfer: Transfer;
  formAction: (formData: FormData) => void;
  isPending: boolean;
  /** The last submission was this row's, so the refusal's field error belongs under its input. */
  showFieldError: boolean;
  onSubmitted: () => void;
}) {
  const [amount, setAmount] = useState(suggestedAmountText(transfer.amountMinor));
  const [confirming, setConfirming] = useState(false);
  const fieldId = `settle-amount-${transfer.fromMembershipId}-${transfer.toMembershipId}`;
  const errorId = `${fieldId}-error`;

  return (
    <li className="flex flex-col gap-2 rounded-token border border-muted/20 bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {transfer.fromDisplayName} pays {transfer.toDisplayName}
        </span>
        <span data-amount className="font-semibold">
          {formatMinorUnits(transfer.amountMinor, currency)}
        </span>
      </div>

      <form
        action={formAction}
        noValidate
        onSubmit={(event) => {
          if (isPending) {
            event.preventDefault();
            return;
          }
          onSubmitted();
        }}
        className="flex flex-col gap-2"
      >
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="fromMembershipId" value={transfer.fromMembershipId} />
        <input type="hidden" name="toMembershipId" value={transfer.toMembershipId} />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor={fieldId}>
            {`Amount (${currency})`}
          </label>
          <input
            id={fieldId}
            name="amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={showFieldError}
            aria-describedby={showFieldError ? errorId : undefined}
            className={INPUT_CLASSES}
          />
          {showFieldError ? (
            <p id={errorId} className="text-sm text-danger">
              Check this amount.
            </p>
          ) : null}
        </div>

        {confirming ? (
          <ConfirmStep
            question={`Record a payment of ${amountLabel(amount, currency)} from ${transfer.fromDisplayName} to ${transfer.toDisplayName}?`}
            confirmLabel="Record payment"
            pendingLabel="Recording…"
            isPending={isPending}
            onCancel={() => setConfirming(false)}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setConfirming(true)} className={QUIET_BUTTON}>
              Settle up
            </button>
          </div>
        )}
      </form>
    </li>
  );
}

/**
 * Every suggested transfer, each with the amount it is for and a way to record it.
 *
 * An archived group renders the same list with no forms: its balances are still true and still
 * worth reading, but nothing in it can change (AC-1).
 */
export function SettleUpForm({
  groupId,
  currency,
  transfers,
  archived,
}: {
  groupId: string;
  currency: string;
  transfers: Transfer[];
  archived: boolean;
}) {
  const [state, formAction, isPending] = useActionState(createPayment, IDLE_PAYMENT_STATE);
  // Which row submitted last, so a refused amount is marked where it was typed rather than
  // somewhere in the list above it.
  const [submitted, setSubmitted] = useState<string | null>(null);
  const errors: PaymentActionState['fieldErrors'] = state.fieldErrors;

  // The settled branch still renders the live region, and that is not decoration: the last
  // payment of a group is exactly the one that empties this list, so a panel that returned a
  // bare sentence here would unmount the announcement on the one submit that most needs it.
  if (transfers.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          Everyone is settled up — there is nothing to pay.
        </p>
        <StateMessage state={state} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {transfers.map((transfer) => {
          const key = `${transfer.fromMembershipId}:${transfer.toMembershipId}`;

          return archived ? (
            <li
              key={key}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-token border border-muted/20 bg-surface p-3"
            >
              <span className="font-medium">
                {transfer.fromDisplayName} pays {transfer.toDisplayName}
              </span>
              <span data-amount className="font-semibold">
                {formatMinorUnits(transfer.amountMinor, currency)}
              </span>
            </li>
          ) : (
            <TransferRow
              key={key}
              groupId={groupId}
              currency={currency}
              transfer={transfer}
              formAction={formAction}
              isPending={isPending}
              showFieldError={submitted === key && errors?.amount !== undefined}
              onSubmitted={() => setSubmitted(key)}
            />
          );
        })}
      </ul>

      {/* Panel level, once: whichever attempt last came back is the one worth announcing, and it
          outlives the row it was made from. */}
      <StateMessage state={state} />
    </div>
  );
}

function PaymentRow({
  groupId,
  currency,
  payment,
  formAction,
  isPending,
  archived,
}: {
  groupId: string;
  currency: string;
  payment: RecordedPayment;
  formAction: (formData: FormData) => void;
  isPending: boolean;
  archived: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="flex flex-col gap-2 rounded-token border border-muted/20 bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {payment.fromDisplayName} paid {payment.toDisplayName}
        </span>
        <span data-amount className="font-semibold">
          {formatMinorUnits(payment.amountMinor, currency)}
        </span>
      </div>

      {archived ? null : (
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="paymentId" value={payment.id} />
          {confirming ? (
            <ConfirmStep
              question={`Delete the payment of ${formatMinorUnits(payment.amountMinor, currency)} from ${payment.fromDisplayName} to ${payment.toDisplayName}?`}
              confirmLabel="Delete payment"
              pendingLabel="Deleting…"
              isPending={isPending}
              onCancel={() => setConfirming(false)}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setConfirming(true)} className={QUIET_BUTTON}>
                Delete
              </button>
            </div>
          )}
        </form>
      )}
    </li>
  );
}

/**
 * The payments this group has recorded, newest first, each deletable behind a confirm.
 *
 * The control is offered on every payment rather than only the ones the viewer is part of, and
 * that is deliberate: the refusal for a payment that is none of their business is part of the
 * contract (TR-3, AC-3), and a refusal a member can only reach by crafting a request is a refusal
 * nobody can test from the screen. The server is what decides, and it answers the non-involved
 * delete exactly as it answers a payment that does not exist.
 */
export function DeletePaymentForm({
  groupId,
  currency,
  payments,
  archived,
}: {
  groupId: string;
  currency: string;
  payments: RecordedPayment[];
  archived: boolean;
}) {
  const [state, formAction, isPending] = useActionState(deletePayment, IDLE_PAYMENT_STATE);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-lg font-semibold">Recorded payments</h3>

      {payments.length === 0 ? (
        <p className="text-sm text-muted">
          No payments yet. Settle up and every payment recorded here can be deleted by the people
          it involves.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {payments.map((payment) => (
            <PaymentRow
              key={payment.id}
              groupId={groupId}
              currency={currency}
              payment={payment}
              formAction={formAction}
              isPending={isPending}
              archived={archived}
            />
          ))}
        </ul>
      )}

      {/* Panel level, for the same reason as the settle-up panel's: a deleted payment takes its
          own row with it, and the announcement has to outlive it. */}
      <StateMessage state={state} />
    </div>
  );
}
