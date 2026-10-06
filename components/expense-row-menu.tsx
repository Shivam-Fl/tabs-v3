'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { MoreHorizontal } from 'lucide-react';
import { deleteExpense } from '../lib/expenses/actions';
import { IDLE_EXPENSE_STATE } from '../lib/expenses/validation';
import { ConfirmStep, StateMessage } from './ui';
import { Dialog, MENU_ITEM_CLASSES, Menu, MenuPanel } from './ui-interactive';

/**
 * An expense row's overflow menu — Edit and Delete, behind one control.
 *
 * ui.md and the ux skill both put a row's destructive action behind an overflow rather than on the
 * row: a list of expenses must not read as a list of red buttons, and a delete sitting a thumb's
 * width from an edit link is a delete somebody presses by accident. The shell's account menu
 * already needed this control, so it lives in `ui-interactive.tsx` and this file says only what
 * these two items *are*.
 *
 * Delete opens the dialog **directly on the confirm step**. There is no Delete inside the dialog:
 * the menu item is the decision to start, and the question inside names the expense and the
 * consequence, so the second press is the one that means it (AC-7).
 *
 * The menu closes by refocusing its trigger before the dialog opens — `onClose` runs first, in the
 * same click — so the dialog's opener is a control that is still on screen and focus has somewhere
 * real to return to when it closes. Without that the opener would be a menu item that no longer
 * exists, and a keyboard user would be dropped at the top of the document.
 *
 * The refusal renders inside the confirm box, where this form is still on screen to show it. The
 * success redirects to the group with the note, which is why nothing here announces one.
 */
export function ExpenseRowMenuPanel({
  groupId,
  expenseId,
  description,
  menuId,
  onClose,
  onDelete,
  onItemMount,
}: {
  groupId: string;
  expenseId: string;
  description: string;
  menuId: string;
  onClose: () => void;
  onDelete: () => void;
  onItemMount: (index: number, element: HTMLElement | null) => void;
}) {
  return (
    <MenuPanel id={menuId} label={`Actions for ${description}`}>
      <Link
        ref={(element) => onItemMount(0, element)}
        href={`/groups/${groupId}/expenses/${expenseId}/edit`}
        role="menuitem"
        onClick={onClose}
        className={MENU_ITEM_CLASSES}
      >
        Edit
      </Link>
      <button
        ref={(element) => onItemMount(1, element)}
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
  );
}

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
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Menu
        label={`Actions for ${description}`}
        triggerLabel={`Actions for ${description}`}
        trigger={<MoreHorizontal className="size-5" aria-hidden="true" />}
        panel={({ menuId, onClose, onItemMount }) => (
          <ExpenseRowMenuPanel
            groupId={groupId}
            expenseId={expenseId}
            description={description}
            menuId={menuId}
            onClose={onClose}
            onDelete={() => setConfirming(true)}
            onItemMount={onItemMount}
          />
        )}
      />

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
    </>
  );
}
