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
 */

import type { ReactNode } from 'react';

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
    <p
      role={state.status === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      className={state.status === 'error' ? 'text-sm text-danger' : 'text-sm text-lent'}
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
      <p role="alert" className="text-sm">
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
