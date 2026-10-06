import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '../../components/app-shell';
import { ActivityFeed, FilterChips } from '../../components/activity-feed';
import { Card } from '../../components/ui';
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

  // Built once: the empty state's sentence and its action are one decision about one case.
  const empty = emptyFeed(groups);

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

        {failed ? (
          <>
            {/* The chips stay: the filter is where the reader was when the read failed, so the
                control that says which feed this is outlives the feed, and the retry below
                carries the same value (AC-4). */}
            <FilterChips filter={filter} action="/activity" />
            {/* A card, like every other surface on the page: the failure is one section of the
                screen rather than the screen, and the shared Card is what says so (TR-11). */}
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
                  href={activityHref(filter)}
                >
                  Retry
                </Link>
              </section>
            </Card>
          </>
        ) : (
          <ActivityFeed
            rows={rows}
            filter={filter}
            action="/activity"
            showGroup
            emptyText={empty.text}
            emptyAction={empty.action}
          />
        )}
      </main>
    </AppShell>
  );
}

/** This page's own URL, carrying the filter — what a retry or a chip submits to. */
function activityHref(filter: string): string {
  return filter === 'all'
    ? '/activity'
    : `/activity?${ACTIVITY_FILTER_PARAM}=${encodeURIComponent(filter)}`;
}

/** The shared look of the two links an empty feed can offer. */
const FEED_LINK = 'text-body text-accent underline underline-offset-4';

/**
 * Why the feed is empty, in the three cases that would otherwise read identically (TR-11).
 *
 * "Nothing has happened yet" and "you are not in a group" call for different next steps, and a
 * viewer whose every group is archived is looking at a fourth thing again: history that exists
 * but can no longer grow. Each case therefore gets its own sentence *and* its own action — the
 * one thing that actually helps from there, rather than one shared "go home" link under three
 * different reasons. The filter is not one of these — a filtered-empty feed says so itself
 * inside the component, because that is the only case the chips can fix.
 *
 * The sentence is one reason followed by its consequence, which is the shape the feed sets: the
 * first sentence becomes the empty state's title and the rest its body.
 */
function emptyFeed(groups: ActivityGroup[]): { text: string; action: ReactNode } {
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
