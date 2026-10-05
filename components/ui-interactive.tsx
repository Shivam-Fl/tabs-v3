'use client';

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
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
