'use client';

import { useActionState, useEffect, useState } from 'react';
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
} from '../lib/expenses/validation';
import { formatMinorUnits } from '../lib/money/format';
import { humanDateLabel } from '../lib/money/human-date';
import {
  PERCENT_SCALE,
  SPLIT_TYPES,
  parseMinorUnits,
  parseSplitValue,
  shortfallMinor,
  splitAmount,
  type SplitInput,
  type SplitType,
} from '../lib/money/splits';
import {
  Avatar,
  Button,
  ConfirmStep,
  FieldError,
  FIELD_CLASSES,
  FIELD_LABEL_CLASSES,
  MoneyInput,
  StateMessage,
  TextInput,
} from './ui';
import { Dialog, SegmentedControl } from './ui-interactive';

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
 * The order is ui.md's: the **amount** first, large and focused, because that is what the person
 * came to type; then what it was for, when, and the category and note. Payer and split come
 * after, on the defaults that need no edits — you paid, split equally — with the per-person rows
 * behind a disclosure rather than in the way. The split type is a segmented control and only the
 * chosen type's inputs show.
 *
 * Amounts are text in and out: the field holds "12.50", the boundary parses it to 1250, and
 * reopening an expense prints 1250 back as "12.50". A `type="number"` input would put the
 * locale, the spinner and the browser's own floating point between the person and the ledger.
 *
 * What a typed split value means is `parseSplitValue`'s, not this island's: the same function the
 * boundary validates with reads the field back, so the advice here and the refusal there cannot
 * disagree about what a stored number is. The class strings and the small shared components come
 * from `components/ui.tsx`, like every other form's.
 *
 * Every field name is exactly the name it has always been — `groupId`, `description`, `amount`,
 * `date`, `category`, `note`, `splitType`, `payer.N.membershipId`, `payer.N.amount`,
 * `split.N.membershipId`, `split.N.included`, `split.N.value` — so the Server Action that judges
 * this form accepts and refuses precisely what it did before. The one that moved and is worth
 * naming: `splitType` used to be four radios and is now a hidden input behind the segmented
 * control, and `payer.N.*` in the ordinary one-payer case are hidden inputs behind the summary
 * line. Same name, same value, same submission.
 */

/** The amount is the biggest thing on the screen, which is what ui.md means by the key number. */
const AMOUNT_FIELD_CLASSES = '[&_input]:text-hero [&_input]:font-semibold [&_span]:text-hero';

/** A line about the numbers as they stand: advice, never a substitute for the save. */
function LiveNote({ tone, text }: { tone: 'ok' | 'bad'; text: string }) {
  return (
    <p aria-live="polite" className={tone === 'ok' ? 'text-secondary text-ink-muted' : 'text-secondary text-danger'}>
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

/**
 * A styled on/off control that is still a checkbox underneath.
 *
 * The platform control is what submits `split.N.included` — checked sends "1", unchecked sends
 * nothing, which is exactly the payload the boundary reads — so the styling is a pair of spans
 * beside a visually hidden input rather than a custom widget that would have to reproduce that.
 * `role="switch"` is what it is: one binary setting per member, on or off.
 *
 * The label is the hit area, because it wraps the input: `min-h-11 min-w-11` makes that box the
 * 44px ui.md asks of a touch target, and the control the input renders is unchanged. The track is
 * `h-6`, which this project's token set resolves to **32px** (`--spacing-6`), not the 24px a
 * default Tailwind scale would give it — that is what it has always been on every screen here, and
 * nothing in this file moves it. The label grows around the track, `items-center` keeps the track
 * and its knob centred in the taller box rather than stretching them, and the focus ring stays on
 * the track. Verified by measuring both boxes with and without the added utilities: the track and
 * knob come back at the same size and the same coordinates, only the label's box changes.
 */
function IncludeSwitch({
  id,
  name,
  checked,
  label,
  onChange,
}: {
  id: string;
  name: string;
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="relative inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center">
      <input
        id={id}
        type="checkbox"
        role="switch"
        name={name}
        value="1"
        checked={checked}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="h-6 w-11 rounded-full border border-border bg-surface-sunken transition-colors peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent"
      />
      <span
        aria-hidden="true"
        className="absolute left-1 size-4 rounded-full bg-surface shadow-sm transition-transform peer-checked:translate-x-5"
      />
    </label>
  );
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
  // The disclosure is open when there is nothing ordinary to show: one payer needs no rows, and
  // no payer at all (a viewer who is not a member) needs them.
  const [severalPayers, setSeveralPayers] = useState(data.payers.length !== 1);
  // Advice that is bad waits for a blur, so the form does not shout at somebody mid-word. The
  // server's refusal is unaffected: it renders when it happens, wherever the person is.
  const [blurred, setBlurred] = useState({ payers: false, splits: false });
  // The clock is read once, after mount, never during render: a label computed on the server and
  // again in the browser disagrees across midnight or a time zone, and that is a hydration error.
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    // The viewer's own calendar day, not the UTC one `toISOString` would slice off: this label
    // sits beside a date picker the person reads on their own clock, and "Today" is the one thing
    // the hint is for. Still in an effect, after mount, so the server render and the hydrated
    // render cannot disagree about it.
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    setToday(`${now.getFullYear()}-${month}-${day}`);
  }, []);

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

  /** Back to the default: the first payer covers everything, and the rows go away. */
  function collapsePayers() {
    const first = payers[0];
    if (!first) return;
    setPayers([{ ...first, amount }]);
    setSeveralPayers(false);
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

    return null;
  }

  /** The split against the amount, in whichever unit the chosen type names. */
  function splitNote(): { tone: 'ok' | 'bad'; text: string } | null {
    if (included.length === 0) return { tone: 'bad', text: NO_PARTICIPANT_MESSAGE };
    if (splitType === 'equal') {
      return { tone: 'ok', text: `Split equally between ${included.length}.` };
    }

    const values = included.map((participant) => parseSplitValue(splitType, participant.value));
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
      return {
        tone: 'ok',
        text: `The parts add up to ${formatMinorUnits(totalMinor, currency)}, the whole expense.`,
      };
    }

    if (splitType === 'percentage') {
      const basisPoints = parts.reduce((sum, part) => sum + part, 0);
      if (basisPoints !== PERCENT_SCALE) {
        return { tone: 'bad', text: percentPartsMessage(basisPoints) };
      }
      return { tone: 'ok', text: 'The percentages add up to 100%.' };
    }

    // Shares need no total: every included member holds at least one, and the ratio is the rule.
    const shares = parts.reduce((sum, part) => sum + part, 0);
    return { tone: 'ok', text: `${shares} shares between ${included.length}.` };
  }

  /**
   * What each member owes of the amount as it stands, or null while the numbers cannot be asked
   * about — no amount yet, or an input that is not a number.
   *
   * It is `splitAmount` that answers, the same function the write path stores the shares with, so
   * the number beside a member's row is the number their balance will move by rather than a
   * second opinion about it.
   */
  function liveShares(): Map<string, number> | null {
    if (totalMinor === null) return null;

    const inputs: SplitInput[] = participants.map((participant) => ({
      membershipId: participant.membershipId,
      included: participant.included,
      value: splitType === 'equal' ? null : parseSplitValue(splitType, participant.value),
    }));
    const readable = inputs.every(
      (input) => !input.included || splitType === 'equal' || input.value !== null,
    );
    if (!readable || inputs.every((input) => !input.included)) return null;

    const shares = splitAmount(totalMinor, splitType, inputs, payers.map((payer) => payer.membershipId));
    return new Map(shares.map((share) => [share.membershipId, share.shareMinor]));
  }

  const shares = liveShares();

  /**
   * The lines under the payer rows and the split rows. A section the server has just refused
   * stands down here, because the `FieldError` above it is already carrying that sentence — the
   * refusal and the live line are the same words, and one failed rule gets one sentence in the
   * page (AC-9). The split's positive line stays live: it is the running total AC-3 asks for.
   */
  const paidNote = errors.payers ? null : payers.length === 0 ? { tone: 'bad' as const, text: NO_PAYER_MESSAGE } : payerNote();
  const showPaidNote = paidNote !== null && (paidNote.tone === 'ok' || blurred.payers || payers.length === 0);
  const splitNoteText = errors.splits ? null : splitNote();
  const showSplitNote =
    splitNoteText !== null && (splitNoteText.tone === 'ok' || blurred.splits);

  const firstPayer = payers[0];
  const dateLabel = today === null ? null : humanDateLabel(date, today);

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="groupId" value={groupId} />
      {expenseId === null ? null : <input type="hidden" name="expenseId" value={expenseId} />}

      {summary ? (
        <p role="alert" className="text-secondary text-danger">
          {summary}
        </p>
      ) : null}

      <div className={AMOUNT_FIELD_CLASSES}>
        <MoneyInput
          id="expense-amount"
          name="amount"
          label={`Amount (${currency})`}
          currency={currency}
          type="text"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={amount}
          onChange={(event) => changeAmount(event.target.value)}
          placeholder="0.00"
          error={errors.amount}
        />
      </div>

      <TextInput
        id="expense-description"
        name="description"
        label="Description"
        type="text"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Dinner"
        error={errors.description}
      />

      <div className="flex flex-col gap-2">
        <span className="flex flex-wrap items-baseline justify-between gap-2">
          <label className={FIELD_LABEL_CLASSES} htmlFor="expense-date">
            Date
          </label>
          {/* Beside the picker, so a person reads what the field means without decoding it. It
              renders only once the client knows what today is, which is also why it cannot
              disagree with the hydrated render. */}
          {dateLabel === null ? null : (
            <span className="text-secondary text-ink-muted">{dateLabel}</span>
          )}
        </span>
        <input
          id="expense-date"
          name="date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          aria-invalid={errors.date !== undefined}
          aria-describedby={errors.date ? 'expense-date-error' : undefined}
          className={FIELD_CLASSES}
        />
        <FieldError id="expense-date-error" message={errors.date} />
      </div>

      <div className="flex flex-col gap-2">
        <label className={FIELD_LABEL_CLASSES} htmlFor="expense-category">
          Category
        </label>
        <select
          id="expense-category"
          name="category"
          value={category}
          onChange={(event) => setCategory(event.target.value as typeof category)}
          aria-invalid={errors.category !== undefined}
          aria-describedby={errors.category ? 'expense-category-error' : undefined}
          className={FIELD_CLASSES}
        >
          {EXPENSE_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {EXPENSE_CATEGORY_LABELS[value]}
            </option>
          ))}
        </select>
        <FieldError id="expense-category-error" message={errors.category} />
      </div>

      <div className="flex flex-col gap-2">
        <label className={FIELD_LABEL_CLASSES} htmlFor="expense-note">
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
          className={FIELD_CLASSES}
        />
        <FieldError id="expense-note-error" message={errors.note} />
      </div>

      <section
        className="flex flex-col gap-3 rounded-token border border-border bg-surface p-4"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setBlurred((current) => ({ ...current, payers: true }));
          }
        }}
      >
        <h2 className="text-section font-semibold text-ink">Who paid</h2>

        {severalPayers ? (
          <>
            <p className="text-secondary text-ink-muted">
              Add everybody who put money in. The parts must add up to the amount.
            </p>

            <ul className="flex flex-col gap-2">
              {payers.map((payer, index) => (
                <li key={payer.membershipId} className="flex flex-wrap items-center gap-2">
                  <Avatar name={payer.displayName} memberId={payer.membershipId} />

                  <div className="min-w-0 flex-1">
                    <label className="sr-only" htmlFor={`payer-${index}-member`}>
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
                      className={FIELD_CLASSES}
                    >
                      {participants.map((participant) => (
                        <option key={participant.membershipId} value={participant.membershipId}>
                          {participant.displayName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="w-28">
                    <label className="sr-only" htmlFor={`payer-${index}-amount`}>
                      {`Amount ${payer.displayName} paid`}
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
                      className={`${FIELD_CLASSES} text-right tabular-nums`}
                    />
                  </div>

                  {payers.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => changePayers(payers.filter((_, position) => position !== index))}
                    >
                      {`Remove ${payer.displayName}`}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap gap-2">
              {payers.length < participants.length ? (
                <Button type="button" variant="secondary" size="sm" onClick={addPayer}>
                  Add another payer
                </Button>
              ) : null}
              {payers.length > 1 ? (
                <Button type="button" variant="ghost" size="sm" onClick={collapsePayers}>
                  Paid by one person
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <>
            {/* The ordinary case, submitted exactly as the row above would submit it: same names,
                same values, no field asking for the number twice. */}
            <input type="hidden" name="payer.0.membershipId" value={firstPayer?.membershipId ?? ''} />
            <input type="hidden" name="payer.0.amount" value={firstPayer?.amount ?? ''} />
            <p className="flex items-center gap-2 text-body text-ink">
              <Avatar name={firstPayer?.displayName ?? ''} memberId={firstPayer?.membershipId} />
              <span className="truncate">{`${firstPayer?.displayName ?? ''} paid the whole amount.`}</span>
            </p>
            <div>
              <Button type="button" variant="secondary" size="sm" onClick={() => setSeveralPayers(true)}>
                Paid by several people
              </Button>
            </div>
          </>
        )}

        <FieldError id="expense-payers-error" message={errors.payers} />
        {showPaidNote && paidNote ? <LiveNote tone={paidNote.tone} text={paidNote.text} /> : null}
      </section>

      <section
        className="flex flex-col gap-3 rounded-token border border-border bg-surface p-4"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setBlurred((current) => ({ ...current, splits: true }));
          }
        }}
      >
        <div className="flex flex-col gap-2">
          <span className={FIELD_LABEL_CLASSES} id="expense-split-type-label">
            How is it split?
          </span>
          <SegmentedControl
            label="How is it split?"
            options={SPLIT_TYPES.map((value) => ({ value, label: SPLIT_TYPE_LABELS[value] }))}
            value={splitType}
            onChange={setSplitType}
            className="flex-wrap"
          />
          {/* The value the boundary reads, unchanged from when this was four radios. */}
          <input type="hidden" name="splitType" value={splitType} />
        </div>
        <FieldError id="expense-split-type-error" message={errors.splitType} />

        <ul className="flex flex-col gap-2">
          {participants.map((participant, index) => {
            const shareMinor = shares?.get(participant.membershipId);
            const valueId = `split-${index}-value`;

            return (
              <li
                key={participant.membershipId}
                className="flex flex-wrap items-center gap-3 rounded-token border border-border p-2"
              >
                <input
                  type="hidden"
                  name={`split.${index}.membershipId`}
                  value={participant.membershipId}
                />
                <Avatar name={participant.displayName} memberId={participant.membershipId} />

                <span
                  className={`min-w-0 flex-1 truncate font-medium ${participant.included ? 'text-ink' : 'text-ink-muted line-through'}`}
                  title={participant.displayName}
                >
                  {participant.displayName}
                </span>

                {participant.included && shareMinor !== undefined ? (
                  <span data-amount className="text-secondary tabular-nums text-ink-muted">
                    {formatMinorUnits(shareMinor, currency)}
                  </span>
                ) : null}

                {splitType === 'equal' ? null : (
                  <span className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={valueId}>
                      {valueLabel(splitType, participant.displayName)}
                    </label>
                    <input
                      id={valueId}
                      name={`split.${index}.value`}
                      type="text"
                      inputMode="decimal"
                      value={participant.value}
                      // A member taken out of the split keeps the number typed beside them: the
                      // field goes readOnly rather than disabled, because a disabled control
                      // contributes nothing to the submission and the 40 this person typed would
                      // arrive as a missing field — stored as null and reopened blank (AC-9).
                      // It stays focusable and readable, which is the honest cost of a row whose
                      // value still has to be sent.
                      readOnly={!participant.included}
                      aria-disabled={!participant.included}
                      onChange={(event) =>
                        changeParticipant(participant.membershipId, { value: event.target.value })
                      }
                      placeholder={splitType === 'shares' ? '1' : '0.00'}
                      className={`${FIELD_CLASSES} w-24 text-right tabular-nums ${participant.included ? '' : 'opacity-50'}`}
                    />
                    <span className="text-secondary text-ink-muted">{unitHint(splitType)}</span>
                  </span>
                )}

                <IncludeSwitch
                  id={`split-${index}-included`}
                  name={`split.${index}.included`}
                  checked={participant.included}
                  label={`Include ${participant.displayName} in the split`}
                  onChange={(checked) =>
                    changeParticipant(participant.membershipId, { included: checked })
                  }
                />
              </li>
            );
          })}
        </ul>

        <FieldError id="expense-splits-error" message={errors.splits} />
        {showSplitNote && splitNoteText ? (
          <LiveNote tone={splitNoteText.tone} text={splitNoteText.text} />
        ) : null}
      </section>

      {/* The way through and the way out, together and reachable by a thumb: a long form on a
          phone must not hide its own Save at the bottom of the scroll. */}
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-token border border-border bg-surface p-3 shadow-sm">
        <Button type="submit" pending={isPending} pendingLabel="Saving…">
          {expenseId === null ? 'Add expense' : 'Save expense'}
        </Button>
        <Link className="text-body font-medium text-accent underline-offset-4 hover:underline" href={`/groups/${groupId}`}>
          Cancel
        </Link>
        {/* A refusal is already on screen by the time this row renders — beside the field it is
            about, or in the summary above when it is about the form as a whole — so the submit row
            never repeats it. The only message left for it is a success one, and a success leaves
            this page entirely (AC-9). */}
        {state.status === 'error' ? null : <StateMessage state={state} />}
      </div>
    </form>
  );
}

/**
 * Deleting, on the expense's own page: a server-rendered form behind a client-side confirm inside
 * the shared dialog, because the alternative — a native `confirm()` — is the one control a
 * keyboard user loses and a browser agent cannot drive.
 *
 * The dialog opens **on** the confirm step. There is no Delete button inside it: the button that
 * opens it is the decision to start, and the question inside names the object, so a press is
 * caught by reading rather than by remembering which button was which (AC-7).
 *
 * The question names the expense and the consequence, and the refusal renders inside the confirm
 * box, where this form is still on screen to show it. Success redirects to the group with the
 * note.
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

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
          Delete expense
        </Button>
      </div>
      <Dialog open={confirming} title="Delete expense" onClose={() => setConfirming(false)}>
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="expenseId" value={expenseId} />
          <ConfirmStep
            question={`Delete “${description}”? It leaves the group and stops counting towards every balance.`}
            confirmLabel="Delete expense"
            pendingLabel="Deleting…"
            isPending={isPending}
            onCancel={() => setConfirming(false)}
          >
            <StateMessage state={state} />
          </ConfirmStep>
        </form>
      </Dialog>
    </div>
  );
}
