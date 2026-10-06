'use client';

import { useActionState, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { EllipsisVertical, Settings } from 'lucide-react';
import { deleteExpense } from '../lib/expenses/actions';
import { IDLE_EXPENSE_STATE } from '../lib/expenses/validation';
import { ArchiveGroupForm, RenameGroupForm } from './groups-panels';
import { Button, ConfirmStep, StateMessage } from './ui';
import { Dialog } from './ui-interactive';

/**
 * The two pieces of the group page that need a browser (IAC-2, IAC-4).
 *
 * Both exist for the same reason: ui.md moves things that used to sit on the main scroll — row
 * actions and the owner's group settings — behind an entry that opens them, and an entry that
 * opens is state. Everything else on that screen is server-rendered markup, which is why there
 * are only two exports here.
 *
 * Timestamps are deliberately not here. They need a clock, not interaction, and they are shared
 * with the activity feed and `/activity`; a component that three screens render lives in its own
 * neutral module (`components/timestamp.tsx`) rather than in this one, which belongs to one page.
 */

/**
 * A row's own actions, behind an overflow menu (IAC-4).
 *
 * ui.md is explicit that row-level delete lives in an overflow menu rather than as a red button
 * on every row, and the pre-redesign screen had two controls on each row competing with the one
 * thing the row is for. The menu keeps the destination at the end of the row and puts the
 * destructive one two deliberate steps away.
 *
 * Four behaviours make it usable without a mouse, and they are the whole reason this is an
 * island rather than a `<details>`: focus moves into the menu when it opens, Escape closes it and
 * puts focus back on the button that opened it, a click outside closes it, and Tab out of it
 * closes it too. That last one is not cosmetic — the menu is absolutely positioned over the rows
 * below, so one left open by a reader who tabbed on hovers over the ledger until they happen to
 * press Escape. `aria-expanded` and `aria-haspopup` say what the button does before it is pressed.
 *
 * The confirm is the shared `Dialog` and the shared `ConfirmStep`, so the question a person is
 * asked here is the same question the edit page asks — naming the expense, not "this item". The
 * sentence is written twice, once here and once in `DeleteExpenseForm`, because the edit page's
 * copy is that file's to own; a change to one has to change the other, which is the price of not
 * refactoring a caller this ticket does not own.
 */
export function ExpenseRowMenu({
  groupId,
  expenseId,
  description,
}: {
  groupId: string;
  expenseId: string;
  description: string;
}) {
  const [state, formAction, isPending] = useActionState(deleteExpense, IDLE_EXPENSE_STATE);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const firstItem = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (open) firstItem.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      // A press on the button itself is the button's own toggle to close, not an outside click:
      // closing here and letting the click reopen would leave the menu stuck open.
      if (menu.current?.contains(target) || trigger.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function closeAndReturnFocus() {
    setOpen(false);
    trigger.current?.focus();
  }

  function handleFocusLeave(event: FocusEvent<HTMLDivElement>) {
    // React's `onBlur` is `focusout`, so this also fires while focus moves between the two items:
    // only a departure from the whole widget closes the menu.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setOpen(false);
  }

  function handleMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return;
    // The menu is about to unmount with the focus inside it, so focus goes back to the button
    // that opened it before it does — otherwise it falls to the body and the next Tab starts
    // from the top of the page.
    event.stopPropagation();
    closeAndReturnFocus();
  }

  return (
    <div className="relative" onBlur={handleFocusLeave}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${description}`}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="inline-flex size-11 items-center justify-center rounded-token text-ink-muted hover:bg-surface-sunken hover:text-ink"
      >
        <EllipsisVertical aria-hidden="true" className="size-5" />
      </button>

      {open ? (
        <div
          ref={menu}
          role="menu"
          aria-label={`Actions for ${description}`}
          onKeyDown={handleMenuKey}
          // The popup tier, like the account menu: above the sticky header (z-30) and above the
          // phone's fixed Add-expense bar (z-20) — the last row's menu opens down into that bar,
          // and at the bottom of the page there is nothing left to scroll it clear of. Below
          // dialogs and toasts (z-50), which the menu must never cover.
          className="absolute right-0 z-40 mt-1 flex w-44 flex-col rounded-token border border-border bg-surface p-1 shadow-md"
        >
          <Link
            ref={firstItem}
            role="menuitem"
            href={`/groups/${groupId}/expenses/${expenseId}/edit`}
            className="flex min-h-11 items-center rounded-token px-3 text-body text-ink hover:bg-surface-sunken"
          >
            Edit expense
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              // Focus goes back to the trigger before this item unmounts with the menu; the
              // dialog then records the trigger as what had focus when it opened, and returns
              // the reader there when it closes.
              closeAndReturnFocus();
              setConfirming(true);
            }}
            className="flex min-h-11 items-center rounded-token px-3 text-left text-body text-danger hover:bg-surface-sunken"
          >
            Delete expense
          </button>
        </div>
      ) : null}

      <Dialog
        open={confirming}
        title="Delete expense"
        variant="sheet"
        onClose={() => setConfirming(false)}
      >
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="expenseId" value={expenseId} />
          <ConfirmStep
            question={`Delete “${description}”? It leaves the group and stops counting towards every balance.`}
            confirmLabel="Delete expense"
            pendingLabel="Deleting…"
            isPending={isPending}
            onCancel={() => setConfirming(false)}
          >
            {/* A refusal is the only thing this form is still here to say: a success redirects to
                the group with the row gone and the note in its place. */}
            <StateMessage state={state} />
          </ConfirmStep>
        </form>
      </Dialog>
    </div>
  );
}

/**
 * Group settings, behind one entry in the header (IAC-2).
 *
 * Rename and archive used to be a section at the bottom of the main scroll, which made the two
 * rarest actions on the screen the last thing on it and put a destructive one under a thumb
 * travelling past it. They are unchanged inside the dialog — `RenameGroupForm` and
 * `ArchiveGroupForm` are the same components the members page and this page already used — and
 * the members link comes along because "who is in this group" is the question somebody opening
 * settings usually has next.
 *
 * Owner-only and never rendered for an archived group: an archived group cannot be renamed or
 * archived again, and the page does not render this at all in that case. A button whose only
 * outcome is a refusal is not a courtesy.
 */
export function GroupSettingsEntry({
  groupId,
  groupName,
}: {
  groupId: string;
  groupName: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Settings aria-hidden="true" className="size-4" />
        Settings
      </Button>

      <Dialog open={open} title="Group settings" variant="sheet" onClose={() => setOpen(false)}>
        <RenameGroupForm groupId={groupId} name={groupName} />
        <ArchiveGroupForm groupId={groupId} groupName={groupName} />
        <Link
          className="text-secondary font-medium text-accent underline-offset-4 hover:underline"
          href={`/groups/${groupId}/members`}
        >
          Members and invite link
        </Link>
      </Dialog>
    </>
  );
}
