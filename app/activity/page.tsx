import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { redirect } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { AppShell } from '../../components/app-shell';
import { ActivityFailed, ActivityFeed, ActivityFeedSkeleton } from '../../components/activity-feed';
import { Skeleton } from '../../components/ui';
import {
  ACTIVITY_FILTER_PARAM,
  ACTIVITY_GROUP_PARAM,
  activityFilterFrom,
  activityHref,
  listActivityGroups,
  listUserActivity,
  failedFeedScope,
  rawGroupScope,
  type ActivityFilter,
  type ActivityGroup,
  type ActivityRow,
} from '../../lib/activity/queries';
import { getSessionUser } from '../../lib/auth/session';
import { withDb } from '../../lib/db/client';

export const metadata: Metadata = { title: 'Activity · Tabs' };

/**
 * The cross-group feed (TR-10, AC-1, AC-5): what changed across every group the viewer is in.
 *
 * The scope is the caller's own memberships and nothing else — a group somebody is not in
 * contributes no rows, and there is no group id in the URL that could widen it. Signed out is
 * the sign-in page carrying the way back, which is what every other authenticated screen here
 * does.
 *
 * Archived groups stay in scope. Archiving stops a group being written to; it does not remove it
 * from the record, and the group page it belongs to is still readable — so a feed that dropped
 * its history would disagree with the screen the history links to.
 *
 * The filter lives in the URL, so a chosen chip survives a reload, a shared link and the retry
 * after a failed load. An unknown value falls back to every row with the chips still rendered,
 * because a bookmark somebody hand-edited should show them a feed rather than an error.
 *
 * `?group=` narrows the same feed to one group (IAC-2), which is where the group page's five-row
 * excerpt sends somebody who wants the whole story. It is applied here, on rows the caller could
 * already read — the scope is a filter, not an authorization, and it is resolved against the
 * caller's own groups, so an id that is not theirs simply does not narrow anything. The header
 * says which group is showing and offers the way back to every group, because a feed that is
 * quietly missing rows is worse than one that says what it is showing.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ activity?: string | string[]; group?: string | string[] }>;
}) {
  const query = await searchParams;
  const filter = activityFilterFrom(query[ACTIVITY_FILTER_PARAM]);

  // The guard decides the wire status, and it decides it here: outside the Suspense boundary
  // below and before the first read. A route-level `loading.tsx` sits above this and would commit
  // a 200 and a skeleton before the redirect ran, so this route has none.
  const viewer = await withDb((handle) => getSessionUser(handle.db));
  if (!viewer) {
    redirect(`/signin?next=${encodeURIComponent('/activity')}`);
  }

  // Reserves the "Showing X only" line only when the URL holds a group id, so an unscoped feed
  // does not gain a gap when the data lands. It holds the loaded line's position and height.
  const fallback = (
    <>
      {rawGroupScope(query[ACTIVITY_GROUP_PARAM]) === null ? null : <Skeleton className="-mt-4 h-5 w-64" />}
      <ActivityFeedSkeleton />
    </>
  );

  return (
    <AppShell place="Activity" viewer={{ displayName: viewer.displayName }}>
      <main className="mx-auto flex w-full max-w-[1024px] flex-1 flex-col gap-5 px-4 py-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-page font-semibold text-ink">Activity</h1>
          {/* The feed is every group at once, so its way back is Home — where the groups are. */}
          <Link
            className="inline-flex items-center gap-2 text-secondary text-accent underline-offset-4 hover:underline"
            href="/"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to Home
          </Link>
        </header>

        <Suspense fallback={fallback}>
          <ActivityContent
            viewerId={viewer.id}
            filter={filter}
            rawGroup={query[ACTIVITY_GROUP_PARAM]}
          />
        </Suspense>
      </main>
    </AppShell>
  );
}

/**
 * Everything the feed screen shows that needs a read first: the scope line, the feed, and the
 * failed and empty states. A component of its own only because a Suspense boundary can stand in
 * for something that suspends — the reads have to be inside it for the fallback to be one.
 */
async function ActivityContent({
  viewerId,
  filter,
  rawGroup,
}: {
  viewerId: string;
  filter: ActivityFilter;
  rawGroup: string | string[] | undefined;
}) {
  // One read at a time: the embedded backend serves a single connection, so two queries in
  // flight together are a queue pretending to be a race.
  let groups: ActivityGroup[] = [];
  let rows: ActivityRow[] = [];
  let failed = false;
  let groupsLoaded = false;

  try {
    groups = await withDb((handle) => listActivityGroups(handle.db, viewerId));
    groupsLoaded = true;
    rows = await withDb((handle) => listUserActivity(handle.db, viewerId, filter));
  } catch (error) {
    // Both reads are the same failure to the reader: the feed did not load. The technical
    // detail goes to the server log and the screen gets a message and one way out, carrying
    // the filter so the retry lands on the feed they were looking at.
    console.error('[tabs] activity: could not load the feed', error);
    failed = true;
  }

  // The scope only exists if it names a group the caller holds a seat in; anything else — a stale
  // link, a typo, another group's id — shows the whole feed, exactly as an unknown chip does.
  const scopeId = rawGroupScope(rawGroup);
  const scoped = groups.find((group) => group.id === scopeId) ?? null;
  const shown = scoped === null ? rows : rows.filter((row) => row.groupId === scoped.id);

  if (failed) {
    // The raw id is carried only when the groups read could not confirm anything (it did not
    // complete); a completed read drops an id that is not one of the viewer's groups.
    return (
      <ActivityFailed filter={filter} groupId={failedFeedScope(groupsLoaded, groups, rawGroup)} />
    );
  }

  // Built once: the empty state's sentence and its action are one decision about one case.
  const empty = emptyFeed(groups, scoped);

  return (
    <>
      {scoped === null ? null : (
        // -mt-4 undoes main's 24px gap down to the 8px this line had under the title when it lived
        // in the header; min-h-5 reserves the 24px the fallback Skeleton holds.
        <p className="-mt-4 min-h-5 text-secondary text-ink-muted">
          Showing{' '}
          <Link
            className="font-medium text-accent underline-offset-4 hover:underline"
            href={`/groups/${scoped.id}`}
          >
            {scoped.name}
          </Link>{' '}
          only.{' '}
          <Link
            className="font-medium text-accent underline-offset-4 hover:underline"
            href={activityHref(filter, null)}
          >
            Show every group
          </Link>
        </p>
      )}

      <ActivityFeed
        rows={shown}
        filter={filter}
        action="/activity"
        // A chip submits only its own form, so without this the scope would be dropped by the
        // one control on the page that is meant to narrow the feed further.
        preserved={scoped === null ? {} : { [ACTIVITY_GROUP_PARAM]: scoped.id }}
        showGroup
        emptyText={empty.text}
        emptyAction={empty.action}
      />
    </>
  );
}

/** The shared look of the two links an empty feed can offer. */
const FEED_LINK = 'text-body text-accent underline underline-offset-4';

/**
 * Why the feed is empty, in the cases that would otherwise read identically (TR-11).
 *
 * "Nothing has happened yet" and "you are not in a group" call for different next steps, and a
 * viewer whose every group is archived is looking at a fourth thing again: history that exists
 * but can no longer grow. A scoped feed has its own answer, because the reader is looking at one
 * group and the reason there is nothing in it is about that group and not about the others. Each
 * case therefore gets its own sentence *and* its own action — the one thing that actually helps
 * from there, rather than one shared "go home" link under three different reasons. The filter is
 * not one of these — a filtered-empty feed says so itself inside the component, because that is
 * the only case the chips can fix.
 *
 * The sentence is one reason followed by its consequence, which is the shape the feed sets: the
 * first sentence becomes the empty state's title and the rest its body.
 */
function emptyFeed(
  groups: ActivityGroup[],
  scoped: ActivityGroup | null,
): { text: string; action: ReactNode } {
  if (scoped !== null) {
    return {
      text: `Nothing has been recorded in ${scoped.name} yet. Activity from your other groups is on the full feed.`,
      action: (
        <Link className={FEED_LINK} href="/activity">
          Show every group
        </Link>
      ),
    };
  }
  if (groups.length === 0) {
    return {
      text: 'You are not in a group yet. Activity appears here once you create one or join somebody else’s.',
      action: (
        <Link className={FEED_LINK} href="/groups/new">
          Create a group
        </Link>
      ),
    };
  }
  if (groups.every((group) => group.archived)) {
    return {
      text: 'Every group you are in is archived, so nothing new is being recorded. An archived group keeps the history it has on its own page.',
      action: (
        <Link className={FEED_LINK} href="/">
          Go to your groups
        </Link>
      ),
    };
  }
  return {
    text: 'No activity yet. The feed fills as your groups record expenses, payments and members.',
    // The one action here that names a group in full, so it is the one that can be handed an
    // 80-character unbroken name. `max-w-full` is load-bearing and the other two links do not
    // need it: this action is an item of the EmptyState's `items-start` column, so without a cap
    // it is laid out at its max-content width and `break-words` alone has nothing to wrap into.
    action: (
      <Link
        className={`${FEED_LINK} min-w-0 max-w-full break-words`}
        href={`/groups/${groups[0].id}`}
      >
        {`Open ${groups[0].name}`}
      </Link>
    ),
  };
}
