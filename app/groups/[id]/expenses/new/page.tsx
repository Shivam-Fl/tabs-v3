import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ExpenseEditor } from '../../../../../components/expense-editor';
import { ExpenseScreen } from '../../../../../components/expense-screen';
import { withDb } from '../../../../../lib/db/client';
import { getExpenseEditorData, type ExpenseEditorData } from '../../../../../lib/expenses/queries';
import { guardGroup, type GroupAccess } from '../../../../../lib/groups/authz';

export const metadata: Metadata = { title: 'Add an expense · Tabs' };

/**
 * Recording an expense (TR-8).
 *
 * The same guard and the same 404 as every other group screen, and the editor's data is read
 * after it: the group, its currency and its members come from the membership the guard resolved,
 * so a stranger's request never reaches the query that would name them.
 *
 * An archived group gets the truth instead of a form: the write would be refused server-side
 * anyway, and offering a button whose only outcome is a refusal is not a courtesy.
 */
export default async function NewExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const access = await withDb((handle) => guardGroup(handle.db, id));

  if (access.status === 'unauthenticated') {
    redirect(`/signin?next=${encodeURIComponent(`/groups/${id}/expenses/new`)}`);
  }
  if (access.status === 'not-found') notFound();

  // A null expense id is what "new" means to this read: today, the viewer paying, everyone in.
  const data = await withDb((handle) =>
    getExpenseEditorData(handle.db, access.group.id, null, access.membership.id),
  );
  if (!data) notFound();

  return <NewExpenseScreen access={access} data={data} />;
}

function NewExpenseScreen({
  access,
  data,
}: {
  access: Extract<GroupAccess, { status: 'ok' }>;
  data: ExpenseEditorData;
}) {
  const { group, user } = access;

  return (
    <ExpenseScreen
      mode="new"
      groupId={group.id}
      groupName={group.name}
      title={`Add an expense to ${group.name}`}
      subtitle={`Amounts are in ${group.currency}. Recorded by ${user.displayName}.`}
      archived={group.archived}
    >
      <ExpenseEditor groupId={group.id} expenseId={null} currency={group.currency} data={data} />
    </ExpenseScreen>
  );
}
