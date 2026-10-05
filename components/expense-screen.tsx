import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The shell the two expense screens share: the wrapper, the heading and its subline, the banner
 * an archived group gets in place of the form, and the way back.
 *
 * Both screens are the same page with one word changed — where the expense comes from — so the
 * difference is the `mode` prop and the two sentences it names, and the guard, the reads and the
 * editor stay in the page that owns them. `children` is the editor, plus the delete section on
 * the edit screen; an archived group never renders it, because the write would be refused
 * server-side anyway and a form whose only outcome is a refusal is not a courtesy.
 */
export function ExpenseScreen({
  mode,
  groupId,
  groupName,
  title,
  subtitle,
  archived,
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
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1024px] flex-col gap-5 p-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-muted">{subtitle}</p>
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
  );
}
