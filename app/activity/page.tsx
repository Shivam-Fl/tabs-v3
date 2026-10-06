import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { redirect } from 'next/navigation';
import { AppShell } from '../../components/app-shell';
import { ActivityFeed } from '../../components/activity-feed';
import {
  ACTIVITY_FILTER_PARAM,
  ACTIVITY_GROUP_PARAM,
  DEFAULT_ACTIVITY_FILTER,
  activityFilterFrom,
  listActivityGroups,
  listUserActivity,
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
  searchParams: Promise<{ activity?: string; group?: string }>;
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

  // The scope only exists if it names a group the caller holds a seat in; anything else — a stale
  // link, a typo, another group's id — shows the whole feed, exactly as an unknown chip does.
  const scoped = groups.find((group) => group.id === query[ACTIVITY_GROUP_PARAM]) ?? null;
  const shown = scoped === null ? rows : rows.filter((row) => row.groupId === scoped.id);

  return (
    <AppShell place="Activity" viewer={{ displayName: viewer.displayName }}>
      <main className="mx-auto flex w-full max-w-[1024px] flex-1 flex-col gap-5 px-4 py-5">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold">Activity</h1>
            {/* The feed is every group at once, so its way back is Home — where the groups are. */}
            <Link
              className="inline-flex items-center gap-2 text-secondary text-accent underline-offset-4 hover:underline"
              href="/"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back to Home
            </Link>
          </div>

          {scoped === null ? null : (
            <p className="text-secondary text-muted">
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
            <Link className="text-accent underline" href={activityHref(filter, scoped?.id ?? null)}>
              Retry
            </Link>
          </section>
        ) : (
          <ActivityFeed
            rows={shown}
            filter={filter}
            action="/activity"
            // A chip submits only its own form, so without this the scope would be dropped by the
            // one control on the page that is meant to narrow the feed further.
            preserved={scoped === null ? {} : { [ACTIVITY_GROUP_PARAM]: scoped.id }}
            showGroup
            emptyText={emptyFeedText(groups, scoped)}
          />
        )}
      </main>
    </AppShell>
  );
}

/**
 * This page's own URL, carrying the filter and the scope — what a retry, a chip and the
 * way back to every group all resolve to. Only values that are set travel, so the unscoped,
 * unfiltered feed stays `/activity` rather than gaining two empty parameters.
 */
function activityHref(filter: ActivityFilter, groupId: string | null): string {
  const params = new URLSearchParams();
  if (groupId !== null) params.set(ACTIVITY_GROUP_PARAM, groupId);
  if (filter !== DEFAULT_ACTIVITY_FILTER) params.set(ACTIVITY_FILTER_PARAM, filter);

  const search = params.toString();
  return search === '' ? '/activity' : `/activity?${search}`;
}

/**
 * Why the feed is empty, in the cases that would otherwise read identically (TR-11).
 *
 * "Nothing has happened yet" and "you are not in a group" call for different next steps, and a
 * viewer whose every group is archived is looking at a fourth thing again: history that exists
 * but can no longer grow. A scoped feed has its own answer, because the reader is looking at one
 * group and the reason there is nothing in it is about that group and not about the others. The
 * filter is not one of these — a filtered-empty feed says so itself inside the component, because
 * that is the only case the chips can fix.
 */
function emptyFeedText(groups: ActivityGroup[], scoped: ActivityGroup | null): string {
  if (scoped !== null) {
    return `Nothing has been recorded in ${scoped.name} yet.`;
  }
  if (groups.length === 0) {
    return 'You are not in a group yet. Activity appears here once you create one or join somebody else’s.';
  }
  if (groups.every((group) => group.archived)) {
    return 'Every group you are in is archived, so nothing new is being recorded. An archived group keeps the history it has on its own page.';
  }
  return 'No activity yet. The feed fills as your groups record expenses, payments and members.';
}
