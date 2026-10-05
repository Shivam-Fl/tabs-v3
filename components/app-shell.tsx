import Link from 'next/link';
import type { ReactNode } from 'react';
import { AccountMenu } from './account-menu';
import { Skeleton } from './ui';

/**
 * The one app shell every signed-in page wears (ui.md's navigation pattern): a slim top bar with
 * the Tabs mark linking Home, the current place, and the account menu.
 *
 * It is a server component and it is deliberately small. Everything in it is markup the server
 * can render — the only client code in the signed-in chrome is the account menu island, which is
 * why the shell can be composed onto nine pages without putting any of them on the client.
 *
 * **It emits no heading.** A page owns its own h1; a shell that printed one would make every
 * screen in the product either two h1s or none, and the second is how a page loses its title to
 * a navigation bar. The current place is a `<span>` for exactly that reason.
 *
 * It renders `children` directly rather than inside a wrapper of its own so that each page keeps
 * the `<main>` it already owns — one main landmark per screen, in the file that knows what the
 * screen is. The pages pass a `<main>` whose `flex-1` fills the space under the bar.
 */

/**
 * The Tabs mark, the same rounded square as the favicon (`app/icon.svg`) drawn inline rather
 * than copied as a file so the two cannot drift. Decorative next to its link's label, and
 * `aria-hidden` for it.
 */
export function TabsMark() {
  return (
    <svg
      viewBox="0 0 64 64"
      width="32"
      height="32"
      aria-hidden="true"
      focusable="false"
      className="shrink-0 rounded-token"
    >
      <rect width="64" height="64" rx="14" fill="var(--color-accent)" />
      <text
        x="32"
        y="32"
        fill="var(--color-accent-contrast)"
        fontFamily="var(--font-body)"
        fontSize="38"
        fontWeight="700"
        textAnchor="middle"
        dominantBaseline="central"
      >
        T
      </text>
    </svg>
  );
}

/** Who the account menu belongs to; empty until the session has been read. */
export interface ShellViewer {
  displayName: string;
  memberId?: string;
}

export function AppShell({
  place,
  viewer,
  children,
}: {
  /**
   * The current place's name. `null` means this screen has a place but the shell does not know
   * it yet — a loading boundary, which paints before the guard has run — and the shell renders
   * the placeholder in its stead so the bar is the same height either way. Omit it entirely for
   * a screen with no place; the slot collapses.
   */
  place?: string | null;
  viewer?: ShellViewer;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-[1024px] items-center gap-3 px-4 py-2">
          <Link
            href="/"
            aria-label="Tabs — Home"
            className="inline-flex items-center justify-center rounded-token p-1 hover:bg-surface-sunken"
          >
            <TabsMark />
          </Link>

          <div className="flex min-w-0 flex-1 items-center">
            {place === undefined ? null : place === null ? (
              <Skeleton className="h-5 w-28" />
            ) : (
              <span className="truncate text-secondary font-medium text-ink" title={place}>
                {place}
              </span>
            )}
          </div>

          <AccountMenu
            displayName={viewer?.displayName ?? ''}
            memberId={viewer?.memberId}
          />
        </div>
      </header>

      {children}
    </div>
  );
}
