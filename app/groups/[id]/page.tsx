import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ActivityFeed, type PreservedParams } from '../../../components/activity-feed';
import { AppShell } from '../../../components/app-shell';
import { ExpenseRowMenu } from '../../../components/expense-row-menu';
import { ArchiveGroupForm, RenameGroupForm } from '../../../components/groups-panels';
import { DeletePaymentForm, SettleUpForm } from '../../../components/settle-panels';
import { INPUT_CLASSES, QUIET_BUTTON } from '../../../components/ui';
import {
  ACTIVITY_FILTER_PARAM,
  activityFilterFrom,
  listGroupActivity,
  type ActivityFilter,
  type ActivityRow,
} from '../../../lib/activity/queries';
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
import {
  ARCHIVED_NOTICE,
  ARCHIVED_NOTICE_PARAM,
  GROUP_TYPE_LABELS,
  archivedNoticeText,
  type GroupType,
} from '../../../lib/groups/validation';
import { listMembers, type MemberRow } from '../../../lib/groups/queries';
import { formatMinorUnits } from '../../../lib/money/format';
import { humanDateLabel } from '../../../lib/money/human-date';
import { computeNetBalances, type MemberBalance } from '../../../lib/settle/balances';
import { listPayments, type PaymentRow } from '../../../lib/settle/queries';
import { simplifyDebts, type Transfer } from '../../../lib/settle/simplify';
import {
  PAYMENT_NOTICE_FROM_PARAM,
  PAYMENT_NOTICE_PARAM,
  PAYMENT_NOTICE_TO_PARAM,
  directedRemainderMinor,
  paymentNoticePair,
  paymentNoticeText,
} from '../../../lib/settle/validation';

export const metadata: Metadata = { title: 'Group · Tabs' };

/**
 * The group detail screen: who owes whom here, and what happened recently — the header, the
 * balance banner, the debts card with the simplified transfers and the settle-up payments, the
 * expense list with its filters, and the settings section. The activity excerpt belongs to TR-10
 * and lands on this page rather than in a second one.
 *
 * Every balance on it comes from the one recompute path (TR-9) and every transfer from the one
 * simplification beside it, so the banner, the member rows, the suggested payments and the
 * members page are four renderings of one arithmetic rather than four opinions. The card is
 * above the expense list in the DOM, which is what makes a narrow screen stack the two the way
 * ui.md describes.
 *
 * The guard decides everything else. A signed-out visitor is sent to sign in with the way back;
 * a stranger, a malformed id and a group that does not exist all render the same 404, because
 * the guard cannot tell them apart any more than the reader can.
 *
 * The list reads through the filter the query carries, so a bookmarked or shared URL shows the
 * same rows to everybody it is opened by, and every filter is applied in the query rather than
 * after it — a filter applied on screen would be a filter that lies about the page count the
 * moment there is a second page. The activity excerpt's chip carries its own parameter beside
 * them, and the two forms re-submit each other's values so neither filter clears the other
 * (AC-8).
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
    payment?: string;
    from?: string;
    to?: string;
    activity?: string;
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
  const activityFilter = activityFilterFrom(query[ACTIVITY_FILTER_PARAM]);

  // One read at a time: the embedded backend serves a single connection, so two queries in
  // flight together are a queue pretending to be a race.
  const expenses = await withDb((handle) => listExpenses(handle.db, access.group.id, filters));
  const members = await withDb((handle) => listMembers(handle.db, access.group.id));
  const balances = await withDb((handle) => computeNetBalances(handle.db, access.group.id));
  const payments = await withDb((handle) => listPayments(handle.db, access.group.id));

  // The feed is read on its own, and its failure is kept on its own too: the balances, the debts
  // and the expense list on this page are still true, and taking the whole screen down for the
  // one section that did not come back is a worse answer than saying which one it was. The page's
  // own load covers the loading state — this section has none of its own to show.
  let activity: ActivityRow[] = [];
  let activityFailed = false;
  try {
    activity = await withDb((handle) =>
      listGroupActivity(handle.db, access.group.id, activityFilter),
    );
  } catch (error) {
    console.error('[tabs] group activity: could not load the feed', error);
    activityFailed = true;
  }

  // The simplification is arithmetic on the numbers above, not another read: it is the same call
  // the home screen makes, so "Cy pays you 100" here and "Cy owes you 100" there cannot diverge.
  const transfers = simplifyDebts(balances);

  // What a just-recorded or just-deleted payment has to say (AC-6, ADR-0008). The flag rides the
  // redirect's query, and so does the pair it was about — because the sentence names what is still
  // owed *between those two*, and that is a fact about the balances, not about the form that
  // submitted. Both ids have to be seats of this group, in the same read the balances came from:
  // anything else renders nothing at all, exactly as a forged flag does, so a hand-written URL
  // cannot put a sentence about two strangers on somebody's screen. The remainder is recomputed
  // here through the same simplification the suggested payments use, so the notice and the row
  // under it can never disagree about who owes whom.
  const seatIds = new Set(balances.map((balance) => balance.membershipId));
  const paymentPair = paymentNoticePair(
    { from: query[PAYMENT_NOTICE_FROM_PARAM], to: query[PAYMENT_NOTICE_TO_PARAM] },
    seatIds,
  );
  const paymentNotice =
    paymentPair === null
      ? null
      : paymentNoticeText(
          query[PAYMENT_NOTICE_PARAM],
          directedRemainderMinor(
            transfers,
            paymentPair.fromMembershipId,
            paymentPair.toMembershipId,
          ),
          access.group.currency,
        );

  return (
    <GroupDetail
      access={access}
      expenses={expenses}
      members={members}
      balances={balances}
      transfers={transfers}
      payments={payments}
      filters={filters}
      activity={activity}
      activityFilter={activityFilter}
      activityFailed={activityFailed}
      retryHref={pageHref(access.group.id, query)}
      justArchived={query[ARCHIVED_NOTICE_PARAM] === ARCHIVED_NOTICE}
      expenseNotice={expenseNoticeText(query[EXPENSE_NOTICE_PARAM])}
      paymentNotice={paymentNotice}
    />
  );
}

/**
 * This page's own URL, rebuilt from the parameters it was opened with — every filter, both of
 * them, exactly as the reader set them.
 *
 * It is what the activity section's retry re-requests, which is why it is built from the raw
 * query rather than from the parsed filters: the retry has to land on the page the reader was
 * already looking at, filter and all, not on a version of it this code thought was tidier.
 */
function pageHref(groupId: string, query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (typeof value === 'string' && value !== '') params.set(name, value);
  }

  const search = params.toString();
  return search === '' ? `/groups/${groupId}` : `/groups/${groupId}?${search}`;
}

function GroupDetail({
  access,
  expenses,
  members,
  balances,
  transfers,
  payments,
  filters,
  activity,
  activityFilter,
  activityFailed,
  retryHref,
  justArchived,
  expenseNotice,
  paymentNotice,
}: {
  access: Extract<GroupAccess, { status: 'ok' }>;
  expenses: ExpenseListRow[];
  members: MemberRow[];
  balances: MemberBalance[];
  transfers: Transfer[];
  payments: PaymentRow[];
  filters: ReturnType<typeof expenseFiltersFrom>;
  activity: ActivityRow[];
  activityFilter: ActivityFilter;
  activityFailed: boolean;
  retryHref: string;
  justArchived: boolean;
  expenseNotice: string | null;
  paymentNotice: string | null;
}) {
  const { group, membership, user } = access;
  const isOwner = membership.role === 'owner';
  // What "today" means to the dates in this list, read once on the server: the rows are rendered
  // here rather than in the browser, so there is no second clock to disagree with this one.
  const today = new Date().toISOString().slice(0, 10);
  const filtered = filters.memberId !== null || filters.category !== null || filters.search !== null;

  // What the chip row re-submits: the expense filter exactly as it stands, so choosing a chip
  // cannot clear it (AC-8). Only values that are set travel — an empty parameter is noise the
  // reader did not ask for, and a Clear that left one behind would be a Clear that did nothing.
  const activityPreserved: PreservedParams = {
    ...(filters.memberId ? { [EXPENSE_MEMBER_PARAM]: filters.memberId } : {}),
    ...(filters.category ? { [EXPENSE_CATEGORY_PARAM]: filters.category } : {}),
    ...(filters.search ? { [EXPENSE_SEARCH_PARAM]: filters.search } : {}),
  };

  // And the other direction: the expense form's own Clear resets the expense filter and leaves
  // the chip where it was, which is why it goes to a URL that still carries the chip.
  const clearExpenseHref =
    activityFilter === 'all'
      ? `/groups/${group.id}`
      : `/groups/${group.id}?${ACTIVITY_FILTER_PARAM}=${encodeURIComponent(activityFilter)}`;

  // Every current member is on the debts card even at zero — a row that vanished would read as
  // somebody missing — while a departed seat (ADR-0007) is only worth a row when it still holds
  // a balance: at zero it is a name the group can do nothing about.
  const currentIds = new Set(members.map((member) => member.id));
  const shown = balances.filter(
    (balance) => currentIds.has(balance.membershipId) || balance.balanceMinor !== 0,
  );
  const ownMinor = balances.find((balance) => balance.membershipId === membership.id)?.balanceMinor ?? 0;
  const settled = transfers.length === 0;
  const bannerNote = settled
    ? 'Everyone is settled up — nobody owes anybody.'
    : ownMinor > 0
      ? 'You are owed in this group. The card below shows who pays you.'
      : ownMinor < 0
        ? 'You owe in this group. The card below shows who to pay and how much.'
        : 'You are settled up here. The card below shows what the others owe each other.';

  return (
    <AppShell place={group.name} viewer={{ displayName: user.displayName }}>
      <main className="mx-auto flex w-full max-w-[1024px] flex-1 flex-col gap-5 px-4 py-5">
        {/* Where this screen sits: the group is one click from Home, and the shell's place is only
            a label, not a way back. */}
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-2 text-secondary">
            <li>
              <Link
                className="font-medium text-accent underline-offset-4 hover:underline"
                href="/"
              >
                Home
              </Link>
            </li>
            <li aria-hidden="true" className="text-ink-subtle">
              /
            </li>
            <li aria-current="page" className="truncate text-ink-muted">
              {group.name}
            </li>
          </ol>
        </nav>

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
          <p
            data-amount
            className={`text-xl font-semibold ${ownMinor > 0 ? 'text-lent' : ownMinor < 0 ? 'text-owed' : ''}`}
          >
            {formatMinorUnits(ownMinor, group.currency)}
          </p>
          <p className="text-sm text-muted">{bannerNote}</p>
        </section>

        {/* The debts card sits above the expense list in the DOM, so a narrow screen stacks the two
            in the order ui.md asks for without a second layout. */}
        <section
          className="flex flex-col gap-3 rounded-token border border-muted/20 bg-surface p-4"
          aria-labelledby="debts-heading"
        >
          <h2 id="debts-heading" className="text-lg font-semibold">
            Who owes what
          </h2>

          {/* This card's own slot, and the only one a payment notice is ever rendered in (AC-6):
              recording or deleting a payment redirects here, and the row that held the form — with
              the region that would have announced it — is gone by then. The expense notice above
              has its own slot for the same reason, and neither borrows the other's. */}
          {paymentNotice ? (
            <p
              role="status"
              aria-live="polite"
              className="rounded-token border border-muted/40 bg-surface p-3 text-sm text-lent"
            >
              {paymentNotice}
            </p>
          ) : null}

          <ul className="flex flex-col gap-2">
            {shown.map((balance) => (
              <li
                key={balance.membershipId}
                className="flex flex-wrap items-baseline justify-between gap-2"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{balance.displayName}</span>
                  {currentIds.has(balance.membershipId) ? null : (
                    <span className="rounded-token border border-muted/40 px-2 text-sm text-muted">
                      No longer in the group
                    </span>
                  )}
                  <span className="text-sm text-muted">
                    {balance.balanceMinor > 0
                      ? 'is owed'
                      : balance.balanceMinor < 0
                        ? 'owes'
                        : 'is settled up'}
                  </span>
                </span>
                {balance.balanceMinor === 0 ? null : (
                  <span
                    data-amount
                    className={`font-semibold ${balance.balanceMinor > 0 ? 'text-lent' : 'text-owed'}`}
                  >
                    {formatMinorUnits(Math.abs(balance.balanceMinor), group.currency)}
                  </span>
                )}
              </li>
            ))}
          </ul>

          <h3 className="text-lg font-semibold">Suggested payments</h3>
          <p className="text-sm text-muted">
            {settled
              ? 'Nothing to settle — the totals above are all zero.'
              : 'Settle up records a payment between two people. It does not move money by itself.'}
          </p>
          <SettleUpForm
            groupId={group.id}
            currency={group.currency}
            transfers={transfers}
            archived={group.archived}
          />

          <DeletePaymentForm
            groupId={group.id}
            currency={group.currency}
            payments={payments}
            archived={group.archived}
          />
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

            {/* The chip this page's other form holds, carried through a submit of this one: a
                browser sends only the form it submits, so without this, filtering expenses would
                silently drop the activity chip (AC-8). */}
            {activityFilter === 'all' ? null : (
              <input type="hidden" name={ACTIVITY_FILTER_PARAM} value={activityFilter} />
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" className={QUIET_BUTTON}>
                Filter
              </button>
              {filtered ? (
                <Link className="text-accent underline" href={clearExpenseHref}>
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
                  className="flex items-start justify-between gap-3 rounded-token border border-border bg-surface p-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      {/* Truncated with the whole of it in `title`: a long description must not
                          wrap a row into three lines (ui.md). */}
                      <span className="min-w-0 truncate font-medium text-ink" title={expense.description}>
                        {expense.description}
                      </span>
                      <span data-amount className="font-semibold tabular-nums text-ink">
                        {formatMinorUnits(expense.amountMinor, group.currency)}
                      </span>
                    </div>
                    <p className="text-secondary text-ink-muted">
                      {/* What a person calls that day, with the machine-readable one still in the
                          markup for anything that reads `datetime`. */}
                      <time dateTime={expense.date}>{humanDateLabel(expense.date, today)}</time> ·{' '}
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
                  </div>
                  {/* Edit and Delete live behind the row's overflow menu rather than on the row: a
                      list of expenses must not read as a list of buttons, and a delete a thumb's
                      width from an edit link is one somebody presses by accident (ui.md, IAC-7). */}
                  {group.archived ? null : (
                    <ExpenseRowMenu
                      groupId={group.id}
                      expenseId={expense.id}
                      description={expense.description}
                    />
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

        {/* Last, which is where ui.md puts the excerpt in this screen's regions: the ledger first,
            then the record of how it got that way. The failure is the one section failing, so it
            is the one section that says so — with the retry on the URL the reader was already
            looking at, filter and all (TR-11). */}
        <section className="flex flex-col gap-3" aria-labelledby="activity-heading">
          <h2 id="activity-heading" className="text-lg font-semibold">
            Recent activity
          </h2>

          {activityFailed ? (
            <div className="flex flex-col gap-3 rounded-token border border-danger/40 bg-surface p-4">
              <p className="font-medium">We could not load this group&rsquo;s activity</p>
              <p className="text-sm text-muted">
                Everything else on this page is up to date. The feed did not come back this time.
              </p>
              <Link className="text-accent underline" href={retryHref}>
                Retry
              </Link>
            </div>
          ) : (
            <ActivityFeed
              rows={activity}
              filter={activityFilter}
              action={`/groups/${group.id}`}
              preserved={activityPreserved}
              emptyText="No activity yet. Adding an expense, recording a payment or changing the members all show up here."
            />
          )}
        </section>
      </main>
    </AppShell>
  );
}
