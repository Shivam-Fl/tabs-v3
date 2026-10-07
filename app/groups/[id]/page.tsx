import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect, unstable_rethrow } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { ChevronDown, Plus, ReceiptText, SlidersHorizontal } from 'lucide-react';
import { ActivityRows } from '../../../components/activity-feed';
import { AppShell } from '../../../components/app-shell';
import { ExpenseRowMenu } from '../../../components/expense-row-menu';
import { GroupSettingsEntry } from '../../../components/group-page';
import { GroupPageSkeleton } from '../../../components/group-skeletons';
import { DeletePaymentForm, SettleUpForm } from '../../../components/settle-panels';
import { ExpenseDate } from '../../../components/timestamp';
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  INPUT_CLASSES,
  ListRow,
  QUIET_BUTTON,
  buttonClasses,
} from '../../../components/ui';
import {
  ACTIVITY_GROUP_PARAM,
  DEFAULT_ACTIVITY_FILTER,
  listGroupActivity,
  type ActivityRow,
} from '../../../lib/activity/queries';
import { withDb } from '../../../lib/db/client';
import { listExpenses, type ExpenseListRow, type ExpensePayerRow } from '../../../lib/expenses/queries';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_PARAM,
  EXPENSE_MEMBER_PARAM,
  EXPENSE_NOTICE_PARAM,
  EXPENSE_SEARCH_PARAM,
  expenseCategoryLabel,
  expenseFiltersFrom,
  expenseNoticeText,
} from '../../../lib/expenses/validation';
import { guardGroup, type GroupAccess } from '../../../lib/groups/authz';
import { listMembers, type MemberRow } from '../../../lib/groups/queries';
import {
  ARCHIVED_NOTICE,
  ARCHIVED_NOTICE_PARAM,
  GROUP_SECTION_LABELS,
  GROUP_SECTION_PARAM,
  GROUP_SECTIONS,
  GROUP_TYPE_LABELS,
  archivedNoticeText,
  groupSectionFrom,
  type GroupSection,
  type GroupType,
} from '../../../lib/groups/validation';
import { formatMinorUnits } from '../../../lib/money/format';
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

/** Three transfer lines and five rows of each excerpt: enough to answer the question, not a dump. */
const TRANSFER_LINES = 3;
const ACTIVITY_EXCERPT = 5;
const MEMBERS_EXCERPT = 5;

/** The id the filter disclosure's summary and its form are joined by. */
const FILTER_CONTROL_ID = 'expense-filters';

/**
 * What the group page's URL can carry. Spelled out rather than inlined because both halves of the
 * file read it: the page takes the section and the filters off it, and the part that needs the
 * ledger takes the payment notice's pair (ADR-0008).
 */
type GroupSearchParams = {
  section?: string | string[];
  archived?: string;
  expense?: string;
  // A just-recorded or just-deleted payment lands here carrying the outcome and the pair it was
  // about (ADR-0008); the section the reader was on is not part of that URL, which is why the
  // notice's slot is on the summary card rather than inside the Balances panel.
  payment?: string;
  from?: string;
  to?: string;
  member?: string | string[];
  category?: string | string[];
  q?: string | string[];
};

/**
 * The group detail screen, organised rather than stacked (IAC-1 .. IAC-7).
 *
 * It answers one question first — what does this group cost me — and then lets the reader move
 * between the four things that question is made of: the expenses, the balances and the settle-up,
 * the activity, and the members. The move is a **navigation**, not a client-side toggle: each
 * panel is a `?section=` value, so a section can be linked, bookmarked and reloaded, the panels
 * are server-rendered navigations for a reader with JavaScript. A reader without it gets the
 * skeleton and a notice that JavaScript is required (AC-16), not the panels.
 *
 * Every balance on it comes from the one recompute path (TR-9) and every transfer from the one
 * simplification beside it, so the hero number, the member rows, the suggested payments and the
 * members page are four renderings of one arithmetic rather than four opinions.
 *
 * The guard decides everything else. A signed-out visitor is sent to sign in with the way back;
 * a stranger, a malformed id and a group that does not exist all render the same 404, because the
 * guard cannot tell them apart any more than the reader can.
 *
 * Two reads fail differently, on purpose. The **ledger** — expenses, members, balances, payments —
 * is one read: a failure there would leave a summary that disagrees with a list that never
 * arrived, so it takes the whole page down to an error card with a retry. The **activity excerpt**
 * is not part of that arithmetic, so its failure is its own panel's message and the rest of the
 * page stays true.
 *
 * An archive lands here carrying the notice flag, because archiving is what unmounts the settings
 * form that would have shown the confirmation (AC-11). A create, an edit and a delete land here
 * the same way, for the same reason: the row that would have shown the message is the row the
 * change added, replaced or removed.
 *
 * The loading state is a `<Suspense>` fallback **below the guard**, not a `loading.tsx` above it
 * (IAC-6, AC-17). The ordering is the whole design: the guard is awaited first and its refusals
 * therefore own the wire status, while everything that needs the ledger sits inside the boundary
 * and paints `GroupPageSkeleton` until it arrives. A route-level file could not offer both — it is
 * wrapped around this page, so its fallback streamed, and 200 was committed, before `guardGroup`
 * had answered. The page is split into the strip the guard alone can answer and `GroupLedger` for
 * exactly that reason, and nothing about the screen's rendering changed with the split.
 */
export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<GroupSearchParams>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  // The guard decides the wire status, and it decides it here: outside every Suspense boundary on
  // this route, and before the first read. A signed-out request leaves as a redirect, and a
  // stranger, a malformed id and a group that does not exist all leave as the same 404, because
  // the guard cannot tell them apart any more than the reader can.
  //
  // The position of these four lines is the contract (AC-17). A route-level `loading.tsx` could
  // not keep it: Next wraps this page in that file's boundary, so its fallback was flushed — and
  // the response's status committed — before `guardGroup` had answered, and a raw-HTTP client saw
  // 200 for every one of the refusals above. Nothing below this point can stream before the guard
  // has thrown, which is what lets the skeleton be a fallback instead of a file.
  const access = await withDb((handle) => guardGroup(handle.db, id));

  if (access.status === 'unauthenticated') {
    redirect(`/signin?next=${encodeURIComponent(`/groups/${id}`)}`);
  }
  if (access.status === 'not-found') notFound();

  const { group, user } = access;
  const isOwner = access.membership.role === 'owner';
  const section = groupSectionFrom(query[GROUP_SECTION_PARAM]);
  const filters = expenseFiltersFrom(query);
  const groupId = group.id;
  const newExpenseHref = `/groups/${groupId}/expenses/new`;
  // An archive lands here carrying the notice flag, because archiving is what unmounts the settings
  // form that would have shown the confirmation (AC-11); a create, an edit and a delete land here
  // the same way, for the same reason. Neither needs the ledger — they are facts about the URL.
  const justArchived = query[ARCHIVED_NOTICE_PARAM] === ARCHIVED_NOTICE;
  const expenseNotice = expenseNoticeText(query[EXPENSE_NOTICE_PARAM]);

  // The strip above the boundary is everything the guard's own result can answer: where the reader
  // is, what the group is called, whether it is archived, and what the redirect before this one
  // had to say. It paints on the first flush, so the reader never waits on a skeleton for a name
  // the server already has.
  return (
    <AppShell place={group.name} viewer={{ displayName: user.displayName }}>
      {/* The bottom padding is the phone's fixed Add-expense button: content scrolls under it
          rather than ending behind it. */}
      <main className="mx-auto flex w-full max-w-[1024px] flex-1 flex-col gap-5 px-4 pt-5 pb-24 sm:pb-5">
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

        <header className="flex items-center gap-3">
          <Avatar name={group.name} size={40} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="truncate text-page font-semibold text-ink" title={group.name}>
              {group.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{group.currency}</Badge>
              {group.archived ? <Badge>Archived</Badge> : null}
              <span className="text-secondary text-ink-muted">
                {GROUP_TYPE_LABELS[group.type as GroupType] ?? group.type}
              </span>
            </div>
          </div>

          {/* Owner-only, and never for an archived group: rename and archive are the only things
              in there, and an archived group can do neither. */}
          {isOwner && !group.archived ? (
            <GroupSettingsEntry groupId={group.id} groupName={group.name} />
          ) : null}

          {/* The desktop half of the primary action; the phone's is the fixed button at the end
              of this screen. */}
          {group.archived ? null : (
            <Link
              className={buttonClasses('primary', 'md', 'max-sm:hidden')}
              href={newExpenseHref}
            >
              <Plus aria-hidden="true" className="size-5" />
              Add expense
            </Link>
          )}
        </header>

        {group.archived ? (
          <>
            {justArchived ? (
              <p
                role="status"
                aria-live="polite"
                // The sentence re-prints the group's name, so it wraps a maximum-length unbroken
                // one inside the viewport rather than letting it set the document width (AC-1).
                className="rounded-token border border-border bg-surface p-3 text-secondary text-lent break-words"
              >
                {archivedNoticeText(group.name)}
              </p>
            ) : null}
            <p
              role="status"
              className="rounded-token border border-border bg-surface p-3 text-secondary"
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
            className="rounded-token border border-border bg-surface p-3 text-secondary text-lent"
          >
            {expenseNotice}
          </p>
        ) : null}

        {/* Everything from here down needs the ledger, and paints the skeleton while it arrives
            (IAC-6). The boundary sits *below* the guard rather than over the route, so the guard
            keeps the wire status and this strip keeps its first paint — the two things the old
            route-level file could not both have (AC-17). */}
        <Suspense fallback={<GroupPageSkeleton />}>
          <GroupLedger
            access={access}
            query={query}
            filters={filters}
            section={section}
            retryHref={tabHref(groupId, section, filters)}
          />
        </Suspense>
      </main>
    </AppShell>
  );
}

/**
 * Everything the group screen shows that needs the ledger read first.
 *
 * It is a component of its own only because of where it sits: a Suspense boundary can only stand
 * in for something that suspends, so the reads have to be inside the boundary for the fallback to
 * be a fallback rather than decoration. Nothing about the reads themselves changed.
 */
async function GroupLedger({
  access,
  query,
  filters,
  section,
  retryHref,
}: {
  access: Extract<GroupAccess, { status: 'ok' }>;
  query: GroupSearchParams;
  filters: ReturnType<typeof expenseFiltersFrom>;
  section: GroupSection;
  retryHref: string;
}) {
  const groupId = access.group.id;

  let ledger: {
    expenses: ExpenseListRow[];
    members: MemberRow[];
    balances: MemberBalance[];
    payments: PaymentRow[];
  } | null = null;

  try {
    // One read at a time: the embedded backend serves a single connection, so two queries in
    // flight together are a queue pretending to be a race.
    ledger = {
      expenses: await withDb((handle) => listExpenses(handle.db, groupId, filters)),
      members: await withDb((handle) => listMembers(handle.db, groupId)),
      balances: await withDb((handle) => computeNetBalances(handle.db, groupId)),
      payments: await withDb((handle) => listPayments(handle.db, groupId)),
    };
  } catch (error) {
    // Reading the session's cookie is what makes this route dynamic, and Next marks a route
    // dynamic by throwing through it — that throw is control flow, not a failure to report.
    unstable_rethrow(error);
    console.error('[tabs] group: could not load the group', error);
  }

  // The feed is read on its own, and its failure is kept on its own too: the balances, the debts
  // and the expense list on this page are still true, and taking the whole screen down for the
  // one panel that did not come back is a worse answer than saying which one it was. The excerpt
  // needs no filter — it is the newest five of everything — so the read signature is the one the
  // full feed uses, with the default chip.
  let activity: ActivityRow[] = [];
  let activityFailed = false;
  try {
    activity = await withDb((handle) =>
      listGroupActivity(handle.db, groupId, DEFAULT_ACTIVITY_FILTER),
    );
  } catch (error) {
    console.error('[tabs] group activity: could not load the feed', error);
    activityFailed = true;
  }

  if (ledger === null) return <GroupFailure retryHref={retryHref} />;

  // The simplification is arithmetic on the numbers above, not another read: it is the same call
  // the home screen makes, so "Cy pays you 100" here and "Cy owes you 100" there cannot diverge.
  // It is computed once here rather than at the call below because the payment notice needs it too.
  const transfers = simplifyDebts(ledger.balances);

  // What a just-recorded or just-deleted payment has to say (AC-6, ADR-0008). The flag rides the
  // redirect's query, and so does the pair it was about — because the sentence names what is still
  // owed *between those two*, and that is a fact about the balances, not about the form that
  // submitted. Both ids have to be seats of this group, in the same read the balances came from:
  // anything else renders nothing at all, exactly as a forged flag does, so a hand-written URL
  // cannot put a sentence about two strangers on somebody's screen. The remainder is recomputed
  // here through the same simplification the suggested payments use, so the notice and the row
  // under it can never disagree about who owes whom.
  const seatIds = new Set(ledger.balances.map((balance) => balance.membershipId));
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
      expenses={ledger.expenses}
      members={ledger.members}
      balances={ledger.balances}
      transfers={transfers}
      payments={ledger.payments}
      filters={filters}
      section={section}
      activity={activity}
      activityFailed={activityFailed}
      retryHref={retryHref}
      paymentNotice={paymentNotice}
    />
  );
}

/**
 * What a reader sees when the ledger could not be read (IAC-6).
 *
 * Deliberately not the screen with empty lists in it: an empty group and an unreadable one look
 * identical if the page renders its zero states on failure, and the reader would be told they owe
 * nobody when the truth is that nobody answered. One sentence, one way out, and the retry lands
 * on the section and the filters they were already looking at.
 *
 * It fills the body rather than the whole window: the breadcrumb and the header above it came from
 * the guard, which answered, and they are still true — the thing that did not come back is the
 * ledger. Its heading is an `h2` for the same reason, since the group's own name is the page's one
 * `h1` and a second one would make the error the page's title.
 */
function GroupFailure({ retryHref }: { retryHref: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center">
      <section
        aria-labelledby="group-error"
        className="flex flex-col items-start gap-3 rounded-token border border-danger/40 bg-surface p-4 shadow-sm"
      >
        <h2 id="group-error" className="text-page font-semibold text-ink">
          We could not load this group
        </h2>
        <p className="text-body text-ink-muted">
          Nothing has been lost — the group did not come back this time. Try again.
        </p>
        <Link className={buttonClasses('primary', 'md')} href={retryHref}>
          Retry
        </Link>
      </section>
    </div>
  );
}

function GroupDetail({
  access,
  expenses,
  members,
  balances,
  transfers,
  payments,
  filters,
  section,
  activity,
  activityFailed,
  retryHref,
  paymentNotice,
}: {
  access: Extract<GroupAccess, { status: 'ok' }>;
  expenses: ExpenseListRow[];
  members: MemberRow[];
  balances: MemberBalance[];
  transfers: Transfer[];
  payments: PaymentRow[];
  filters: ReturnType<typeof expenseFiltersFrom>;
  section: GroupSection;
  activity: ActivityRow[];
  activityFailed: boolean;
  retryHref: string;
  paymentNotice: string | null;
}) {
  const { group, membership } = access;
  const filtered = filters.memberId !== null || filters.category !== null || filters.search !== null;
  const newExpenseHref = `/groups/${group.id}/expenses/new`;

  // Every current member is on the balances card even at zero — a row that vanished would read as
  // somebody missing — while a departed seat (ADR-0007) is only worth a row when it still holds a
  // balance: at zero it is a name the group can do nothing about.
  const currentIds = new Set(members.map((member) => member.id));
  const shown = balances.filter(
    (balance) => currentIds.has(balance.membershipId) || balance.balanceMinor !== 0,
  );

  const ownMinor =
    balances.find((balance) => balance.membershipId === membership.id)?.balanceMinor ?? 0;
  const settled = transfers.length === 0;
  // The settled case says what the *number* means and leaves the group-wide sentence to the banner
  // below it: "Everyone is settled up — nobody owes anybody" is the banner's line, and printing it
  // here too stacked the same sentence twice under the hero.
  const heroNote = settled
    ? 'You are settled up here.'
    : ownMinor > 0
      ? 'You are owed in this group.'
      : ownMinor < 0
        ? 'You owe in this group.'
        : 'You are settled up here — the others still owe each other.';

  const excerpt = activity.slice(0, ACTIVITY_EXCERPT);
  const balanceOf = new Map(balances.map((balance) => [balance.membershipId, balance.balanceMinor]));

  // The shell — breadcrumb, header, notices — is rendered by the page above the Suspense boundary,
  // because the guard's own result already answers all of it. This renders the region that waits on
  // the ledger, as a fragment rather than a second `<main>`: one main landmark per screen, and the
  // page owns the one this fills.
  return (
    <>
      <Card>
          <div className="flex flex-col gap-1">
            <h2 className="text-caption font-medium tracking-wide text-ink-muted uppercase">
              Your balance
            </h2>
            <p
              data-amount
              className={`text-hero font-semibold tabular-nums ${
                ownMinor > 0 ? 'text-lent' : ownMinor < 0 ? 'text-owed' : 'text-ink'
              }`}
            >
              {formatMinorUnits(ownMinor, group.currency)}
            </p>
            <p className="text-secondary text-ink-muted">{heroNote}</p>
          </div>

          {/* This card's own slot, and the only one a payment notice is ever rendered in (AC-6):
              recording or deleting a payment redirects to this page with the outcome and the pair
              it was about, and the row that held the form — with the region that would have
              announced it — is gone by then. The expense notice above has its own slot for the same
              reason, and neither borrows the other's. It sits on the summary card rather than in
              the Balances panel because the redirect names no section: the reader lands on the
              default tab and must still be told what just happened. */}
          {paymentNotice ? (
            <p
              role="status"
              aria-live="polite"
              className="rounded-token border border-border bg-surface p-3 text-secondary text-lent"
            >
              {paymentNotice}
            </p>
          ) : null}

          {transfers.length === 0 ? (
            // Zero is neutral and says so in words: a settled group must never read as a debt.
            <p className="rounded-token bg-lent-tint p-3 text-secondary text-lent">
              Everyone is settled up — nobody owes anybody.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {/* Endpoints and amount, the identity the settle panel also keys its rows by — spelled
                  out here rather than imported, because the panel is a client module and a server
                  component cannot call into one. These lines carry no state, so the key only has to
                  be stable within this list. */}
              {transfers.slice(0, TRANSFER_LINES).map((transfer) => (
                <li
                  key={`${transfer.fromMembershipId}:${transfer.toMembershipId}:${transfer.amountMinor}`}
                  className="flex flex-wrap items-baseline justify-between gap-2"
                >
                  {/* min-w-0: overflow-wrap cannot lower a flex item's min-content floor. */}
                  <span className="flex min-w-0 flex-wrap items-baseline gap-2">
                    <span
                      className={`min-w-0 break-words text-body ${directionTone(transfer, membership.id)}`}
                    >
                      {transferWords(transfer, membership.id)}
                    </span>
                    {/* The same label the Balances rows carry (ADR-0007): a departed seat can still
                        be owed or owe, and a line that names one should say it is gone. */}
                    {currentIds.has(transfer.fromMembershipId) &&
                    currentIds.has(transfer.toMembershipId) ? null : (
                      <span className="shrink-0">
                        <Badge>No longer in the group</Badge>
                      </span>
                    )}
                  </span>
                  <span
                    data-amount
                    className={`ml-auto font-semibold tabular-nums ${directionTone(transfer, membership.id)}`}
                  >
                    {formatMinorUnits(transfer.amountMinor, group.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {transfers.length > TRANSFER_LINES ? (
            <Link
              className="text-secondary font-medium text-accent underline-offset-4 hover:underline"
              href={tabHref(group.id, 'balances', filters)}
            >
              +{transfers.length - TRANSFER_LINES} more in Balances and settle up
            </Link>
          ) : null}

          <div className="flex flex-wrap gap-3">
            {group.archived ? null : (
              <Link className={buttonClasses('primary', 'md')} href={newExpenseHref}>
                Add expense
              </Link>
            )}
            <Link
              className={buttonClasses('secondary', 'md')}
              href={tabHref(group.id, 'balances', filters)}
            >
              Settle up
            </Link>
          </div>
        </Card>

        {/* The four panels, one of them in the document at a time. A nav of links rather than a
            client-side toggle: the section is in the URL, so it survives a reload, a shared link
            and the reader's own Back button. */}
        <nav aria-label="Group sections">
          <ul className="flex gap-1 overflow-x-auto">
            {GROUP_SECTIONS.map((value) => {
              const current = value === section;
              return (
                <li key={value} className="shrink-0">
                  <Link
                    href={tabHref(group.id, value, filters)}
                    aria-current={current ? 'page' : undefined}
                    className={`inline-flex min-h-11 items-center rounded-token px-3 text-secondary font-medium ${
                      current
                        ? 'bg-accent-tint text-accent'
                        : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
                    }`}
                  >
                    {GROUP_SECTION_LABELS[value]}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {section === 'expenses' ? (
          <Panel id="panel-expenses" label={GROUP_SECTION_LABELS.expenses}>
            <FilterDisclosure summary={filterSummary(filters, members)}>
              {/* A plain GET form: the filter is in the URL, so the page someone is looking at is
                  the page they can send to somebody else — and it works before any JavaScript
                  arrives, which is also what lets the disclosure be built out of a checkbox
                  rather than a hook. */}
              <form
                method="get"
                action={`/groups/${group.id}`}
                className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
              >
                <input type="hidden" name={GROUP_SECTION_PARAM} value="expenses" />

                <div className="flex flex-col gap-1 sm:w-48">
                  <label className="text-secondary font-medium text-ink" htmlFor="expense-filter-member">
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
                  <label
                    className="text-secondary font-medium text-ink"
                    htmlFor="expense-filter-category"
                  >
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
                  <label
                    className="text-secondary font-medium text-ink"
                    htmlFor="expense-filter-search"
                  >
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

                <div className="flex flex-wrap items-center gap-3">
                  <button type="submit" className={QUIET_BUTTON}>
                    Filter
                  </button>
                  {filtered ? (
                    <Link
                      className="font-medium text-accent underline-offset-4 hover:underline"
                      href={tabHref(group.id, 'expenses', {
                        memberId: null,
                        category: null,
                        search: null,
                      })}
                    >
                      Clear
                    </Link>
                  ) : null}
                </div>
              </form>
            </FilterDisclosure>

            {expenses.length === 0 ? (
              filtered ? (
                <p className="text-secondary text-ink-muted">No expenses match these filters.</p>
              ) : (
                <EmptyState
                  icon={<ReceiptText className="size-5" />}
                  title="No expenses yet"
                  body={
                    members.length <= 1
                      ? 'Add what you paid for and the balances will follow. You can also add people to the group and split with them.'
                      : 'Add the first expense, and the balances will follow.'
                  }
                  action={
                    group.archived ? undefined : (
                      <Link className={buttonClasses('primary', 'md')} href={newExpenseHref}>
                        Add expense
                      </Link>
                    )
                  }
                />
              )
            ) : (
              <ul className="flex flex-col gap-2">
                {expenses.map((expense) => (
                  <li key={expense.id}>
                    <ListRow
                      leading={
                        <Avatar
                          name={expense.payers[0]?.displayName ?? ''}
                          memberId={expense.payers[0]?.membershipId}
                        />
                      }
                      title={expense.description}
                      meta={
                        <>
                          <ExpenseDate date={expense.date} /> ·{' '}
                          {expenseCategoryLabel(expense.category)} ·{' '}
                          {payerWords(expense.payers, membership.id)}
                        </>
                      }
                      trailing={
                        <span className="flex items-center gap-2">
                          {/* In ink, with the direction in the payer words beside it: an expense
                              row is a fact about what happened, not a claim about who owes whom,
                              and the totals that are claims live on the balances panel. */}
                          <span data-amount className="font-semibold tabular-nums text-ink">
                            {formatMinorUnits(expense.amountMinor, group.currency)}
                          </span>
                          {group.archived ? null : (
                            <ExpenseRowMenu
                              groupId={group.id}
                              expenseId={expense.id}
                              description={expense.description}
                            />
                          )}
                        </span>
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}

        {section === 'balances' ? (
          <Panel id="panel-balances" label={GROUP_SECTION_LABELS.balances}>
            <Card title="Who owes what">
              <ul className="flex flex-col gap-2">
                {shown.map((balance) => (
                  <li key={balance.membershipId}>
                    <ListRow
                      leading={<Avatar name={balance.displayName} memberId={balance.membershipId} />}
                      title={
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate">{balance.displayName}</span>
                          {/* ADR-0007: a seat whose membership row is gone still owns its ledger
                              rows, and its net is still true — so it renders with the name it was
                              last recorded under, labelled for what it is. */}
                          {currentIds.has(balance.membershipId) ? null : (
                            <span className="shrink-0">
                              <Badge>No longer in the group</Badge>
                            </span>
                          )}
                        </span>
                      }
                      trailing={
                        <span className="flex flex-col items-end">
                          <span className="text-caption text-ink-muted">
                            {balanceWords(balance.balanceMinor, balance.membershipId === membership.id)}
                          </span>
                          <span
                            data-amount
                            className={`font-semibold tabular-nums ${balanceTone(balance.balanceMinor)}`}
                          >
                            {formatMinorUnits(Math.abs(balance.balanceMinor), group.currency)}
                          </span>
                        </span>
                      }
                    />
                  </li>
                ))}
              </ul>
            </Card>

            <Card title="Settle up">
              <p className="text-secondary text-ink-muted">
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
            </Card>
          </Panel>
        ) : null}

        {section === 'activity' ? (
          <Panel id="panel-activity" label={GROUP_SECTION_LABELS.activity}>
            {activityFailed ? (
              <div className="flex flex-col items-start gap-3 rounded-token border border-danger/40 bg-surface p-4 shadow-sm">
                <p className="font-medium text-ink">We could not load this group&rsquo;s activity</p>
                <p className="text-secondary text-ink-muted">
                  Everything else on this page is up to date. The feed did not come back this
                  time.
                </p>
                <Link className={buttonClasses('secondary', 'sm')} href={retryHref}>
                  Retry
                </Link>
              </div>
            ) : (
              <>
                {excerpt.length === 0 ? (
                  <p className="text-secondary text-ink-muted">
                    No activity yet. Adding an expense, recording a payment or changing the
                    members all show up here.
                  </p>
                ) : (
                  // The same rows the full feed renders, from the same component (AC-13): an
                  // excerpt that drew its own markup would be a second opinion about the same
                  // events. No chips here — five newest rows are not a filterable list, and the
                  // full feed is one link away.
                  <ActivityRows rows={excerpt} />
                )}
                <Link
                  className="text-secondary font-medium text-accent underline-offset-4 hover:underline"
                  href={`/activity?${ACTIVITY_GROUP_PARAM}=${group.id}`}
                >
                  View all activity
                </Link>
              </>
            )}
          </Panel>
        ) : null}

        {section === 'members' ? (
          <Panel id="panel-members" label={GROUP_SECTION_LABELS.members}>
            <ul className="flex flex-col gap-2">
              {members.slice(0, MEMBERS_EXCERPT).map((member) => (
                <li key={member.id}>
                  <ListRow
                    leading={<Avatar name={member.displayName} memberId={member.id} />}
                    title={member.displayName}
                    meta={memberBadges(member, membership.id)}
                    trailing={
                      <span className="flex flex-col items-end">
                        <span className="text-caption text-ink-muted">
                          {balanceWords(
                            balanceOf.get(member.id) ?? 0,
                            member.id === membership.id,
                          )}
                        </span>
                        <span
                          data-amount
                          className={`font-semibold tabular-nums ${balanceTone(balanceOf.get(member.id) ?? 0)}`}
                        >
                          {formatMinorUnits(Math.abs(balanceOf.get(member.id) ?? 0), group.currency)}
                        </span>
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
            <Link
              className="text-secondary font-medium text-accent underline-offset-4 hover:underline"
              href={`/groups/${group.id}/members`}
            >
              View all members
            </Link>
          </Panel>
        ) : null}

      {/* The phone's half of the primary action: fixed where a thumb already is, and out of the
          flow so it never covers the row being read (the page's main element carries its height). */}
      {group.archived ? null : (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface p-4 sm:hidden">
          <Link className={buttonClasses('primary', 'md', 'w-full')} href={newExpenseHref}>
            <Plus aria-hidden="true" className="size-5" />
            Add expense
          </Link>
        </div>
      )}
    </>
  );
}

/**
 * One section of the group screen.
 *
 * The heading is `sr-only`: the tab the reader just pressed already names the panel, and printing
 * the name a second time would be the screen telling them what they did. The heading is still
 * there for the reason every region has one — anything navigating by heading or landmark can find
 * the four sections, and there is exactly one `h1` on the page, on the group's name.
 */
function Panel({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="sr-only">
        {label}
      </h2>
      {children}
    </section>
  );
}

/**
 * The search and filter form, folded away until it is asked for on a phone (IAC-3).
 *
 * A checkbox and a label rather than `<details>` or a hook, and that is the whole point: which
 * state the disclosure starts in depends on the width of the screen, and the only thing that
 * knows the width at first paint is the stylesheet. A `<details>` server-rendered open would
 * flash open and then collapse on every phone; server-rendered closed would leave desktop readers
 * folding it out until hydration. A checkbox costs one hidden input — focusable on a phone, with
 * its focus ring drawn on the label — and gets both widths right before any JavaScript runs.
 *
 * The label and the checkbox are both `sm:hidden`, so on desktop the form is simply there with no
 * summary above it and no invisible stop in the tab order, and the whole thing degrades to a plain
 * GET form when scripting is off. Only the chevron rotates (the `chevron` class), not the sliders
 * glyph beside it.
 */
function FilterDisclosure({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-token border border-border bg-surface p-3 shadow-sm sm:p-4">
      <input id={FILTER_CONTROL_ID} type="checkbox" className="peer sr-only sm:hidden" />
      <label
        htmlFor={FILTER_CONTROL_ID}
        className="flex min-h-11 cursor-pointer items-center gap-2 font-medium text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-checked:[&_.chevron]:rotate-180 sm:hidden"
      >
        <SlidersHorizontal aria-hidden="true" className="size-5 shrink-0 text-ink-muted" />
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        <ChevronDown aria-hidden="true" className="chevron size-5 shrink-0 text-ink-muted" />
      </label>
      <div className="hidden pt-3 peer-checked:block sm:block sm:pt-0">{children}</div>
    </div>
  );
}

/**
 * The list of every parameter a tab link carries.
 *
 * The section is the one thing that changes; the expense filter rides along untouched, so
 * switching to the balances and back does not silently clear what somebody searched for (AC-3).
 * It is also the retry URL for a failed ledger read, which is why the section is written out
 * explicitly rather than left to the default.
 */
function tabHref(
  groupId: string,
  section: GroupSection,
  filters: ReturnType<typeof expenseFiltersFrom>,
): string {
  const params = new URLSearchParams();
  if (filters.memberId) params.set(EXPENSE_MEMBER_PARAM, filters.memberId);
  if (filters.category) params.set(EXPENSE_CATEGORY_PARAM, filters.category);
  if (filters.search) params.set(EXPENSE_SEARCH_PARAM, filters.search);
  params.set(GROUP_SECTION_PARAM, section);

  return `/groups/${groupId}?${params.toString()}`;
}

/**
 * What the folded filter says about itself while it is folded.
 *
 * A collapsed disclosure with filters still applied is the one state where a reader could believe
 * they are looking at everything, so the active ones are named on the summary that hides them.
 */
function filterSummary(
  filters: ReturnType<typeof expenseFiltersFrom>,
  members: MemberRow[],
): string {
  const parts: string[] = [];

  if (filters.memberId) {
    const name = members.find((member) => member.id === filters.memberId)?.displayName;
    parts.push(name ?? 'One member');
  }
  if (filters.category) parts.push(expenseCategoryLabel(filters.category));
  if (filters.search) parts.push(`“${filters.search}”`);

  return parts.length === 0 ? 'Search and filters' : `Filters: ${parts.join(' · ')}`;
}

/** "You paid" / "Bo paid" / "You and Bo paid" — who put the money in, never a direction. */
function payerWords(payers: ExpensePayerRow[], viewerMembershipId: string): string {
  const names = payers.map((payer) =>
    payer.membershipId === viewerMembershipId ? 'You' : payer.displayName,
  );
  if (names.length === 0) return 'Nobody paid';
  if (names.length === 1) return `${names[0]} paid`;

  const last = names[names.length - 1];
  return `${names.slice(0, -1).join(', ')} and ${last} paid`;
}

/** "You owe Bo" / "Bo owes you" / "Bo owes Cy" — the transfer, in words, in the reader's terms. */
function transferWords(transfer: Transfer, viewerMembershipId: string): string {
  const from =
    transfer.fromMembershipId === viewerMembershipId ? 'You' : transfer.fromDisplayName;
  const to = transfer.toMembershipId === viewerMembershipId ? 'you' : transfer.toDisplayName;
  return `${from} ${transfer.fromMembershipId === viewerMembershipId ? 'owe' : 'owes'} ${to}`;
}

/** Colour only where the reader has a side in it, so a stranger's transfer is never red. */
function directionTone(transfer: Transfer, viewerMembershipId: string): string {
  if (transfer.fromMembershipId === viewerMembershipId) return 'text-owed';
  if (transfer.toMembershipId === viewerMembershipId) return 'text-lent';
  return 'text-ink';
}

/** The direction of one net, in words — the colour beside it is never the only carrier. */
function balanceWords(balanceMinor: number, isViewer: boolean): string {
  if (balanceMinor === 0) return 'Settled up';
  if (isViewer) return balanceMinor > 0 ? 'You are owed' : 'You owe';
  return balanceMinor > 0 ? 'is owed' : 'owes';
}

/** Zero stays in ink: a settled row is not a debt and must not wear a debt's colour. */
function balanceTone(balanceMinor: number): string {
  if (balanceMinor > 0) return 'text-lent';
  if (balanceMinor < 0) return 'text-owed';
  return 'text-ink';
}

/** The pills that say what a member's seat is, in the words the members page already uses. */
function memberBadges(member: MemberRow, viewerMembershipId: string): ReactNode {
  const badges: { key: string; label: string; tone?: 'accent' }[] = [];

  if (member.id === viewerMembershipId) badges.push({ key: 'you', label: 'You', tone: 'accent' });
  if (member.role === 'owner') badges.push({ key: 'owner', label: 'Owner' });
  if (member.userId === null) badges.push({ key: 'placeholder', label: 'Placeholder' });

  if (badges.length === 0) return undefined;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {badges.map((badge) => (
        <Badge key={badge.key} tone={badge.tone}>
          {badge.label}
        </Badge>
      ))}
    </span>
  );
}
