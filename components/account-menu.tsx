'use client';

import Link from 'next/link';
import { signOut } from '../lib/auth/actions';
import { Avatar } from './ui';
import { MENU_ITEM_CLASSES, Menu, MenuPanel, menuKeyIntent, stepMenuItem } from './ui-interactive';

/**
 * The shell's account menu — the one client island on the signed-in chrome, and the first caller
 * of the shared menu.
 *
 * It is a separate module from `app-shell.tsx` for a reason that is not stylistic: a `'use
 * client'` directive applies to the whole file it sits in, so the menu and the server-rendered
 * top bar around it cannot share one. Keeping the island here is what lets the shell itself stay
 * a server component, which is the shape the plan asks for and the thing that keeps the bar's
 * cost off the client.
 *
 * It is a menu rather than a pair of links because ui.md puts sign-out behind the avatar: the
 * panel is `role="menu"`, its two actions are `role="menuitem"`, focus moves into it with the
 * arrow keys, Escape closes it, and closing returns focus to the avatar that opened it.
 *
 * The control itself now lives in `ui-interactive.tsx`, because the expense and payment rows need
 * the same one for their overflow actions. What stays here is what this menu *says*. The two
 * arithmetic helpers are re-exported rather than moved out of reach, so the shell's own tests and
 * any caller that already imports them here keep working against the one implementation.
 *
 * Sign-out posts the existing `signOut` action rather than calling it from a handler: the action
 * clears the cookie and redirects, which is a navigation the server has to make.
 */

export { menuKeyIntent, stepMenuItem };

/**
 * The open menu, apart from the button that opens it.
 *
 * It is its own component for one reason: the repo has no jsdom, so a menu that only exists
 * after a click is a menu no test in this tree can see. `AccountMenu` still owns every piece of
 * state — this renders what the open menu says, and the island below hands it the two callbacks
 * it needs.
 */
export function AccountMenuPanel({
  displayName,
  menuId,
  onClose,
  onItemMount,
}: {
  displayName: string;
  /** The id the trigger's `aria-controls` points at while the menu is open. */
  menuId: string;
  onClose: () => void;
  /** Where each item lands, in render order, so the island can move focus between them. */
  onItemMount?: (index: number, element: HTMLElement | null) => void;
}) {
  return (
    <MenuPanel id={menuId} label="Account">
      <p className="truncate px-3 py-2 text-secondary text-ink-muted">{displayName}</p>
      <Link
        ref={(element) => onItemMount?.(0, element)}
        href="/profile"
        role="menuitem"
        onClick={onClose}
        className={MENU_ITEM_CLASSES}
      >
        Profile
      </Link>
      <form action={signOut}>
        <button
          ref={(element) => onItemMount?.(1, element)}
          type="submit"
          role="menuitem"
          className={MENU_ITEM_CLASSES}
        >
          Sign out
        </button>
      </form>
    </MenuPanel>
  );
}

export function AccountMenu({ displayName, memberId }: { displayName: string; memberId?: string }) {
  return (
    <Menu
      label="Account"
      triggerLabel={displayName === '' ? 'Account menu' : `Account menu for ${displayName}`}
      trigger={<Avatar name={displayName} memberId={memberId} />}
      triggerClassName="inline-flex items-center justify-center rounded-full p-1 hover:bg-surface-sunken"
      panel={({ menuId, onClose, onItemMount }) => (
        <AccountMenuPanel
          displayName={displayName}
          menuId={menuId}
          onClose={onClose}
          onItemMount={onItemMount}
        />
      )}
    />
  );
}
