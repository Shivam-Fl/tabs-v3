'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { createExpense, deleteExpense, updateExpense } from '../lib/expenses/actions';
import type { EditorParticipant, EditorPayer, ExpenseEditorData } from '../lib/expenses/queries';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  IDLE_EXPENSE_STATE,
  NO_PARTICIPANT_MESSAGE,
  NO_PAYER_MESSAGE,
  PAYER_PART_INVALID_MESSAGE,
  PAYER_PART_POSITIVE_MESSAGE,
  SPLIT_TYPE_LABELS,
  paidPartsMessage,
  percentPartsMessage,
  splitPartsMessage,
  splitValueMessage,
  type ExpenseActionState,
} from '../lib/expenses/validation';
import {
  PERCENT_SCALE,
  SPLIT_TYPES,
  parseBasisPoints,
  parseMinorUnits,
  parseShares,
  shortfallMinor,
  type SplitType,
} from '../lib/money/splits';

/**
 * The expense editor (TR-8): one island for creating and for editing, so the rules about what a
 * valid expense is are written once and the two screens cannot drift apart.
 *
 * It is a form, and it behaves like one. Every control edits state rather than the DOM, the
 * server's answer is rendered beside the fields it is about, and a refused save leaves every
 * character where it was — which is the whole reason this is a client component at all.
 *
 * What it does **not** do is decide. The lines under the payer rows and the split rows are
 * advice, spoken in the same sentences the server refuses with, computed with the same integer
 * arithmetic; `lib/expenses/validation.ts` is what actually gates the write, and a submission
 * that skipped the browser entirely would be judged identically. Nothing here can name a member,
 * a currency or a group the server did not hand it.
 *
 * Amounts are text in and out: the field holds "12.50", the boundary parses it to 1250, and
 * reopening an expense prints 1250 back as "12.50". A `type="number"` input would put the
 * locale, the spinner and the browser's own floating point between the person and the ledger.
 */

const INPUT_CLASSES =
  'min-h-11 w-full rounded-token border border-muted/40 bg-surface px-3 text-ink placeholder:text-muted';
const LABEL_CLASSES = 'text-sm font-medium';
const PRIMARY_BUTTON =
  'min-h-11 rounded-token bg-accent px-4 font-medium text-surface disabled:opacity-60';
const QUIET_BUTTON = 'min-h-11 rounded-token border border-muted/40 px-4 font-medium';
const DANGER_BUTTON = 'min-h-11 rounded-token border border-danger/50 px-4 font-medium text-danger';
const CHIP_ON =
  'flex min-h-11 cursor-pointer items-center rounded-token border border-accent px-3 text-sm font-medium text-accent';
const CHIP_OFF =
  'flex min-h-11 cursor-pointer items-center rounded-token border border-muted/40 px-3 text-sm font-medium';

function StateMessage({ state }: { state: ExpenseActionState }) {
  if (state.status === 'idle' || state.message === '') return null;

  return (
    <p
      role={state.status === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      className={state.status === 'error' ? 'text-sm text-danger' : 'text-sm text-lent'}
    >
      {state.message}
    </p>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-danger">
      {message}
    </p>
  );
}

/** A line about the numbers as they stand: advice while typing, never a substitute for the save. */
function LiveNote({ tone, text }: { tone: 'ok' | 'bad'; text: string }) {
  return (
    <p aria-live="polite" className={tone === 'ok' ? 'text-sm text-muted' : 'text-sm text-danger'}>
      {text}
    </p>
  );
}

function unitHint(splitType: SplitType): string {
  if (splitType === 'percentage') return '%';
  if (splitType === 'shares') return 'shares';
  return '';
}

/** What one member's input means for the type that is showing, for the field's own label. */
function valueLabel(splitType: SplitType, name: string): string {
  if (splitType === 'percentage') return `Percentage for ${name}`;
  if (splitType === 'shares') return `Shares for ${name}`;
  return `Amount for ${name}`;
}

function parseValue(splitType: SplitType, raw: string): number | null {
  if (splitType === 'exact') return parseMinorUnits(raw);
  if (splitType === 'percentage') return parseBasisPoints(raw);
  if (splitType === 'shares') return parseShares(raw);
  return null;
}

export function ExpenseEditor({
  groupId,
  expenseId,
  currency,
  data,
}: {
  groupId: string;
  /** Null on the create screen; on the edit screen, the id the update re-reads in its transaction. */
  expenseId: string | null;
  currency: string;
  data: ExpenseEditorData;
}) {
  const [state, formAction, isPending] = useActionState(
    expenseId === null ? createExpense : updateExpense,
    IDLE_EXPENSE_STATE,
  );

  const [description, setDescription] = useState(data.description);
  const [amount, setAmount] = useState(data.amount);
  const [date, setDate] = useState(data.date);
  const [category, setCategory] = useState(data.category);
  const [note, setNote] = useState(data.note);
  const [splitType, setSplitType] = useState<SplitType>(data.splitType);
  const [payers, setPayers] = useState<EditorPayer[]>(data.payers);
  const [participants, setParticipants] = useState<EditorParticipant[]>(data.participants);

  const errors = state.fieldErrors ?? {};
  const summary =
    state.status === 'error' && Object.keys(errors).length === 0 ? state.message : null;
  const totalMinor = parseMinorUnits(amount);
  const included = participants.filter((participant) => participant.included);

  /**
   * One payer is the ordinary case: whoever is entering the expense paid for it, and their part
   * is the whole. Keeping that row in step with the amount is what stops the common path from
   * asking for the same number twice — with two payers, the parts are the person's business.
   */
  function changeAmount(value: string) {
    setAmount(value);
    if (payers.length === 1) setPayers([{ ...payers[0], amount: value }]);
  }

  function changePayers(next: EditorPayer[]) {
    // Down to one payer, and the whole amount is theirs: say so rather than leave a stale part.
    setPayers(next.length === 1 ? [{ ...next[0], amount }] : next);
  }

  function addPayer() {
    const used = new Set(payers.map((payer) => payer.membershipId));
    const next = participants.find((participant) => !used.has(participant.membershipId));
    if (!next) return;
    changePayers([
      ...payers,
      { membershipId: next.membershipId, displayName: next.displayName, amount: '' },
    ]);
  }

  function changeParticipant(membershipId: string, patch: Partial<EditorParticipant>) {
    setParticipants((current) =>
      current.map((participant) =>
        participant.membershipId === membershipId ? { ...participant, ...patch } : participant,
      ),
    );
  }

  /** The payer parts against the amount, in the server's own words. */
  function payerNote(): { tone: 'ok' | 'bad'; text: string } | null {
    if (totalMinor === null) return null;

    const parts = payers.map((payer) => parseMinorUnits(payer.amount));
    if (parts.some((part) => part === null)) return { tone: 'bad', text: PAYER_PART_INVALID_MESSAGE };
    if (parts.some((part) => part === 0)) {
      return { tone: 'bad', text: PAYER_PART_POSITIVE_MESSAGE };
    }

    const paid = (parts as number[]).reduce((sum, part) => sum + part, 0);
    if (shortfallMinor(totalMinor, [paid]) !== 0) {
      return { tone: 'bad', text: paidPartsMessage(paid, totalMinor, currency) };
    }

    return { tone: 'ok', text: 'The paid parts add up.' };
  }

  /** The split against the amount, in whichever unit the chosen type names. */
  function splitNote(): { tone: 'ok' | 'bad'; text: string } | null {
    if (included.length === 0) return { tone: 'bad', text: NO_PARTICIPANT_MESSAGE };
    if (splitType === 'equal') {
      return { tone: 'ok', text: `Split equally between ${included.length}.` };
    }

    const values = included.map((participant) => parseValue(splitType, participant.value));
    if (values.some((value) => value === null)) {
      return { tone: 'bad', text: splitValueMessage(splitType) };
    }
    const parts = values as number[];

    if (splitType === 'exact') {
      if (totalMinor === null) return null;
      const split = parts.reduce((sum, part) => sum + part, 0);
      if (shortfallMinor(totalMinor, parts) !== 0) {
        return { tone: 'bad', text: splitPartsMessage(split, totalMinor, currency) };
      }
      return { tone: 'ok', text: 'The split adds up.' };
    }

    if (splitType === 'percentage') {
      const basisPoints = parts.reduce((sum, part) => sum + part, 0);
      if (basisPoints !== PERCENT_SCALE) {
        return { tone: 'bad', text: percentPartsMessage(basisPoints) };
      }
      return { tone: 'ok', text: 'The percentages add up.' };
    }

    // Shares need no total: every included member holds at least one, and the ratio is the rule.
    const shares = parts.reduce((sum, part) => sum + part, 0);
    return { tone: 'ok', text: `${shares} shares between ${included.length}.` };
  }

  const paidNote = payerNote();
  const splitLiveNote = splitNote();

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="groupId" value={groupId} />
      {expenseId === null ? null : <input type="hidden" name="expenseId" value={expenseId} />}

      {summary ? (
        <p role="alert" className="text-sm text-danger">
          {summary}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <label className={LABEL_CLASSES} htmlFor="expense-description">
          Description
        </label>
        <input
          id="expense-description"
          name="description"
          type="text"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Dinner"
          aria-invalid={errors.description !== undefined}
          aria-describedby={errors.description ? 'expense-description-error' : undefined}
          className={INPUT_CLASSES}
        />
        <FieldError id="expense-description-error" message={errors.description} />
      </div>

      <div className="flex flex-col gap-2">
        <label className={LABEL_CLASSES} htmlFor="expense-amount">
          {`Amount (${currency})`}
        </label>
        <input
          id="expense-amount"
          name="amount"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(event) => changeAmount(event.target.value)}
          placeholder="12.50"
          aria-invalid={errors.amount !== undefined}
          aria-describedby={errors.amount ? 'expense-amount-error' : undefined}
          className={INPUT_CLASSES}
        />
        <FieldError id="expense-amount-error" message={errors.amount} />
      </div>

      <div className="flex flex-col gap-2">
        <label className={LABEL_CLASSES} htmlFor="expense-date">
          Date
        </label>
        <input
          id="expense-date"
          name="date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          aria-invalid={errors.date !== undefined}
          aria-describedby={errors.date ? 'expense-date-error' : undefined}
          className={INPUT_CLASSES}
        />
        <FieldError id="expense-date-error" message={errors.date} />
      </div>

      <div className="flex flex-col gap-2">
        <label className={LABEL_CLASSES} htmlFor="expense-category">
          Category
        </label>
        <select
          id="expense-category"
          name="category"
          value={category}
          onChange={(event) => setCategory(event.target.value as typeof category)}
          aria-invalid={errors.category !== undefined}
          aria-describedby={errors.category ? 'expense-category-error' : undefined}
          className={INPUT_CLASSES}
        >
          {EXPENSE_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {EXPENSE_CATEGORY_LABELS[value]}
            </option>
          ))}
        </select>
        <FieldError id="expense-category-error" message={errors.category} />
      </div>

      <section className="flex flex-col gap-3 rounded-token border border-muted/20 bg-surface p-4">
        <h2 className="text-lg font-semibold">Who paid</h2>
        <p className="text-sm text-muted">
          One payer for the whole amount, or the parts split between several. The parts must add
          up to the amount.
        </p>

        <ul className="flex flex-col gap-2">
          {payers.map((payer, index) => (
            <li key={payer.membershipId} className="flex flex-wrap items-end gap-2">
              <div className="flex w-full flex-col gap-1 sm:w-56">
                <label className="text-sm text-muted" htmlFor={`payer-${index}-member`}>
                  {`Payer ${index + 1}`}
                </label>
                <select
                  id={`payer-${index}-member`}
                  name={`payer.${index}.membershipId`}
                  value={payer.membershipId}
                  onChange={(event) => {
                    const chosen = participants.find(
                      (participant) => participant.membershipId === event.target.value,
                    );
                    changePayers(
                      payers.map((row, position) =>
                        position === index
                          ? {
                              ...row,
                              membershipId: event.target.value,
                              displayName: chosen?.displayName ?? '',
                            }
                          : row,
                      ),
                    );
                  }}
                  className={INPUT_CLASSES}
                >
                  {participants.map((participant) => (
                    <option key={participant.membershipId} value={participant.membershipId}>
                      {participant.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex w-full flex-col gap-1 sm:w-40">
                <label className="text-sm text-muted" htmlFor={`payer-${index}-amount`}>
                  {`${payer.displayName} paid`}
                </label>
                <input
                  id={`payer-${index}-amount`}
                  name={`payer.${index}.amount`}
                  type="text"
                  inputMode="decimal"
                  value={payer.amount}
                  onChange={(event) =>
                    changePayers(
                      payers.map((row, position) =>
                        position === index ? { ...row, amount: event.target.value } : row,
                      ),
                    )
                  }
                  placeholder="0.00"
                  readOnly={payers.length === 1}
                  className={INPUT_CLASSES}
                />
              </div>

              {payers.length > 1 ? (
                <button
                  type="button"
                  onClick={() => changePayers(payers.filter((_, position) => position !== index))}
                  className={QUIET_BUTTON}
                >
                  {`Remove ${payer.displayName}`}
                </button>
              ) : null}
            </li>
          ))}
        </ul>

        {payers.length === 1 ? (
          <p className="text-sm text-muted">The payer covers the whole amount.</p>
        ) : null}

        {payers.length < participants.length ? (
          <div>
            <button type="button" onClick={addPayer} className={QUIET_BUTTON}>
              Add another payer
            </button>
          </div>
        ) : null}

        <FieldError id="expense-payers-error" message={errors.payers} />
        {payers.length === 0 ? (
          <LiveNote tone="bad" text={NO_PAYER_MESSAGE} />
        ) : paidNote ? (
          <LiveNote tone={paidNote.tone} text={paidNote.text} />
        ) : null}
      </section>

      <section className="flex flex-col gap-3 rounded-token border border-muted/20 bg-surface p-4">
        <fieldset className="flex flex-col gap-2">
          <legend className={LABEL_CLASSES}>How is it split?</legend>
          <div className="flex flex-wrap gap-2">
            {SPLIT_TYPES.map((value) => (
              <label key={value} className={splitType === value ? CHIP_ON : CHIP_OFF}>
                <input
                  type="radio"
                  name="splitType"
                  value={value}
                  checked={splitType === value}
                  onChange={() => setSplitType(value)}
                  className="sr-only"
                />
                {SPLIT_TYPE_LABELS[value]}
              </label>
            ))}
          </div>
        </fieldset>
        <FieldError id="expense-split-type-error" message={errors.splitType} />

        <ul className="flex flex-col gap-2">
          {participants.map((participant, index) => (
            <li
              key={participant.membershipId}
              className="flex flex-wrap items-center gap-3 rounded-token border border-muted/20 p-2"
            >
              <input
                type="hidden"
                name={`split.${index}.membershipId`}
                value={participant.membershipId}
              />
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  name={`split.${index}.included`}
                  value="1"
                  checked={participant.included}
                  onChange={(event) =>
                    changeParticipant(participant.membershipId, { included: event.target.checked })
                  }
                />
                <span className="font-medium">{participant.displayName}</span>
              </label>

              {splitType === 'equal' ? null : (
                <div className="flex items-center gap-2">
                  <label className="sr-only" htmlFor={`split-${index}-value`}>
                    {valueLabel(splitType, participant.displayName)}
                  </label>
                  <input
                    id={`split-${index}-value`}
                    name={`split.${index}.value`}
                    type="text"
                    inputMode="decimal"
                    value={participant.value}
                    onChange={(event) =>
                      changeParticipant(participant.membershipId, { value: event.target.value })
                    }
                    placeholder={splitType === 'shares' ? '1' : '0.00'}
                    className={`${INPUT_CLASSES} w-28`}
                  />
                  <span className="text-sm text-muted">{unitHint(splitType)}</span>
                </div>
              )}
            </li>
          ))}
        </ul>

        <FieldError id="expense-splits-error" message={errors.splits} />
        {splitLiveNote ? <LiveNote tone={splitLiveNote.tone} text={splitLiveNote.text} /> : null}
      </section>

      <div className="flex flex-col gap-2">
        <label className={LABEL_CLASSES} htmlFor="expense-note">
          Note (optional)
        </label>
        <textarea
          id="expense-note"
          name="note"
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-invalid={errors.note !== undefined}
          aria-describedby={errors.note ? 'expense-note-error' : undefined}
          className={INPUT_CLASSES}
        />
        <FieldError id="expense-note-error" message={errors.note} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={isPending} aria-busy={isPending} className={PRIMARY_BUTTON}>
          {isPending ? 'Saving…' : expenseId === null ? 'Add expense' : 'Save expense'}
        </button>
        <Link className="text-accent underline" href={`/groups/${groupId}`}>
          Cancel
        </Link>
        <StateMessage state={state} />
      </div>
    </form>
  );
}

/**
 * Deleting, both on the row in the expense list and on the expense's own page: a server-rendered
 * form behind a client-side confirm, because the alternative — a native `confirm()` — is the one
 * control a keyboard user loses and a browser agent cannot drive.
 *
 * The question names the expense, so a click on the wrong row is caught by reading rather than by
 * remembering which button was which. Success is a redirect to the group with the note; what
 * stays here is the refusal, because this form is still on screen to show it.
 */
export function DeleteExpenseForm({
  groupId,
  expenseId,
  description,
}: {
  groupId: string;
  expenseId: string;
  description: string;
}) {
  const [state, formAction, isPending] = useActionState(deleteExpense, IDLE_EXPENSE_STATE);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <button type="button" onClick={() => setConfirming(true)} className={DANGER_BUTTON}>
            Delete
          </button>
        </div>
        <StateMessage state={state} />
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="expenseId" value={expenseId} />
      <div className="flex flex-col gap-2 rounded-token border border-danger/40 p-3">
        <p role="alert" className="text-sm">
          {`Delete “${description}”? It leaves the group and stops counting towards every balance.`}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={isPending} aria-busy={isPending} className={DANGER_BUTTON}>
            {isPending ? 'Deleting…' : 'Delete expense'}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className={QUIET_BUTTON}>
            Cancel
          </button>
        </div>
        <StateMessage state={state} />
      </div>
    </form>
  );
}
