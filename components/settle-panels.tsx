'use client';

import { useActionState, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { formatMinorUnits } from '../lib/money/format';
import { minorUnitsText, parseMinorUnits } from '../lib/money/splits';
import { createPayment, deletePayment } from '../lib/settle/actions';
import type { Transfer } from '../lib/settle/simplify';
import { IDLE_PAYMENT_STATE, type PaymentActionState } from '../lib/settle/validation';
import { Button, ConfirmStep, MoneyInput, StateMessage } from './ui';
import { Dialog, MENU_ITEM_CLASSES, Menu, MenuPanel } from './ui-interactive';

/**
 * The settle-up islands (TR-9, AC-3, AC-5, AC-6, AC-7).
 *
 * Both exports are panels rather than the single row each one looks like it should be, and that
 * is the whole reason for the shape: **a recorded payment changes the list it was recorded from**.
 * Pay a suggested transfer in full and the next read no longer suggests it; delete a payment and
 * its row is gone. A message owned by the row would therefore be destroyed by the very success it
 * is announcing — the transfer disappears, the island unmounts, and the live region announces
 * nothing at all. So the panel holds the one `useActionState` and the one `StateMessage` (TR-9's
 * announcement, AC-3) and outlives every row inside it.
 *
 * **Success now leaves the page** (ADR-0008, AC-6). Recording or deleting redirects to the group
 * carrying `?payment=recorded&from=<id>&to=<id>`, and the debts card renders the notice in its own
 * panel-level slot, because the row that held the form is unmounted by the outcome it would have
 * announced. What is left for the live region here is a refusal, which is exactly the split
 * ADR-0008 asks for. A refusal never redirects: the sheet stays open, holding what was typed.
 *
 * The settle-up flow is a sheet, not a form on every row (ui.md, the ux skill). A row shows who
 * pays whom and the suggested amount; "Settle up" opens a bottom sheet on phones and a centred
 * dialog on desktop with that amount prefilled and editable, one Record payment and one cancel.
 * The sheet body is its own export so a test without a DOM can render it and read the prefill it
 * opens with — the amount it starts from is `minorUnitsText` of that row's own suggestion.
 *
 * Nothing here decides anything. The group, the caller's membership and both endpoints are checked
 * again on the server, inside the transaction the payment commits in, so the worst a tampered form
 * achieves is a refusal rendered in the region below it.
 */

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

/**
 * A suggested transfer's identity as a React key: both endpoints **and the amount it is for**.
 *
 * The amount belongs in here, and leaving it out was the bug (BUG-2). A row holds what the user
 * typed in `useState`, initialized once, and recording a partial payment revalidates this page so
 * the same two endpoints come back with a shrunken suggestion. Under an endpoints-only key React
 * reuses the mounted row: the field keeps the fragment just paid while the suggestion printed
 * beside it has already moved. Keying by the amount too remounts exactly the row whose suggestion
 * changed, so its field re-initializes from the remainder instead (AC-10).
 *
 * A refused submit moves no amount, so the key is stable, the row is not remounted, and the sheet
 * that holds the typed value stays under the row that submitted (TR-9). Both behaviours are pinned
 * by `app/groups/[id]/settle-row-identity.test.ts`.
 */
export function transferRowKey(
  transfer: Pick<Transfer, 'fromMembershipId' | 'toMembershipId' | 'amountMinor'>,
): string {
  return `${transfer.fromMembershipId}:${transfer.toMembershipId}:${transfer.amountMinor}`;
}

/**
 * What the open sheet says, apart from the state that opens it.
 *
 * It is exported, and it is its own component, for the reason the account menu's panel is: the
 * repo has no jsdom, so a form that only exists after a click is a form no test in this tree can
 * see. `renderToStaticMarkup` of this component is the markup a person gets the moment the sheet
 * opens, which is where the prefill lives — and the prefill is the row's own suggestion, read back
 * through the same `minorUnitsText` the write path parses.
 *
 * The amount is state here rather than in the row because the sheet unmounts when it closes: every
 * open therefore starts from the suggestion again, with the refusal state as clean as the amount.
 * A refusal keeps the sheet mounted, so what was typed survives it.
 *
 * The refusal is the field's own sentence, beside the field, wired to it by `aria-describedby` —
 * `MoneyInput`'s business, not this island's. The panel's region stands down while the refusal has
 * a field to sit beside (see `SettleUpForm`), so the sentence is on the page once; nothing in here
 * introduces a live region of its own (AC-8).
 *
 * `onSubmitted` exists because only the sheet the person can see is mounted — every other row's
 * dialog renders nothing — so the panel cannot tell from `state` alone which row refused, and a
 * refusal has to stay off the next sheet somebody opens.
 */
export function SettleSheetBody({
  groupId,
  currency,
  transfer,
  formAction,
  isPending,
  refusal,
  onSubmitted,
  onCancel,
}: {
  groupId: string;
  currency: string;
  transfer: Pick<
    Transfer,
    'fromMembershipId' | 'toMembershipId' | 'fromDisplayName' | 'toDisplayName' | 'amountMinor'
  >;
  formAction: (formData: FormData) => void;
  isPending: boolean;
  /** The server's word for the amount, when this sheet's own submission was the one refused. */
  refusal?: string;
  /** Called as this sheet is submitted, so the panel can remember which row is the one refused. */
  onSubmitted?: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(suggestedAmountText(transfer.amountMinor));

  return (
    <form action={formAction} noValidate onSubmit={onSubmitted} className="flex flex-col gap-3">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="fromMembershipId" value={transfer.fromMembershipId} />
      <input type="hidden" name="toMembershipId" value={transfer.toMembershipId} />

      <MoneyInput
        id={`settle-amount-${transfer.fromMembershipId}-${transfer.toMembershipId}`}
        name="amount"
        label={`Amount (${currency})`}
        currency={currency}
        type="text"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        placeholder="0.00"
        error={refusal}
      />

      {/* A payment carries the moment it is recorded and nothing else — the schema gives it no
          date — so the sheet says so rather than offering a picker that would change nothing. */}
      <p className="text-secondary text-ink-muted">
        {`Recording ${amountLabel(amount, currency)} now, with the date it is entered.`}
      </p>

      <ConfirmStep
        question={`Record a payment of ${amountLabel(amount, currency)} from ${transfer.fromDisplayName} to ${transfer.toDisplayName}?`}
        confirmLabel="Record payment"
        pendingLabel="Recording…"
        isPending={isPending}
        onCancel={onCancel}
      />
    </form>
  );
}

function TransferRow({
  groupId,
  currency,
  transfer,
  formAction,
  isPending,
  open,
  refusal,
  onOpen,
  onSubmitted,
  onClose,
}: {
  groupId: string;
  currency: string;
  transfer: Transfer;
  formAction: (formData: FormData) => void;
  isPending: boolean;
  open: boolean;
  refusal?: string;
  onOpen: () => void;
  onSubmitted: () => void;
  onClose: () => void;
}) {
  const title = `${transfer.fromDisplayName} pays ${transfer.toDisplayName}`;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-token border border-border bg-surface p-3">
      <span className="min-w-0 flex-1 truncate font-medium text-ink" title={title}>
        {title}
      </span>
      <span data-amount className="font-semibold tabular-nums text-ink">
        {formatMinorUnits(transfer.amountMinor, currency)}
      </span>
      <Button type="button" variant="secondary" size="sm" onClick={onOpen}>
        Settle up
      </Button>

      {/* The dialog names who pays whom in its heading, so the sheet opens already knowing what it
          is about, and a thumb finds the confirm at the bottom of the sheet on a phone. */}
      <Dialog open={open} title={title} variant="sheet" onClose={onClose}>
        <SettleSheetBody
          groupId={groupId}
          currency={currency}
          transfer={transfer}
          formAction={formAction}
          isPending={isPending}
          refusal={refusal}
          onSubmitted={onSubmitted}
          onCancel={onClose}
        />
      </Dialog>
    </li>
  );
}

/**
 * Every suggested transfer, each with the amount it is for and a way to record it.
 *
 * An archived group renders the same list with no buttons at all: its balances are still true and
 * still worth reading, but nothing in it can change (AC-1, AC-5).
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
  // Which transfer's sheet is open, and which transfer last submitted — so a refused amount is
  // marked in the sheet it was typed in rather than in the next one somebody opens.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [attemptedKey, setAttemptedKey] = useState<string | null>(null);
  const errors: PaymentActionState['fieldErrors'] = state.fieldErrors;
  // The refusal the panel's region carries: one that names a field is shown beside that field, in
  // the sheet it was typed in, and nowhere else — the expense editor's rule, so a refusal sentence
  // is never in two places on the page at once (conventions; PR #20 BUG-1). What is left for the
  // region is the refusal about the request as a whole: a group that is gone, two seats that have
  // both left. The region itself stays mounted either way, empty on every cold load (AC-8).
  const summary =
    state.status === 'error' && Object.keys(errors ?? {}).length > 0 ? IDLE_PAYMENT_STATE : state;

  // The settled branch still renders the live region, and that is not decoration: the last
  // payment of a group is exactly the one that empties this list, so a panel that returned a
  // bare sentence here would unmount the announcement on the one submit that most needs it.
  if (transfers.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-secondary text-ink-muted">
          Everyone is settled up — there is nothing to pay.
        </p>
        <StateMessage state={summary} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {transfers.map((transfer) => {
          // Endpoints and amount: the same row key the refusal marker is compared against below,
          // so a row that re-initializes and a sheet that keeps what was typed are decided by one
          // expression rather than two that could drift.
          const key = transferRowKey(transfer);

          if (archived) {
            return (
              <li
                key={key}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-token border border-border bg-surface p-3"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-ink" title={`${transfer.fromDisplayName} pays ${transfer.toDisplayName}`}>
                  {transfer.fromDisplayName} pays {transfer.toDisplayName}
                </span>
                <span data-amount className="font-semibold tabular-nums text-ink">
                  {formatMinorUnits(transfer.amountMinor, currency)}
                </span>
              </li>
            );
          }

          return (
            <TransferRow
              key={key}
              groupId={groupId}
              currency={currency}
              transfer={transfer}
              formAction={formAction}
              isPending={isPending}
              open={openKey === key}
              refusal={attemptedKey === key ? errors?.amount : undefined}
              onSubmitted={() => setAttemptedKey(key)}
              onOpen={() => {
                // Every open starts clean: the previous sheet's attempt is forgotten before this
                // one is shown, so no refusal arrives attached to a transfer it was not about.
                setAttemptedKey(null);
                setOpenKey(key);
              }}
              onClose={() => setOpenKey(null)}
            />
          );
        })}
      </ul>

      {/* Panel level, once, and mounted empty on every cold load (AC-8). It never moves, whatever
          is open over it, so a refusal about the group as a whole is announced in a region that
          was already on the page rather than one inserted with the text. */}
      <StateMessage state={summary} />
    </div>
  );
}

/** A recorded payment, as the row renders it. The panel owns the dialog that deletes it. */
function PaymentRow({
  currency,
  payment,
  archived,
  onDelete,
}: {
  currency: string;
  payment: RecordedPayment;
  archived: boolean;
  onDelete: () => void;
}) {
  const title = `${payment.fromDisplayName} paid ${payment.toDisplayName}`;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-token border border-border bg-surface p-3">
      <span className="min-w-0 flex-1 truncate font-medium text-ink" title={title}>
        {title}
      </span>
      <span data-amount className="font-semibold tabular-nums text-ink">
        {formatMinorUnits(payment.amountMinor, currency)}
      </span>

      {/* A row's destructive action lives behind its overflow menu rather than on the row: the
          list must not read as a list of red buttons (ui.md, the ux skill). */}
      {archived ? null : (
        <Menu
          label={`Actions for the payment from ${payment.fromDisplayName} to ${payment.toDisplayName}`}
          triggerLabel={`Actions for the payment from ${payment.fromDisplayName} to ${payment.toDisplayName}`}
          trigger={<MoreHorizontal className="size-5" aria-hidden="true" />}
          panel={({ menuId, onClose, onItemMount }) => (
            <MenuPanel
              id={menuId}
              label={`Actions for the payment from ${payment.fromDisplayName} to ${payment.toDisplayName}`}
            >
              <button
                ref={(element) => onItemMount(0, element)}
                type="button"
                role="menuitem"
                onClick={() => {
                  onClose();
                  onDelete();
                }}
                className={MENU_ITEM_CLASSES}
              >
                Delete
              </button>
            </MenuPanel>
          )}
        />
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
 *
 * The confirm is one dialog for the panel rather than one per row, and the live region moves into
 * it: a refusal has no field to sit beside, so it is the region itself that has to be on screen,
 * and the panel renders exactly one of the two — the panel's copy while no dialog is open, the
 * dialog's while one is. It mounts empty either way, before anything has been submitted.
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
  const [target, setTarget] = useState<RecordedPayment | null>(null);
  const [attemptedId, setAttemptedId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-section font-semibold text-ink">Recorded payments</h3>

      {payments.length === 0 ? (
        <p className="text-secondary text-ink-muted">
          No payments yet. Settle up and every payment recorded here can be deleted by the people
          it involves.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {payments.map((payment) => (
            <PaymentRow
              key={payment.id}
              currency={currency}
              payment={payment}
              archived={archived}
              onDelete={() => {
                // Clean before it opens, for the same reason the sheet is: the last attempt
                // belonged to another payment.
                setAttemptedId(null);
                setTarget(payment);
              }}
            />
          ))}
        </ul>
      )}

      {/* Panel level, for the same reason as the settle-up panel's: a deleted payment takes its
          own row with it, and the announcement has to outlive it. It stands down only while the
          dialog is holding the same region, so the page never has two. */}
      {target === null ? <StateMessage state={state} /> : null}

      <Dialog open={target !== null} title="Delete payment" onClose={() => setTarget(null)}>
        {target === null ? null : (
          <form
            action={formAction}
            className="flex flex-col gap-2"
            onSubmit={() => setAttemptedId(target.id)}
          >
            <input type="hidden" name="groupId" value={groupId} />
            <input type="hidden" name="paymentId" value={target.id} />
            <ConfirmStep
              question={`Delete the payment of ${formatMinorUnits(target.amountMinor, currency)} from ${target.fromDisplayName} to ${target.toDisplayName}? It stops counting towards their balances.`}
              confirmLabel="Delete payment"
              pendingLabel="Deleting…"
              isPending={isPending}
              onCancel={() => setTarget(null)}
            >
              <StateMessage state={attemptedId === target.id ? state : IDLE_PAYMENT_STATE} />
            </ConfirmStep>
          </form>
        )}
      </Dialog>
    </div>
  );
}
