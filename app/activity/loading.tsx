import { ActivityFeedSkeleton } from '../../components/activity-feed';
import { AppShell } from '../../components/app-shell';

/**
 * What a cold navigation to the cross-group feed paints (TR-11).
 *
 * The page cannot render anything before its session read and its two queries have come back, so
 * without this the route paints blank and then fills in. This is the boundary Next streams in the
 * meantime, and its blocks are the feed's own shape — the chip row, then event rows — rendered
 * from the same module as the feed so the fallback cannot drift out of shape from the thing it
 * stands in for.
 *
 * It holds no data and reads none, which is what makes it safe to paint before the session has
 * been checked at all. That is also why it can wear the shell: the chrome is markup with one
 * placeholder in it, and the place it names — Activity — is a constant this route already knows.
 */
export default function ActivityLoading() {
  return (
    <AppShell place="Activity">
      <main
        className="mx-auto flex w-full max-w-[1024px] flex-1 flex-col gap-5 px-4 py-5"
        aria-busy="true"
      >
        <p role="status" className="sr-only">
          Loading activity…
        </p>

        <header className="flex flex-wrap items-center justify-between gap-3">
          <div
            data-skeleton="title"
            className="h-8 w-40 rounded-token bg-muted/20 motion-safe:animate-pulse"
          />
          <div
            data-skeleton="nav"
            className="h-6 w-16 rounded-token bg-muted/20 motion-safe:animate-pulse"
          />
        </header>

        <ActivityFeedSkeleton />
      </main>
    </AppShell>
  );
}
