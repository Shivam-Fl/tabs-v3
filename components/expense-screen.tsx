import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppShell, type ShellViewer } from './app-shell';

/**
 * The shell the two expense screens share: the wrapper, the heading and its subline, the banner
 * an archived group gets in place of the form, and the way back.
 *
 * Both screens are the same page with one word changed — where the expense comes from — so the
 * difference is the `mode` prop and the two sentences it names, and the guard, the reads and the
 * editor stay in the page that owns them. `children` is the editor, plus the delete section on
 * the edit screen; an archived group never renders it, because the write would be refused
 * server-side anyway and a form whose only outcome is a refusal is not a courtesy.
 *
 * It wears the app shell now (IAC-4), wrapped around the one `<main>` rather than inside it, so
 * both expense screens get the signed-in chrome from one place and neither grows a second
 * landmark. The shell needs the viewer for its account menu, and the pages own the session — so
 * they pass the name down rather than this component reading it a second time.
 */
export function ExpenseScreen({
  mode,
  groupId,
  groupName,
  title,
  subtitle,
  archived,
  viewer,
  children,
}: {
  mode: 'new' | 'edit';
  groupId: string;
  groupName: string;
  /** The h1: the group's name on the create screen, the expense's description on the edit one. */
  title: string;
  /** The muted line under it, which names the currency the amounts are in. */
  subtitle: string;
  archived: boolean;
  /** Who the shell's account menu belongs to; the pages own the session, so they pass it down. */
  viewer?: ShellViewer;
  children: ReactNode;
}) {
  return (
    <AppShell place={groupName} viewer={viewer}>
      {/* A form is a form's width, not a list's: ui.md fixes detail and form pages at 640px, and
          the editor's rows of member inputs read as a column rather than as a table. */}
      <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-5 px-4 py-5">
        {/* Where this screen sits, above the heading rather than under it: a person who arrived by
            accident should be able to leave before reading what the page is. */}
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-2 text-secondary">
            <li>
              <Link
                className="font-medium text-accent underline-offset-4 hover:underline"
                href={`/groups/${groupId}`}
              >
                {groupName}
              </Link>
            </li>
            <li aria-hidden="true" className="text-ink-subtle">
              /
            </li>
            <li aria-current="page" className="truncate text-ink-muted">
              {mode === 'new' ? 'New expense' : 'Edit expense'}
            </li>
          </ol>
        </nav>

        <header className="flex flex-col gap-2">
          <h1 className="text-page font-semibold text-ink">{title}</h1>
          <p className="text-secondary text-ink-muted">{subtitle}</p>
        </header>

        {archived ? (
          <p role="status" className="rounded-token border border-muted/40 bg-surface p-3 text-sm">
            {mode === 'new'
              ? 'This group is archived, so nothing can be added to it.'
              : 'This group is archived, so this expense cannot be changed.'}
          </p>
        ) : (
          children
        )}

        <p className="text-muted">
          <Link className="text-accent underline" href={`/groups/${groupId}`}>
            {`Back to ${groupName}`}
          </Link>
        </p>
      </main>
    </AppShell>
  );
}
