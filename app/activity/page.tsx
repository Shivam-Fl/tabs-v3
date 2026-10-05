import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActivityFeed } from '../../components/activity-feed';
import {
  ACTIVITY_FILTER_PARAM,
  activityFilterFrom,
  listActivityGroups,
  listUserActivity,
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
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ activity?: string }>;
}) {
  const query = await searchParams;
  const filter = activityFilterFrom(query[ACTIVITY_FILTER_PARAM]);

  const viewer = await withDb((handle) => getSessionUser(handle.db));
  if (!viewer) {
    redirect(`/signin?next=${encodeURIComponent('/activity')}`);
  }

  // One read at a time: the embedded backend serves a single connection, so two queries in
  // flight together are a queue pretending to be a race.
  let groups: ActivityGroup[] = [];
  let rows: ActivityRow[] = [];
  let failed = false;

  try {
    groups = await withDb((handle) => listActivityGroups(handle.db, viewer.id));
    rows = await withDb((handle) => listUserActivity(handle.db, viewer.id, filter));
  } catch (error) {
    // Both reads are the same failure to the reader: the feed did not load. The technical
    // detail goes to the server log and the screen gets a message and one way out, carrying
    // the filter so the retry lands on the feed they were looking at.
    console.error('[tabs] activity: could not load the feed', error);
    failed = true;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1024px] flex-col gap-5 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Activity</h1>
        <Link className="text-accent underline" href="/">
          Home
        </Link>
      </header>

      {failed ? (
        <section
          className="flex flex-col gap-3 rounded-token border border-danger/40 bg-surface p-4"
          aria-labelledby="activity-error"
        >
          <h2 id="activity-error" className="text-lg font-semibold">
            We could not load your activity
          </h2>
          <p className="text-muted">
            Nothing has been lost — the feed did not come back this time. Try again.
          </p>
          <Link className="text-accent underline" href={activityHref(filter)}>
            Retry
          </Link>
        </section>
      ) : (
        <ActivityFeed
          rows={rows}
          filter={filter}
          action="/activity"
          showGroup
          emptyText={emptyFeedText(groups)}
        />
      )}
    </main>
  );
}

/** This page's own URL, carrying the filter — what a retry or a chip submits to. */
function activityHref(filter: string): string {
  return filter === 'all'
    ? '/activity'
    : `/activity?${ACTIVITY_FILTER_PARAM}=${encodeURIComponent(filter)}`;
}

/**
 * Why the feed is empty, in the three cases that would otherwise read identically (TR-11).
 *
 * "Nothing has happened yet" and "you are not in a group" call for different next steps, and a
 * viewer whose every group is archived is looking at a fourth thing again: history that exists
 * but can no longer grow. The filter is not one of these — a filtered-empty feed says so itself
 * inside the component, because that is the only case the chips can fix.
 */
function emptyFeedText(groups: ActivityGroup[]): string {
  if (groups.length === 0) {
    return 'You are not in a group yet. Activity appears here once you create one or join somebody else’s.';
  }
  if (groups.every((group) => group.archived)) {
    return 'Every group you are in is archived, so nothing new is being recorded. An archived group keeps the history it has on its own page.';
  }
  return 'No activity yet. The feed fills as your groups record expenses, payments and members.';
}
