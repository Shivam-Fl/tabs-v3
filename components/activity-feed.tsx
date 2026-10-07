import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  ACTIVITY_FILTERS,
  ACTIVITY_FILTER_LABELS,
  ACTIVITY_FILTER_PARAM,
  ACTIVITY_GROUP_PARAM,
  activityHref,
  type ActivityFilter,
  type ActivityRow,
} from '../lib/activity/queries';
import {
  EXPENSE_SNAPSHOT_FIELDS,
  SPLIT_TYPE_LABELS,
  expenseCategoryLabel,
  type ExpenseEditPayload,
  type ExpenseSnapshot,
} from '../lib/expenses/validation';
import { formatBasisPoints, formatMinorUnits } from '../lib/money/format';
import type { PaymentSnapshot } from '../lib/settle/validation';
import { Timestamp } from './timestamp';
import { Avatar, Button, Card, EmptyState } from './ui';

/**
 * The one rendering of an activity feed (TR-10, AC-1, AC-2, AC-9).
 *
 * Both the group page's excerpt and the cross-group page render this, so the two cannot drift
 * into two opinions about what a payment row says or which rows link where.
 *
 * It is a **server component** and holds no state. The chips are a plain GET form and the rows
 * are markup, so the feed works before any JavaScript arrives — which is also why the selected
 * chip lives in the URL rather than in a hook: the filter has to survive a reload, a failed
 * load's retry, and a link somebody copies out of the address bar.
 *
 * Two things it deliberately does not do. It does not own the **error** state: a feed that
 * cannot be read is a failure of the read, which happens before this component is reached, so
 * each page renders its own error card with a retry that keeps the filter in the URL. And it
 * does not claim a **live region**: this is server-rendered markup, and a live region inserted
 * into the document together with the text it carries is announced unreliably. The islands that
 * own mutations announce their own outcomes; a feed that appeared on navigation needs no
 * announcement.
 */

/** A query the chip form must carry through untouched — the group page's expense filter. */
export type PreservedParams = Record<string, string>;

interface ActivityFeedProps {
  rows: ActivityRow[];
  filter: ActivityFilter;
  /** Where the chip row submits: the path of the page the feed is rendered on. */
  action: string;
  /** Params the chip form re-submits, so choosing a chip preserves the other form's filter. */
  preserved?: PreservedParams;
  /** Cross-group feeds name each row's group and link to it. */
  showGroup?: boolean;
  /** What an empty feed with no filter says. The page knows why there is nothing to show. */
  emptyText: string;
  /** The one thing to do about it, for the pages that know one: the cross-group page's links. */
  emptyAction?: ReactNode;
}

export function ActivityFeed({
  rows,
  filter,
  action,
  preserved = {},
  showGroup = false,
  emptyText,
  emptyAction,
}: ActivityFeedProps) {
  return (
    <div className="flex flex-col gap-3">
      <FilterChips filter={filter} action={action} preserved={preserved} />

      {rows.length === 0 ? (
        filter === 'all' ? (
          <EmptyState {...splitEmpty(emptyText)} action={emptyAction} />
        ) : (
          // Deliberately not the EmptyState: a filter that matched nothing is not an empty place
          // with something to start, it is a question the chips above can answer — and the same
          // one-line sentence it has always been is what says so (AC-4).
          <p className="text-secondary text-ink-muted">No events match this filter.</p>
        )
      ) : (
        <ActivityRows rows={rows} showGroup={showGroup} />
      )}
    </div>
  );
}

/**
 * The rows themselves, without the chips (IAC-2).
 *
 * The group page shows a five-row excerpt of the same feed and links out to the full one, so the
 * excerpt renders this rather than a second copy of the row markup — a payment row has to read
 * the same on both screens or the excerpt is a different feed with the same data. Chips stay in
 * `ActivityFeed`: the excerpt is five rows and a link, not a filterable list, and a chip row that
 * filtered a slice would filter five rows out of the newest five.
 */
export function ActivityRows({
  rows,
  showGroup = false,
}: {
  rows: ActivityRow[];
  showGroup?: boolean;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <ActivityRowItem key={row.id} row={row} showGroup={showGroup} />
      ))}
    </ul>
  );
}

/**
 * The page's one sentence about why the feed is empty, set as an empty state.
 *
 * The pages own the copy because they are what knows the reason; the feed owns the shape it is
 * set in, so all three cases look like the same app. The first sentence becomes the title and
 * the rest the body, which is why a page writes its reason in one sentence followed by the
 * consequence. A text with no second sentence repeats itself rather than rendering a blank
 * paragraph under the title.
 */
function splitEmpty(text: string): { title: string; body: string } {
  const end = text.search(/[.!?](\s|$)/);
  if (end === -1) return { title: text, body: text };
  return { title: text.slice(0, end + 1), body: text.slice(end + 1).trim() || text };
}

/**
 * The four chips, as one GET form.
 *
 * A submit button carrying `name=activity` is what puts the chosen value in the query string, so
 * the whole control works with no script. The hidden inputs are the other half: on the group page
 * the expense filter is a *second* GET form on the same route, and a browser sends only the form
 * it submits — without these, choosing a chip would silently clear the member, category and
 * search somebody had set (AC-8).
 *
 * Exported because the cross-group page draws this same row above its failed-load card: the
 * filter is where the reader was when the read failed, so the screen keeps the control that
 * says so instead of the retry being the only thing left of it (AC-4).
 */
export function FilterChips({
  filter,
  action,
  preserved = {},
}: {
  filter: ActivityFilter;
  action: string;
  /** Params the chip form re-submits. The cross-group page has none to carry. */
  preserved?: PreservedParams;
}) {
  return (
    <form method="get" action={action} className="flex flex-wrap gap-2" aria-label="Filter activity">
      {Object.entries(preserved).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {ACTIVITY_FILTERS.map((value) => (
        <Button
          key={value}
          type="submit"
          name={ACTIVITY_FILTER_PARAM}
          value={value}
          variant={value === filter ? 'primary' : 'secondary'}
          // The chips select rather than toggle, so the pressed state is what tells a screen
          // reader which one is showing — the colour alone must not carry it.
          aria-pressed={value === filter}
        >
          {ACTIVITY_FILTER_LABELS[value]}
        </Button>
      ))}
    </form>
  );
}

/**
 * The destination a row links to, or null for a row that is plain text (AC-9).
 *
 * Three rules, in order. A row in an **archived** group goes to the group, never to the editor:
 * an archived group's expenses cannot be edited, and the group page is where its history is
 * readable. A row that still points at a **live expense** goes to that expense's editor. Anything
 * else — an expense-deleted or payment-deleted row, whose link column the foreign key nulled when
 * its subject was removed — has no destination left and says so by being text rather than a link
 * to nothing.
 */
function rowHref(row: ActivityRow): string | null {
  if (row.groupArchived) return `/groups/${row.groupId}`;
  if (row.expenseId) return `/groups/${row.groupId}/expenses/${row.expenseId}/edit`;
  return null;
}

/**
 * What happened, in the words the row's own kind and snapshot support.
 *
 * An expense event's subject is the description as it stood when the event was written, so a
 * renamed expense still reads as it was called at the time — the feed is the record, not a view
 * of the current row.
 */
function actionText(row: ActivityRow): string {
  switch (row.kind) {
    case 'expense-created':
      return `added "${row.subjectName}"`;
    case 'expense-edited':
      return `edited "${row.subjectName}"`;
    case 'expense-deleted':
      return `deleted "${row.subjectName}"`;
    case 'payment-created':
      return `recorded a payment: ${row.subjectName}`;
    case 'payment-deleted':
      return `deleted a payment: ${row.subjectName}`;
    case 'join':
      return 'joined the group';
    case 'claim':
      return `claimed the seat ${row.subjectName}`;
    case 'member-added':
      return `added ${row.subjectName} to the group`;
    case 'leave':
      return 'left the group';
    case 'remove':
      return `removed ${row.subjectName}`;
    // A kind this build does not know still happened, and still renders under All.
    default:
      return 'changed something';
  }
}

/**
 * When it happened (TR-11, IAC-7) is not decided here any more.
 *
 * The row used to print the instant in UTC with the zone spelled out, because a server component
 * cannot know the viewer's zone and labelling the server's clock as the reader's would have been
 * worse. A row's time is now the `Timestamp` island from `components/timestamp.tsx`, which
 * renders a zone-neutral absolute date on the server and replaces it with the viewer's own
 * relative-then-human reading in an effect — so the markup a row ships with carries no zone
 * label at all, and the reader's local time is what they end up looking at (AC-7).
 */

/** Whether a payload is an edit's before/after rather than a payment's snapshot. */
function isEditPayload(
  payload: ExpenseEditPayload | PaymentSnapshot,
): payload is ExpenseEditPayload {
  return 'before' in payload && 'after' in payload;
}

function isPaymentSnapshot(
  payload: ExpenseEditPayload | PaymentSnapshot,
): payload is PaymentSnapshot {
  return 'fromDisplayName' in payload;
}

/**
 * One row: who, what, when — and, where the event carried one, the detail that makes it an audit
 * trail rather than a headline.
 */
function ActivityRowItem({ row, showGroup }: { row: ActivityRow; showGroup: boolean }) {
  const href = rowHref(row);
  const action = actionText(row);
  const payload = row.payload;
  const edit = payload && isEditPayload(payload) ? payload : null;
  const payment = payload && isPaymentSnapshot(payload) ? payload : null;

  return (
    <li className="flex items-start gap-3 rounded-token border border-border bg-surface p-3">
      {/* Keyed by the name, not a membership id: the actor's name is the one identifier every
          row carries — the join is a LEFT JOIN and the row survives its actor's account — so the
          same person keeps the same colour across the excerpt and the cross-group feed (ui.md). */}
      <Avatar name={row.actorName} />

      {/* `min-w-0` lets this column be the width the row gives it, and `break-words` on the lines
          inside it lets a long description or group name break rather than push the row — and the
          page, at 375px — wider than the viewport. The full sentence stays readable: these are
          audit lines, not list rows, so nothing here truncates. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="min-w-0 text-body break-words text-ink">
          <span className="font-medium">{row.actorName}</span>{' '}
          {href ? (
            <Link className="text-accent underline underline-offset-4" href={href}>
              {action}
            </Link>
          ) : (
            action
          )}
        </p>

        <p className="min-w-0 text-secondary break-words text-ink-muted">
          <Timestamp instant={row.createdAt.toISOString()} />
          {showGroup ? (
            <>
              {' · '}
              <Link
                className="text-accent underline underline-offset-4"
                href={`/groups/${row.groupId}`}
              >
                {row.groupName}
              </Link>
              {row.groupArchived ? ' (archived)' : ''}
            </>
          ) : null}
        </p>

        {payment ? (
          // Who paid whom, in words, with the amount in the neutral ink rather than a direction
          // colour: a recorded payment is a fact about the past, not a balance anybody still
          // carries — and the words are what say which way it went (AC-3, ui.md's money rule).
          <p className="flex min-w-0 flex-wrap items-baseline gap-1 text-secondary break-words text-ink-muted">
            <span className="font-medium text-ink">{payment.fromDisplayName}</span>
            <span>paid</span>
            <span className="font-medium text-ink">{payment.toDisplayName}</span>
            <span data-amount className="font-semibold text-ink-muted">
              {formatMinorUnits(payment.amountMinor, row.currency)}
            </span>
          </p>
        ) : null}

        {edit ? <EditDetail payload={edit} currency={row.currency} /> : null}
      </div>
    </li>
  );
}

/**
 * The before and after of an edit, for exactly the fields that changed (TR-10, AC-2).
 *
 * Nothing here decides what changed: the payload was built by comparing the stored expense with
 * the submitted one, and it holds only the fields that moved. This renders whatever is in it —
 * so an edit that changed a note shows a note, and an edit that moved the amount and one split
 * input shows those two, which is what makes the entry evidence rather than summary.
 *
 * A field is rendered when its two halves' **values differ**, not merely when it is present:
 * `splitType` rides beside the inputs it gives a unit to, and printing it would claim a change
 * to the split rule on an edit that made none. A field only one half carries still renders — an
 * absent side never equals a present one — so rows written before the inputs carried their type
 * read exactly as they did.
 */
function EditDetail({ payload, currency }: { payload: ExpenseEditPayload; currency: string }) {
  const changed = EXPENSE_SNAPSHOT_FIELDS.filter(
    (field) =>
      JSON.stringify(payload.before[field]) !== JSON.stringify(payload.after[field]),
  );
  if (changed.length === 0) return null;

  return (
    <dl className="flex flex-col gap-1 text-sm">
      {changed.map((field) => (
        <div key={field} className="flex flex-wrap gap-1">
          <dt className="text-muted">{FIELD_LABELS[field]}</dt>
          {/* The before/after carries descriptions, names and snapshot text verbatim, so it can be
              as long as the longest of them: it breaks inside the row like the lines above it. */}
          <dd className="min-w-0 break-words">
            <span className="text-muted">
              {snapshotValue(field, payload.before, currency)}
            </span>
            <span className="sr-only"> changed to </span>
            <span aria-hidden="true"> → </span>
            <span>{snapshotValue(field, payload.after, currency)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

const FIELD_LABELS: Record<(typeof EXPENSE_SNAPSHOT_FIELDS)[number], string> = {
  description: 'Description',
  amountMinor: 'Amount',
  date: 'Date',
  payers: 'Paid by',
  participants: 'Participants',
  splitType: 'Split type',
  inputs: 'Split inputs',
  category: 'Category',
  note: 'Note',
};

/**
 * One half of one changed field, as text.
 *
 * The array fields are lists of people, and every name comes from the half the value is in rather
 * than from the group — a person who has since been removed from the group must still be named in
 * the before they are recorded in. Each entry carries its own name for that reason.
 */
function snapshotValue(
  field: (typeof EXPENSE_SNAPSHOT_FIELDS)[number],
  half: Partial<ExpenseSnapshot>,
  currency: string,
): string {
  const value = half[field];
  if (value === undefined || value === null) return 'nothing';

  if (field === 'description') return `"${value}"`;
  if (field === 'amountMinor') return formatMinorUnits(value as number, currency);
  if (field === 'date') return String(value);
  if (field === 'category') return expenseCategoryLabel(String(value));
  if (field === 'splitType') {
    return SPLIT_TYPE_LABELS[value as keyof typeof SPLIT_TYPE_LABELS] ?? String(value);
  }
  if (field === 'payers') {
    return (value as ExpenseSnapshot['payers'])
      .map((payer) => `${payer.displayName} ${formatMinorUnits(payer.amountMinor, currency)}`)
      .join(', ');
  }
  if (field === 'participants') {
    return (value as ExpenseSnapshot['participants'])
      .map((line) => `${line.displayName} (${line.included ? 'in' : 'out'})`)
      .join(', ');
  }

  // Split inputs, each named by the name its own row carries — the payload holds only the fields
  // that moved, so an edit that moved a split value alone has no participant list beside it to
  // read a name out of. The value is in the unit the half's own split type names.
  return (value as ExpenseSnapshot['inputs'])
    .map(
      (input) =>
        `${input.displayName} ${inputValueText(half.splitType, input.value, currency)}`,
    )
    .join(', ');
}

/** A stored split input in the unit its split type names, or a dash when the type stores none. */
function inputValueText(
  splitType: ExpenseSnapshot['splitType'] | undefined,
  value: number | null,
  currency: string,
): string {
  if (value === null) return '—';
  if (splitType === 'exact') return formatMinorUnits(value, currency);
  if (splitType === 'percentage') return formatBasisPoints(value);
  return `${value} shares`;
}

/**
 * The cross-group feed's failed-load card, with the chips above it.
 *
 * The chips stay because the filter is where the reader was when the read failed, and the group
 * scope travels with them and with Retry: a failure must not widen "this group's activity" into
 * every group's (AC-4). `groupId` is the confirmed scope when the groups read worked and the raw
 * `?group=` value when it was that read that failed.
 */
export function ActivityFailed({
  filter,
  groupId,
}: {
  filter: ActivityFilter;
  groupId: string | null;
}) {
  return (
    <>
      <FilterChips
        filter={filter}
        action="/activity"
        preserved={groupId === null ? {} : { [ACTIVITY_GROUP_PARAM]: groupId }}
      />
      {/* A card, like every other surface on the page: the failure is one section of the screen
          rather than the screen, and the shared Card is what says so (TR-11). */}
      <Card>
        <section className="flex flex-col gap-3" aria-labelledby="activity-error">
          <h2 id="activity-error" className="text-section font-semibold text-ink">
            We could not load your activity
          </h2>
          <p className="text-body text-ink-muted">
            Nothing has been lost — the feed did not come back this time. Try again.
          </p>
          <Link
            className="text-body text-accent underline underline-offset-4"
            href={activityHref(filter, groupId)}
          >
            Retry
          </Link>
        </section>
      </Card>
    </>
  );
}

/**
 * Rows of the same shape as the feed, for a route's loading state.
 *
 * Exported from here rather than written beside the page it serves so the skeleton and the feed
 * it stands in for cannot drift out of shape — the fallback is only worth having if nothing moves
 * when the data arrives. The busy flag and status line are what the deleted loading.tsx carried and
 * what GroupPageSkeleton keeps, so a screen reader is told something is loading.
 */
export function ActivityFeedSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <p role="status" className="sr-only">
        Loading activity…
      </p>

      {/* A reader with scripting off is left holding this fallback: the resolved feed waits in the
          streamed payload for a client-side swap that never runs, so say what is missing instead
          of pulsing forever (AC-16). */}
      <noscript>
        <p className="rounded-token border border-border bg-surface p-4 text-secondary text-ink shadow-sm">
          Tabs needs JavaScript to load your activity. Turn it on and reload the page.
        </p>
      </noscript>

      <div className="flex flex-wrap gap-2">
        {ACTIVITY_FILTERS.map((value) => (
          <div
            key={value}
            data-skeleton="activity-chip"
            className="h-11 w-24 rounded-token bg-muted/20 motion-safe:animate-pulse"
          />
        ))}
      </div>

      <ul className="flex flex-col gap-2">
        {Array.from({ length: rows }, (_, index) => (
          <li
            key={index}
            data-skeleton="activity-row"
            className="flex flex-col gap-2 rounded-token border border-muted/20 bg-surface p-3"
          >
            <div className="h-5 w-52 rounded-token bg-muted/20 motion-safe:animate-pulse" />
            <div className="h-5 w-36 rounded-token bg-muted/20 motion-safe:animate-pulse" />
          </li>
        ))}
      </ul>
    </div>
  );
}
