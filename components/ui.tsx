/**
 * The pieces every form on the app shares: the class strings that make a control look like a
 * control, and the three small components that render the same markup in four screens.
 *
 * They live in one module because a class string copied into four files is four chances for one
 * screen to restyle itself silently, and the copies are byte-identical today — this is what keeps
 * them that way. Nothing here decides anything: no state, no action, no data.
 *
 * No `'use client'`. The constants are strings and the components hold no state, so the same
 * module serves a client island (the expense editor, the group panels, the auth form) and a
 * server page (the group detail screen) — which is also why it may reach for nothing that either
 * environment owns: no hooks, no `window`, no server-only module.
 *
 * The lower half of the file is the redesigned presentational set from docs/ui.md — Button,
 * TextInput/MoneyInput, Card, Avatar, Badge, Skeleton, EmptyState, ListRow, Spinner. It sits
 * *beside* the constants above rather than replacing them on purpose: INPUT_CLASSES and the
 * three button strings are read by six screens whose own redesign belongs to a later slice, and
 * changing them here would restyle the expense editor, the group panels and the settle-up
 * panels in a commit about the landing page. The new screens build on the new set; the old
 * names stay untouched until the slice that owns those screens migrates them.
 */

import Link from 'next/link';
import { UserRound } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export const INPUT_CLASSES =
  'min-h-11 w-full rounded-token border border-muted/40 bg-surface px-3 text-ink placeholder:text-muted';
export const LABEL_CLASSES = 'text-sm font-medium';
export const PRIMARY_BUTTON =
  'min-h-11 rounded-token bg-accent px-4 font-medium text-surface disabled:opacity-60';
export const QUIET_BUTTON = 'min-h-11 rounded-token border border-muted/40 px-4 font-medium';
export const DANGER_BUTTON =
  'min-h-11 rounded-token border border-danger/50 px-4 font-medium text-danger';

/** The part of an action state a message needs; every island's own state satisfies it. */
interface MessageState {
  status: 'idle' | 'error' | 'success';
  message: string;
}

/**
 * What an action came back with, in the sentence it came back with — and nothing at all while
 * there is nothing to say, which is not the same as rendering nothing.
 *
 * The region is mounted from the first paint whether or not it has a message, because a live
 * region inserted into the document together with the text it carries is announced unreliably:
 * assistive technology has to be watching the node before the text arrives, and one that appears
 * already filled is a node it was never watching. So idle renders the empty `<p role="status">`
 * and a result fills that same node (AC-9, TR-9). The price is an empty paragraph wherever the
 * message slot sits, deliberately paid once here rather than by every caller keeping its own
 * always-on region in step with this one.
 */
export function StateMessage({ state }: { state: MessageState }) {
  return (
    // `min-w-0 break-words`: these sentences interpolate group, member and expense names at up to
    // their 80/200-character maxima, and an unbroken one is a single line that sets the document
    // width on a 375px phone. `min-w-0` is load-bearing where the message renders as an item of a
    // flex-wrap row rather than as a block; `overflow-wrap` is a no-op on ordinary text, so short
    // messages are unchanged (AC-2, AC-4).
    <p
      role={state.status === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      className={
        state.status === 'error'
          ? 'min-w-0 text-sm text-danger break-words'
          : 'min-w-0 text-sm text-lent break-words'
      }
    >
      {state.message}
    </p>
  );
}

/** A refusal beside the field it is about, wired to it by `id` and the field's `aria-describedby`. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-danger">
      {message}
    </p>
  );
}

/** The confirm step every destructive action shares: a question naming the object, then a pair.
 *
 * `children` is where a form that can be refused puts its own message, so the box stays the one
 * shape whether or not there is something to say; the group panels pass nothing. */
export function ConfirmStep({
  question,
  confirmLabel,
  pendingLabel,
  isPending,
  onCancel,
  children,
}: {
  question: string;
  confirmLabel: string;
  pendingLabel: string;
  isPending: boolean;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-token border border-danger/40 p-3">
      {/* The question names the object it acts on — a group, a member, a payment — so it is
          rendered whole and wraps rather than being clipped or elided; an 80-character unbroken
          name here would otherwise widen the page past a 375px viewport. `break-words` alone is
          enough: the question is always the only child of this flex-col box, so it stretches to
          the column's width and `min-w-0` would be inert (AC-2). */}
      <p role="alert" className="text-sm break-words">
        {question}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={isPending} aria-busy={isPending} className={DANGER_BUTTON}>
          {isPending ? pendingLabel : confirmLabel}
        </button>
        <button type="button" onClick={onCancel} className={QUIET_BUTTON}>
          Cancel
        </button>
      </div>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * The redesigned presentational set (ui.md). Everything below reads the ui.md token names only:
 * no screen may invent its own spacing, type size or colour, so a control that needs one gets it
 * from here rather than from a class string written inline at the call site.
 * ------------------------------------------------------------------------------------------- */

/** Visible label above a control, per ui.md's inputs pattern. */
export const FIELD_LABEL_CLASSES = 'text-secondary font-medium text-ink';
/** The redesigned input fill: white with a hairline border, sunken fill on focus-visible. */
export const FIELD_CLASSES =
  'min-h-11 w-full rounded-token border border-border bg-surface px-3 text-body text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none';

export function Spinner({ className }: { className?: string }) {
  // Decorative: the pending state is carried by the text beside it, so that a viewer who asked
  // for less motion (globals.css stops every animation) still reads what is happening. Never
  // the only signal — the label is what AC-6 asks to survive a reduced-motion render.
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className ?? ''}`}
    />
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md';

/** ui.md: two heights, 36px for a dense toolbar and 44px for anything a thumb reaches. */
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-secondary',
  md: 'min-h-11 px-4 text-body',
};

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-contrast hover:bg-accent-hover active:bg-accent-hover',
  secondary: 'border border-border bg-surface text-ink hover:bg-surface-sunken',
  ghost: 'text-ink hover:bg-surface-sunken',
  destructive: 'border border-danger/50 bg-surface text-danger hover:bg-danger-tint',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** While true the button is disabled and renders the spinner plus `pendingLabel` beside it. */
  pending?: boolean;
  pendingLabel?: string;
}

/**
 * The button's class string, exported separately because a link that navigates somewhere is a
 * primary action too — the landing page's "Create account" is an anchor, not a submit — and a
 * second copy of these classes is exactly the drift this module exists to prevent.
 */
export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className = '',
): string {
  return `inline-flex items-center justify-center gap-2 rounded-token font-medium transition-colors hover:cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${BUTTON_SIZES[size]} ${BUTTON_VARIANTS[variant]} ${className}`;
}

/**
 * The one button. Every variant carries hover, focus-visible (from globals.css), active and
 * disabled states, and the pending treatment is structural rather than optional: `pending`
 * disables the button and puts the spinner next to text, so a double submit is not possible and
 * the state is legible without animation.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  pending = false,
  pendingLabel = 'Saving…',
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={buttonClasses(variant, size, className ?? '')}
    >
      {pending ? <Spinner /> : null}
      {pending ? pendingLabel : children}
    </button>
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  /** One line under the field explaining a rule before it is broken. */
  hint?: string;
  /** The refusal for this field; rendered below it and wired in by `aria-describedby`. */
  error?: string;
  /** An id for the error node, when a caller already publishes one under a known name. */
  errorId?: string;
  /** A control that belongs to the field, such as the password show/hide toggle. */
  trailing?: ReactNode;
}

/**
 * A labelled text field: the label above, an optional hint below, and the refusal below that in
 * the danger colour — which is ui.md's inputs pattern and the reason this is a component rather
 * than a class string a caller reassembles. Nothing here holds state, so it renders from a server
 * page and from a client island alike.
 */
export function TextInput({
  id,
  label,
  hint,
  error,
  errorId,
  trailing,
  className,
  ...rest
}: TextInputProps) {
  const errorNodeId = errorId ?? `${id}-error`;
  const describedBy =
    [hint ? `${id}-hint` : null, error ? errorNodeId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-2">
      <label className={FIELD_LABEL_CLASSES} htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          {...rest}
          id={id}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy}
          className={`${FIELD_CLASSES} ${className ?? ''}`}
        />
        {trailing}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-secondary text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={errorNodeId} message={error} /> : null}
    </div>
  );
}

export interface MoneyInputProps extends Omit<TextInputProps, 'inputMode'> {
  /** The group's currency, shown as the prefix inside the field, never as a label. */
  currency: string;
}

/**
 * The money field: right-aligned tabular figures with the currency sitting inside the border, so
 * the number and its unit read as one value. `inputmode="decimal"` is what raises a decimal pad
 * on a phone; the value itself stays a plain text field and is parsed by lib/money at submit.
 */
export function MoneyInput({
  id,
  label,
  currency,
  hint,
  error,
  errorId,
  className,
  ...rest
}: MoneyInputProps) {
  const errorNodeId = errorId ?? `${id}-error`;
  const describedBy =
    [hint ? `${id}-hint` : null, error ? errorNodeId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-2">
      <label className={FIELD_LABEL_CLASSES} htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center gap-2 rounded-token border border-border bg-surface px-3 focus-within:border-accent">
        <span aria-hidden="true" className="text-body font-medium text-ink-muted">
          {currency}
        </span>
        <input
          {...rest}
          id={id}
          inputMode="decimal"
          aria-invalid={error !== undefined}
          aria-describedby={describedBy}
          className={`tabular-nums min-h-11 w-full bg-transparent text-right text-body text-ink placeholder:text-ink-subtle focus:outline-none ${className ?? ''}`}
        />
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-secondary text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={errorNodeId} message={error} /> : null}
    </div>
  );
}

/** A surface, a hairline border and shadow-sm — the one container ui.md lets anything sit on. */
export function Card({
  title,
  action,
  className,
  children,
}: {
  title?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`flex flex-col gap-4 rounded-token border border-border bg-surface p-4 shadow-sm ${className ?? ''}`}
    >
      {title === undefined ? null : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-section font-semibold text-ink">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const AVATAR_TINTS = [
  'bg-accent-tint text-accent',
  'bg-owed-tint text-owed',
  'bg-lent-tint text-lent',
  'bg-surface-sunken text-ink-muted',
] as const;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The first user-perceived character of a word — one grapheme, never half a surrogate pair. */
function firstGrapheme(word: string): string {
  const [first] = GRAPHEMES.segment(word);
  return first?.segment ?? '';
}

/**
 * A display name's initials: the first letter of the first word, plus the first letter of the
 * second when there is one. Segmentation is by grapheme cluster rather than by code unit, so a
 * Devanagari syllable stays whole and an emoji is never sliced into a lone surrogate.
 */
export function avatarInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0] === undefined ? '' : firstGrapheme(words[0]);
  const second = words.length > 1 && words[1] !== undefined ? firstGrapheme(words[1]) : '';
  return (first + second).toUpperCase();
}

/**
 * The tint an avatar wears, derived from the member id rather than chosen — the same member is
 * the same colour on every screen and in every render, which is what makes an avatar a way to
 * recognise somebody rather than decoration. Falls back to the name, then to the neutral tint,
 * for a seat that has no id yet.
 */
export function avatarTint(key: string): string {
  let hash = 0;
  for (const character of key) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return AVATAR_TINTS[hash % AVATAR_TINTS.length] ?? AVATAR_TINTS[0];
}

/**
 * Initials on a stable colour, 32px in a row and 40px in a header (ui.md). Always decorative:
 * `aria-hidden`, with the name rendered as text beside it, because the initials are a memory aid
 * and not the name.
 */
export function Avatar({
  name,
  memberId,
  size = 32,
}: {
  name: string;
  memberId?: string;
  size?: 32 | 40;
}) {
  const initials = avatarInitials(name);
  const box = size === 40 ? 'size-10 text-secondary' : 'size-8 text-caption';
  const tint = initials === '' ? 'bg-surface-sunken text-ink-subtle' : avatarTint(memberId ?? name);

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-medium ${box} ${tint}`}
    >
      {initials === '' ? <UserRound className="size-4" /> : initials}
    </span>
  );
}

type BadgeTone = 'neutral' | 'accent' | 'owed' | 'lent';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'border border-border bg-surface-sunken text-ink-muted',
  accent: 'bg-accent-tint text-accent',
  owed: 'bg-owed-tint text-owed',
  lent: 'bg-lent-tint text-lent',
};

/** A small state pill — Settled, Placeholder, Archived, You. Never the only carrier of it. */
export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-caption font-medium ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * A grey block shaped like the content it stands in for. `bg-muted/20` rather than a new token
 * because the two loading boundaries already pin that class and their own test asserts every
 * block carrying it also carries `motion-safe:animate-pulse`.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-token bg-muted/20 motion-safe:animate-pulse ${className ?? ''}`}
    />
  );
}

/** What a place shows when there is nothing in it yet: why it is empty and what starts it. */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-token border border-border bg-surface p-4">
      {icon === undefined ? null : (
        <span aria-hidden="true" className="text-ink-subtle">
          {icon}
        </span>
      )}
      <p className="font-medium text-ink">{title}</p>
      <p className="text-secondary text-ink-muted">{body}</p>
      {action}
    </div>
  );
}

/**
 * A row of a list: avatar or icon at the left, title and metadata stacked in the middle, an
 * amount at the right. The whole row is the hit target when it links somewhere, which is what
 * ui.md means by "never an inline Edit button" — the destination lives at the end of the row.
 *
 * A string title is truncated with an ellipsis and carries its full value in `title`, so a long
 * group name shortens instead of wrapping the row into three lines.
 */
export function ListRow({
  leading,
  title,
  meta,
  trailing,
  href,
}: {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  href?: string;
}) {
  const className = `flex items-center gap-3 rounded-token border border-border bg-surface p-3 ${
    href === undefined ? '' : 'hover:bg-surface-sunken'
  }`;
  const content = (
    <>
      {leading === undefined ? null : <span className="shrink-0">{leading}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className="truncate font-medium text-ink"
          title={typeof title === 'string' ? title : undefined}
        >
          {title}
        </span>
        {meta === undefined ? null : (
          <span className="truncate text-secondary text-ink-muted">{meta}</span>
        )}
      </span>
      {trailing === undefined ? null : (
        <span className="shrink-0 text-right">{trailing}</span>
      )}
    </>
  );

  if (href === undefined) return <div className={className}>{content}</div>;
  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}
