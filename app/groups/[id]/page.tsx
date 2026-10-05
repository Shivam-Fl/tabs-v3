import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { DeleteExpenseForm } from '../../../components/expense-editor';
import { ArchiveGroupForm, RenameGroupForm } from '../../../components/groups-panels';
import { withDb } from '../../../lib/db/client';
import {
  EXPENSE_CATEGORY_PARAM,
  EXPENSE_CATEGORIES,
  EXPENSE_MEMBER_PARAM,
  EXPENSE_NOTICE_PARAM,
  EXPENSE_SEARCH_PARAM,
  SPLIT_TYPE_LABELS,
  expenseCategoryLabel,
  expenseFiltersFrom,
  expenseNoticeText,
} from '../../../lib/expenses/validation';
import { listExpenses, type ExpenseListRow } from '../../../lib/expenses/queries';
import { guardGroup, type GroupAccess } from '../../../lib/groups/authz';
import { getMemberBalance } from '../../../lib/groups/members';
import {
  ARCHIVED_NOTICE,
  ARCHIVED_NOTICE_PARAM,
  GROUP_TYPE_LABELS,
  archivedNoticeText,
  type GroupType,
} from '../../../lib/groups/validation';
import { listMembers, type MemberRow } from '../../../lib/groups/queries';
import { formatMinorUnits } from '../../../lib/money/format';

export const metadata: Metadata = { title: 'Group · Tabs' };

const QUIET_BUTTON = 'min-h-11 rounded-token border border-muted/40 px-4 font-medium';
const INPUT_CLASSES =
  'min-h-11 w-full rounded-token border border-muted/40 bg-surface px-3 text-ink placeholder:text-muted';

/**
 * The group detail screen: who owes whom here, and what happened recently — of which this slice
 * builds the header, the balance banner shell, the expense list with its filters, and the
 * settings section. The debts card and the activity excerpt belong to TR-9 and TR-10, and land on
 * this page rather than in a second one.
 *
 * The guard decides everything else. A signed-out visitor is sent to sign in with the way back;
 * a stranger, a malformed id and a group that does not exist all render the same 404, because
 * the guard cannot tell them apart any more than the reader can.
 *
 * The list reads through the filter the query carries, so a bookmarked or shared URL shows the
 * same rows to everybody it is opened by, and every filter is applied in the query rather than
 * after it — a filter applied on screen would be a filter that lies about the page count the
 * moment there is a second page.
 *
 * An archive lands here carrying the notice flag, because archiving is what unmounts the settings
 * form that would have shown the confirmation (AC-11). A create, an edit and a delete land here
 * the same way, for the same reason: the row that would have shown the message is the row the
 * change added, replaced or removed.
 */
export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    archived?: string;
    expense?: string;
    member?: string;
    category?: string;
    q?: string;
  }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const access = await withDb((handle) => guardGroup(handle.db, id));

  if (access.status === 'unauthenticated') {
    redirect(`/signin?next=${encodeURIComponent(`/groups/${id}`)}`);
  }
  if (access.status === 'not-found') notFound();

  const filters = expenseFiltersFrom(query);

  // One read at a time: the embedded backend serves a single connection, so two queries in
  // flight together are a queue pretending to be a race.
  const expenses = await withDb((handle) => listExpenses(handle.db, access.group.id, filters));
  const members = await withDb((handle) => listMembers(handle.db, access.group.id));

  return (
    <GroupDetail
      access={access}
      expenses={expenses}
      members={members}
      filters={filters}
      justArchived={query[ARCHIVED_NOTICE_PARAM] === ARCHIVED_NOTICE}
      expenseNotice={expenseNoticeText(query[EXPENSE_NOTICE_PARAM])}
    />
  );
}

function GroupDetail({
  access,
  expenses,
  members,
  filters,
  justArchived,
  expenseNotice,
}: {
  access: Extract<GroupAccess, { status: 'ok' }>;
  expenses: ExpenseListRow[];
  members: MemberRow[];
  filters: ReturnType<typeof expenseFiltersFrom>;
  justArchived: boolean;
  expenseNotice: string | null;
}) {
  const { group, membership, user } = access;
  const isOwner = membership.role === 'owner';
  const balance = getMemberBalance(group.id, membership.id);
  const filtered = filters.memberId !== null || filters.category !== null || filters.search !== null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1024px] flex-col gap-5 p-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{group.name}</h1>
        <p className="text-muted">
          {GROUP_TYPE_LABELS[group.type as GroupType] ?? group.type} · {group.currency} ·{' '}
          {user.displayName}
        </p>
        <p>
          <Link className="text-accent underline" href={`/groups/${group.id}/members`}>
            Members and invite link
          </Link>
        </p>
      </header>

      {group.archived ? (
        <>
          {justArchived ? (
            <p
              role="status"
              aria-live="polite"
              className="rounded-token border border-muted/40 bg-surface p-3 text-sm text-lent"
            >
              {archivedNoticeText(group.name)}
            </p>
          ) : null}
          <p
            role="status"
            className="rounded-token border border-muted/40 bg-surface p-3 text-sm"
          >
            This group is archived. You can read it, but nothing in it can change — and you can
            still leave it.
          </p>
        </>
      ) : null}

      {/* One slot, like the invite notices: whichever change last landed here is the one worth
          saying, and the row it happened to is already on screen below. */}
      {expenseNotice ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded-token border border-muted/40 bg-surface p-3 text-sm text-lent"
        >
          {expenseNotice}
        </p>
      ) : null}

      <section
        className="rounded-token border border-muted/20 bg-surface p-4"
        aria-labelledby="balance-heading"
      >
        <h2 id="balance-heading" className="text-lg font-semibold">
          Your balance
        </h2>
        <p data-amount className="text-xl font-semibold">
          {formatMinorUnits(balance, group.currency)}
        </p>
        <p className="text-sm text-muted">
          Everyone is settled up. Balances appear here once the group records expenses.
        </p>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="expenses-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="expenses-heading" className="text-lg font-semibold">
            Expenses
          </h2>
          {group.archived ? null : (
            <Link
              className="inline-flex min-h-11 items-center rounded-token bg-accent px-4 font-medium text-surface"
              href={`/groups/${group.id}/expenses/new`}
            >
              Add expense
            </Link>
          )}
        </div>

        {/* A plain GET form: the filter is in the URL, so the page someone is looking at is the
            page they can send to somebody else — and it works before any JavaScript arrives. */}
        <form
          method="get"
          action={`/groups/${group.id}`}
          className="flex flex-col gap-3 rounded-token border border-muted/20 bg-surface p-4 sm:flex-row sm:flex-wrap sm:items-end"
        >
          <div className="flex flex-col gap-1 sm:w-48">
            <label className="text-sm font-medium" htmlFor="expense-filter-member">
              Member
            </label>
            <select
              id="expense-filter-member"
              name={EXPENSE_MEMBER_PARAM}
              defaultValue={filters.memberId ?? ''}
              className={INPUT_CLASSES}
            >
              <option value="">Everyone</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 sm:w-48">
            <label className="text-sm font-medium" htmlFor="expense-filter-category">
              Category
            </label>
            <select
              id="expense-filter-category"
              name={EXPENSE_CATEGORY_PARAM}
              defaultValue={filters.category ?? ''}
              className={INPUT_CLASSES}
            >
              <option value="">All categories</option>
              {EXPENSE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {expenseCategoryLabel(category)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-1 flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="expense-filter-search">
              Search descriptions
            </label>
            <input
              id="expense-filter-search"
              name={EXPENSE_SEARCH_PARAM}
              type="search"
              defaultValue={filters.search ?? ''}
              className={INPUT_CLASSES}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={QUIET_BUTTON}>
              Filter
            </button>
            {filtered ? (
              <Link className="text-accent underline" href={`/groups/${group.id}`}>
                Clear
              </Link>
            ) : null}
          </div>
        </form>

        {expenses.length === 0 ? (
          <p className="text-sm text-muted">
            {filtered
              ? 'No expenses match these filters.'
              : 'No expenses yet. Add the first one and the balances will follow.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {expenses.map((expense) => (
              <li
                key={expense.id}
                className="flex flex-col gap-2 rounded-token border border-muted/20 bg-surface p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{expense.description}</span>
                  <span data-amount className="font-semibold">
                    {formatMinorUnits(expense.amountMinor, group.currency)}
                  </span>
                </div>
                <p className="text-sm text-muted">
                  <time dateTime={expense.date}>{expense.date}</time> ·{' '}
                  {expenseCategoryLabel(expense.category)} ·{' '}
                  {SPLIT_TYPE_LABELS[expense.splitType]} · Paid by{' '}
                  {expense.payers
                    .map((payer) =>
                      expense.payers.length === 1
                        ? payer.displayName
                        : `${payer.displayName} ${formatMinorUnits(payer.amountMinor, group.currency)}`,
                    )
                    .join(', ')}
                </p>
                {group.archived ? null : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      className="inline-flex min-h-11 items-center rounded-token border border-muted/40 px-4 font-medium"
                      href={`/groups/${group.id}/expenses/${expense.id}/edit`}
                    >
                      Edit
                    </Link>
                    <DeleteExpenseForm
                      groupId={group.id}
                      expenseId={expense.id}
                      description={expense.description}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isOwner && !group.archived ? (
        <section
          className="flex flex-col gap-4 rounded-token border border-muted/20 bg-surface p-4"
          aria-labelledby="settings-heading"
        >
          <h2 id="settings-heading" className="text-lg font-semibold">
            Group settings
          </h2>
          <RenameGroupForm groupId={group.id} name={group.name} />
          <ArchiveGroupForm groupId={group.id} groupName={group.name} />
          <p className="text-sm text-muted">
            Removing members and leaving live with the member list.
          </p>
          <p>
            <Link className="text-accent underline" href={`/groups/${group.id}/members`}>
              Go to members
            </Link>
          </p>
        </section>
      ) : null}
    </main>
  );
}
