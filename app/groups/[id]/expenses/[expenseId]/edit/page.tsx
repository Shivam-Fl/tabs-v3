import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { DeleteExpenseForm, ExpenseEditor } from '../../../../../../components/expense-editor';
import { withDb } from '../../../../../../lib/db/client';
import { getExpenseEditorData, type ExpenseEditorData } from '../../../../../../lib/expenses/queries';
import { expenseScope } from '../../../../../../lib/expenses/validation';
import { guardGroup, type GroupAccess } from '../../../../../../lib/groups/authz';

export const metadata: Metadata = { title: 'Edit an expense · Tabs' };

/**
 * Editing an expense (TR-8).
 *
 * The editor reopens on what was stored rather than on what the shares came to: the split type
 * the group chose, and each member's own input in the unit that type names — which is the whole
 * point of storing the rule beside its result (ADR-0007), and the thing that makes an edit an
 * edit rather than a re-entry.
 *
 * The id is parsed before it reaches a query, so a malformed one is the same 404 as an id from
 * another group: the guard has already answered whether this caller may see the group at all.
 */
export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ id: string; expenseId: string }>;
}) {
  const { id, expenseId } = await params;
  const access = await withDb((handle) => guardGroup(handle.db, id));

  if (access.status === 'unauthenticated') {
    redirect(
      `/signin?next=${encodeURIComponent(`/groups/${id}/expenses/${expenseId}/edit`)}`,
    );
  }
  if (access.status === 'not-found') notFound();

  const scope = expenseScope.safeParse(expenseId);
  if (!scope.success) notFound();

  const data = await withDb((handle) =>
    getExpenseEditorData(handle.db, access.group.id, scope.data, access.membership.id),
  );
  if (!data) notFound();

  return <EditExpenseScreen access={access} expenseId={scope.data} data={data} />;
}

function EditExpenseScreen({
  access,
  expenseId,
  data,
}: {
  access: Extract<GroupAccess, { status: 'ok' }>;
  expenseId: string;
  data: ExpenseEditorData;
}) {
  const { group } = access;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1024px] flex-col gap-5 p-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{`Edit “${data.description}”`}</h1>
        <p className="text-muted">{`${group.name} · amounts in ${group.currency}`}</p>
      </header>

      {group.archived ? (
        <p role="status" className="rounded-token border border-muted/40 bg-surface p-3 text-sm">
          This group is archived, so this expense cannot be changed.
        </p>
      ) : (
        <>
          <ExpenseEditor
            groupId={group.id}
            expenseId={expenseId}
            currency={group.currency}
            data={data}
          />
          {/* Outside the editor's own form: a form inside a form is not a thing HTML has, and
              the delete is its own submission with its own action. */}
          <section className="rounded-token border border-muted/20 bg-surface p-4">
            <h2 className="mb-3 text-lg font-semibold">Delete this expense</h2>
            <DeleteExpenseForm
              groupId={group.id}
              expenseId={expenseId}
              description={data.description}
            />
          </section>
        </>
      )}

      <p className="text-muted">
        <Link className="text-accent underline" href={`/groups/${group.id}`}>
          Back to {group.name}
        </Link>
      </p>
    </main>
  );
}
