import Link from 'next/link';
import {
  ACTIVITY_FILTERS,
  ACTIVITY_FILTER_LABELS,
  ACTIVITY_FILTER_PARAM,
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
import { PRIMARY_BUTTON, QUIET_BUTTON } from './ui';

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
}

export function ActivityFeed({
  rows,
  filter,
  action,
  preserved = {},
  showGroup = false,
  emptyText,
}: ActivityFeedProps) {
  return (
    <div className="flex flex-col gap-3">
      <FilterChips filter={filter} action={action} preserved={preserved} />

      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          {filter === 'all' ? emptyText : 'No events match this filter.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <ActivityRowItem key={row.id} row={row} showGroup={showGroup} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The four chips, as one GET form.
 *
 * A submit button carrying `name=activity` is what puts the chosen value in the query string, so
 * the whole control works with no script. The hidden inputs are the other half: on the group page
 * the expense filter is a *second* GET form on the same route, and a browser sends only the form
 * it submits — without these, choosing a chip would silently clear the member, category and
 * search somebody had set (AC-8).
 */
function FilterChips({
  filter,
  action,
  preserved,
}: {
  filter: ActivityFilter;
  action: string;
  preserved: PreservedParams;
}) {
  return (
    <form method="get" action={action} className="flex flex-wrap gap-2" aria-label="Filter activity">
      {Object.entries(preserved).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {ACTIVITY_FILTERS.map((value) => (
        <button
          key={value}
          type="submit"
          name={ACTIVITY_FILTER_PARAM}
          value={value}
          // The chips select rather than toggle, so the pressed state is what tells a screen
          // reader which one is showing — the colour alone must not carry it.
          aria-pressed={value === filter}
          className={value === filter ? PRIMARY_BUTTON : QUIET_BUTTON}
        >
          {ACTIVITY_FILTER_LABELS[value]}
        </button>
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
 * When it happened (TR-11).
 *
 * Rendered in **UTC and labelled as such**. The invariant is that timestamps are stored in UTC
 * and shown in the viewer's time zone, and a server component cannot know the viewer's zone — the
 * agent that renders this runs wherever the app runs. Rather than silently printing the server's
 * clock and calling it the viewer's, this prints the one zone both the writer and the reader
 * agree on and says which it is. Lifting it means a client-side timestamp island, which the work
 * order rules out for this slice.
 */
const TIMESTAMP_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

function timestampText(value: Date): string {
  return `${TIMESTAMP_FORMAT.format(value)} UTC`;
}

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
    <li className="flex flex-col gap-1 rounded-token border border-muted/20 bg-surface p-3">
      <p className="text-sm">
        <span className="font-medium">{row.actorName}</span>{' '}
        {href ? (
          <Link className="text-accent underline" href={href}>
            {action}
          </Link>
        ) : (
          action
        )}
      </p>

      <p className="text-sm text-muted">
        <time dateTime={row.createdAt.toISOString()}>{timestampText(row.createdAt)}</time>
        {showGroup ? (
          <>
            {' · '}
            <Link className="text-accent underline" href={`/groups/${row.groupId}`}>
              {row.groupName}
            </Link>
            {row.groupArchived ? ' (archived)' : ''}
          </>
        ) : null}
      </p>

      {payment ? (
        <p data-amount className="text-sm">
          {formatMinorUnits(payment.amountMinor, row.currency)}
        </p>
      ) : null}

      {edit ? <EditDetail payload={edit} currency={row.currency} /> : null}
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
 */
function EditDetail({ payload, currency }: { payload: ExpenseEditPayload; currency: string }) {
  const changed = EXPENSE_SNAPSHOT_FIELDS.filter(
    (field) => field in payload.before || field in payload.after,
  );
  if (changed.length === 0) return null;

  return (
    <dl className="flex flex-col gap-1 text-sm">
      {changed.map((field) => (
        <div key={field} className="flex flex-wrap gap-1">
          <dt className="text-muted">{FIELD_LABELS[field]}</dt>
          <dd>
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
 * Rows of the same shape as the feed, for a route's loading state.
 *
 * Exported from here rather than written beside the page it serves so the skeleton and the feed
 * it stands in for cannot drift out of shape — the fallback is only worth having if nothing moves
 * when the data arrives.
 */
export function ActivityFeedSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
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
