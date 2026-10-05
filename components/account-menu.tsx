'use client';

import Link from 'next/link';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { signOut } from '../lib/auth/actions';
import { Avatar } from './ui';

/**
 * The shell's account menu — the one client island on the signed-in chrome.
 *
 * It is a separate module from `app-shell.tsx` for a reason that is not stylistic: a `'use
 * client'` directive applies to the whole file it sits in, so the menu and the server-rendered
 * top bar around it cannot share one. Keeping the island here is what lets the shell itself stay
 * a server component, which is the shape the plan asks for and the thing that keeps the bar's
 * cost off the client.
 *
 * It is a menu rather than a pair of links because ui.md puts sign-out behind the avatar: the
 * panel is `role="menu"`, its two actions are `role="menuitem"`, focus moves into it with the
 * arrow keys, Escape closes it, and closing returns focus to the avatar that opened it — the
 * only focus destination a keyboard user can predict.
 *
 * Sign-out posts the existing `signOut` action rather than calling it from a handler: the action
 * clears the cookie and redirects, which is a navigation the server has to make.
 */

/** The one keystroke this menu claims; every other key belongs to the browser. */
export function menuKeyIntent(key: string): 'close' | null {
  return key === 'Escape' ? 'close' : null;
}

/** Where an arrow key moves within a menu of `count` items, wrapping at both ends. */
export function stepMenuItem(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown':
      return (current + 1) % count;
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

const ITEM_CLASSES =
  'flex min-h-11 w-full items-center rounded-token px-3 text-left text-body text-ink hover:bg-surface-sunken focus-visible:bg-surface-sunken';

/**
 * The open menu, apart from the button that opens it.
 *
 * It is its own component for one reason: the repo has no jsdom, so a menu that only exists
 * after a click is a menu no test in this tree can see. `AccountMenu` still owns every piece of
 * state — this renders what the open menu says, and the island below hands it the two callbacks
 * it needs. The sign-out posts the action rather than calling it, because clearing the cookie
 * and redirecting is a navigation only the server can make.
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
    <div
      id={menuId}
      role="menu"
      aria-label="Account"
      className="absolute right-0 z-40 mt-2 flex w-56 flex-col gap-1 rounded-token border border-border bg-surface p-1 shadow-md"
    >
      <p className="truncate px-3 py-2 text-secondary text-ink-muted">{displayName}</p>
      <Link
        ref={(element) => onItemMount?.(0, element)}
        href="/profile"
        role="menuitem"
        onClick={onClose}
        className={ITEM_CLASSES}
      >
        Profile
      </Link>
      <form action={signOut}>
        <button
          ref={(element) => onItemMount?.(1, element)}
          type="submit"
          role="menuitem"
          className={ITEM_CLASSES}
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

export function AccountMenu({ displayName, memberId }: { displayName: string; memberId?: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLElement | null)[]>([]);
  const menuId = useId();

  function close(): void {
    setOpen(false);
    button.current?.focus();
  }

  function move(event: KeyboardEvent<HTMLDivElement>): void {
    if (menuKeyIntent(event.key) === 'close') {
      event.stopPropagation();
      close();
      return;
    }
    const next = stepMenuItem(active, event.key, items.current.length);
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    items.current[next]?.focus();
  }

  return (
    <div className="relative shrink-0" onKeyDown={move}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={displayName === '' ? 'Account menu' : `Account menu for ${displayName}`}
        onClick={() => {
          setActive(0);
          setOpen((shown) => !shown);
        }}
        className="inline-flex items-center justify-center rounded-full p-1 hover:bg-surface-sunken"
      >
        <Avatar name={displayName} memberId={memberId} />
      </button>

      {open ? (
        <AccountMenuPanel
          displayName={displayName}
          menuId={menuId}
          onClose={close}
          onItemMount={(index, element) => {
            items.current[index] = element;
          }}
        />
      ) : null}
    </div>
  );
}
