'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * The stateful half of the shared component set.
 *
 * `components/ui.tsx` holds the presentational pieces and may not carry `'use client'`, because
 * its class strings are read by a server page (the group detail screen) as well as by client
 * islands; a directive there would drag that page onto the client with it. Anything that needs a
 * hook therefore lives here instead, and reaches back into ui.tsx only for class strings — so a
 * segmented control and a server-rendered row can still be restyled in one place.
 *
 * Nothing here fetches or decides anything. It is markup plus the keystroke and focus behaviour
 * ui.md requires of it.
 */

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Where an arrow key moves a segmented control, as arithmetic rather than as DOM work, so the
 * movement rule can be asserted without a browser. Returns the next index, or null for a key
 * that is not the control's business — which is what lets the component leave every other key
 * to the browser instead of swallowing it.
 *
 * Movement wraps at both ends, which is the convention for a radio group: pressing Right on the
 * last option returns to the first rather than dead-ending on a control that looks navigable.
 */
export function stepSegment(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * The segmented control ui.md uses for split type and feed filters: one option marked selected
 * by `aria-checked` (never by colour alone), arrow keys moving between the options, and a single
 * tab stop on the selected one so the control is one stop in the page's tab order rather than
 * five.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  function handleKey(event: KeyboardEvent<HTMLButtonElement>): void {
    const next = stepSegment(selected, event.key, options.length);
    if (next === null) return;
    event.preventDefault();
    const option = options[next];
    if (option === undefined) return;
    buttons.current[next]?.focus();
    onChange(option.value);
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`inline-flex rounded-token border border-border bg-surface-sunken p-1 ${className ?? ''}`}
    >
      {options.map((option, index) => {
        const isSelected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={handleKey}
            className={`min-h-9 rounded-token px-3 text-secondary font-medium transition-colors ${
              isSelected ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Time, in the viewer's zone (TR-11, AC-3).
 *
 * The invariant is that an instant is stored in UTC and read in the viewer's zone — but a server
 * component cannot know the viewer's zone, because it renders wherever the app runs. So the
 * label is split in two: the server (and the client's first render) emit the same UTC-labelled
 * instant, and an effect replaces it with the relative-then-human reading once the browser can
 * say what its zone is. Rendering the human form on the first client pass would be a hydration
 * mismatch; rendering it only in an effect is what keeps one element's text correct on both
 * sides of the boundary.
 * ------------------------------------------------------------------------------------------- */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const RELATIVE_LIMIT_MS = 7 * DAY_MS;

const UTC_LABEL = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/** The instant in UTC, labelled as such — the fallback both renders agree on. */
export function utcTimestampText(value: Date): string {
  return `${UTC_LABEL.format(value)} UTC`;
}

/**
 * How long ago it was, or `''` once a count of days stops helping.
 *
 * A future value clamps to "just now" rather than printing a negative age: a clock a few
 * seconds ahead of the server is not a thing to tell somebody about, and "in 3 hours" on an
 * event that has already happened reads as a bug.
 */
export function relativeTimestamp(value: Date, now: Date): string {
  const elapsed = now.getTime() - value.getTime();
  if (elapsed < MINUTE_MS) return 'just now';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  if (elapsed < RELATIVE_LIMIT_MS) return `${Math.floor(elapsed / DAY_MS)}d ago`;
  return '';
}

/** The calendar day an instant falls on, in a zone — `en-CA` prints it as `yyyy-mm-dd`. */
function dayKeyIn(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

/**
 * The half a person actually reads: the time alone today, "Yesterday" and a weekday soon after,
 * and a dated form once the week is out — the way somebody says it, per ui.md's money/date rule.
 *
 * `timeZone` comes from the viewer; when it is missing the caller falls back to the UTC label
 * rather than guessing, so an environment that cannot name its zone is honest about it instead
 * of printing the server's clock as if it were the reader's.
 */
export function humanTimestamp(value: Date, now: Date, timeZone: string): string {
  const time = new Intl.DateTimeFormat(undefined, { timeStyle: 'short', timeZone }).format(value);
  const day = dayKeyIn(value, timeZone);

  if (day === dayKeyIn(now, timeZone)) return time;

  const yesterday = new Date(now.getTime() - DAY_MS);
  if (day === dayKeyIn(yesterday, timeZone)) return `Yesterday ${time}`;

  if (Math.abs(now.getTime() - value.getTime()) < RELATIVE_LIMIT_MS) {
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone }).format(value);
    return `${weekday} ${time}`;
  }

  const date = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(value);
  return `${date} ${time}`;
}

/**
 * The whole label: relative, then human, joined by the same middot the feed uses — so a row
 * reads "2h ago · 14:30" and a row from last month reads just its date.
 */
export function timestampLabel(value: Date, now: Date, timeZone: string): string {
  const relative = relativeTimestamp(value, now);
  const human = humanTimestamp(value, now, timeZone);
  return relative === '' ? human : `${relative} · ${human}`;
}

/** The viewer's zone, or undefined when the runtime cannot name one it can also format in. */
function viewerTimeZone(): string | undefined {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (typeof zone !== 'string' || zone === '') return undefined;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

/**
 * One instant, rendered for the person looking at it.
 *
 * The first paint is the UTC label — byte-identical to what the server sent — and the effect
 * swaps in the relative-then-human reading in the viewer's zone. An environment that cannot
 * name a zone keeps the UTC label, which is the honest answer rather than the server's clock
 * wearing the viewer's name.
 */
export function Timestamp({ value }: { value: Date }) {
  const iso = value.toISOString();
  const [label, setLabel] = useState(() => utcTimestampText(value));

  useEffect(() => {
    const zone = viewerTimeZone();
    if (zone === undefined) return;
    setLabel(timestampLabel(new Date(iso), new Date(), zone));
  }, [iso]);

  return <time dateTime={iso}>{label}</time>;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The dialog ui.md asks for where a destructive action or the settle-up flow needs one: a centred
 * dialog on desktop and a bottom sheet on phones, one shape with the position changed.
 *
 * It traps focus while it is open and returns it to whatever had focus when it opened, which is
 * the half of ui.md's "focus trapped and returned" that a plain overlay does not give you. Escape
 * closes it. It renders in place rather than through a portal so that it is a component a server
 * render can also produce — the panel is `fixed`, so where it sits in the tree does not decide
 * where it lands on screen.
 */
export function Dialog({
  open,
  title,
  onClose,
  variant = 'dialog',
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  variant?: 'dialog' | 'sheet';
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    return () => opener.current?.focus();
  }, [open]);

  function handleKey(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusable === undefined || focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    // Wrap at both ends rather than letting Tab escape to the page behind the overlay.
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;

  const position =
    variant === 'sheet'
      ? 'items-end sm:items-center'
      : 'items-center';

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-ink/40 p-0 sm:p-4 ${position}`}
      onKeyDown={handleKey}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`flex w-full max-w-[420px] flex-col gap-4 rounded-token border border-border bg-surface p-5 shadow-md ${
          variant === 'sheet' ? 'rounded-b-none sm:rounded-token' : ''
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-section font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-token text-ink-muted hover:bg-surface-sunken hover:text-ink"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * A confirmation that leaves on its own: bottom-centre on phones, bottom-right on desktop, one
 * polite live region, `duration` milliseconds on screen. An empty message renders nothing at all,
 * so a caller can keep one mounted and clear it rather than toggling the component in and out.
 */
export function Toast({
  message,
  tone = 'success',
  duration = 3000,
  onDismiss,
}: {
  message: string;
  tone?: 'success' | 'error';
  duration?: number;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (message === '') return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [message, duration, onDismiss]);

  if (message === '') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-token border bg-surface px-4 py-3 text-secondary shadow-md sm:left-auto sm:right-4 sm:translate-x-0 ${
        tone === 'error' ? 'border-danger/40 text-danger' : 'border-border text-ink'
      }`}
    >
      {message}
    </div>
  );
}
