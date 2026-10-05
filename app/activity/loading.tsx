import { ActivityFeedSkeleton } from '../../components/activity-feed';

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
 * been checked at all.
 */
export default function ActivityLoading() {
  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-[1024px] flex-col gap-5 p-4"
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
  );
}
