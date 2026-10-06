import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { DeleteExpenseForm, ExpenseEditor } from '../../../../../../components/expense-editor';
import { ExpenseScreen } from '../../../../../../components/expense-screen';
import { EditorFormSkeleton } from '../../../../../../components/group-skeletons';
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
 *
 * The guard, the id parse and the redirect all happen above the `<Suspense>` boundary that this
 * page now hands its read to, and that ordering is the contract (AC-17). The segment above this
 * route used to carry a `loading.tsx`, which Next wrapped the page in: the form skeleton was
 * flushed and the response's status committed before the guard had answered, so a signed-out or
 * stranger request to this URL got HTTP 200 with a form-shaped body. A fallback below the guard
 * cannot do that — nothing streams until the guard has thrown — and a member still watches the
 * form arrive instead of a blank route.
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

  return (
    <Suspense fallback={<EditorFormSkeleton place={access.group.name} />}>
      <EditExpenseBody access={access} expenseId={scope.data} />
    </Suspense>
  );
}

/** The read and the screen, inside the boundary — this is the part a cold navigation waits on. */
async function EditExpenseBody({
  access,
  expenseId,
}: {
  access: Extract<GroupAccess, { status: 'ok' }>;
  expenseId: string;
}) {
  const data = await withDb((handle) =>
    getExpenseEditorData(handle.db, access.group.id, expenseId, access.membership.id),
  );
  if (!data) notFound();

  return <EditExpenseScreen access={access} expenseId={expenseId} data={data} />;
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
  const { group, user } = access;

  return (
    <ExpenseScreen
      mode="edit"
      groupId={group.id}
      groupName={group.name}
      title={`Edit “${data.description}”`}
      subtitle={`${group.name} · amounts in ${group.currency}`}
      archived={group.archived}
      viewer={{ displayName: user.displayName }}
    >
      <ExpenseEditor
        groupId={group.id}
        expenseId={expenseId}
        currency={group.currency}
        data={data}
      />
      {/* Outside the editor's own form: a form inside a form is not a thing HTML has, and
          the delete is its own submission with its own action. The confirm itself is inside a
          dialog this section only triggers — the same one the group page's row menu opens — so the
          question naming the expense appears over the page rather than under it, and focus comes
          back to this button when it closes (IAC-7). */}
      <section className="rounded-token border border-border bg-surface p-4">
        <h2 className="mb-3 text-section font-semibold text-ink">Delete this expense</h2>
        <DeleteExpenseForm
          groupId={group.id}
          expenseId={expenseId}
          description={data.description}
        />
      </section>
    </ExpenseScreen>
  );
}
