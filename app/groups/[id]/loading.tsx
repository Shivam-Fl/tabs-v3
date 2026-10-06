import { AppShell } from '../../../components/app-shell';

/**
 * What a cold navigation to a group paints (IAC-6).
 *
 * The page cannot render anything before its guard has read the session and the database — three
 * round trips, then the ledger — so without this the route paints blank and fills in, which is
 * the layout jump ui.md bans. This is the boundary Next streams in the meantime: the shape of the
 * screen the reader is about to get, in the order they will get it.
 *
 * The shape is the loaded screen's, not an approximation of it: the avatar and title line, the
 * summary card with its hero number and its two actions, the tab bar, and rows of the list. If
 * the skeleton and the screen disagree about where the tab bar sits, the arrival of the data
 * moves the thing the reader's thumb is heading for.
 *
 * It holds no data and reads none — that is what makes it safe to paint before the guard has
 * decided whether this viewer may see this group at all.
 *
 * The one thing it deliberately does not do is guess an **empty** state. An empty group's screen
 * says "no expenses yet" and this says nothing, because saying it here would mean claiming the
 * group is empty before anybody has asked it.
 *
 * Motion comes from the ui.md rule like every other animation: `motion-safe` means the pulse runs
 * only for a viewer who has not asked for less, which is the trade globals.css makes everywhere.
 */
export default function GroupLoading() {
  return (
    <AppShell place={null}>
      <main
        className="mx-auto flex w-full max-w-[1024px] flex-1 flex-col gap-5 px-4 pt-5 pb-24 sm:pb-5"
        aria-busy="true"
      >
        <p role="status" className="sr-only">
          Loading this group…
        </p>

        {/* A reader with scripting off is left holding this fallback and nothing else: the resolved
            ledger waits in the streamed Flight payload for a client-JS swap that never runs without
            JavaScript, so the skeleton above would pulse forever. This says what is actually
            missing instead (AC-16) — a designed sentence, not a bare loader nobody can finish. */}
        <noscript>
          <p className="rounded-token border border-border bg-surface p-4 text-secondary text-ink shadow-sm">
            Tabs needs JavaScript to load this group&rsquo;s ledger. Turn it on and reload the page.
          </p>
        </noscript>

        <div className="flex items-center gap-3">
          <div
            data-skeleton="group-avatar"
            className="size-10 shrink-0 rounded-full bg-muted/20 motion-safe:animate-pulse"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div
              data-skeleton="group-name"
              className="h-8 w-48 rounded-token bg-muted/20 motion-safe:animate-pulse"
            />
            <div
              data-skeleton="group-badge"
              className="h-6 w-20 rounded-full bg-muted/20 motion-safe:animate-pulse"
            />
          </div>
        </div>

        <div
          data-skeleton="summary"
          className="flex flex-col gap-4 rounded-token border border-border bg-surface p-4 shadow-sm"
        >
          <div className="flex flex-col gap-2">
            <div className="h-4 w-24 rounded-token bg-muted/20 motion-safe:animate-pulse" />
            <div
              data-skeleton="summary-hero"
              className="h-9 w-40 rounded-token bg-muted/20 motion-safe:animate-pulse"
            />
            <div className="h-5 w-56 rounded-token bg-muted/20 motion-safe:animate-pulse" />
          </div>
          <div className="flex flex-col gap-2">
            {[0, 1].map((line) => (
              <div key={line} className="flex items-center justify-between gap-2">
                <div className="h-5 w-40 rounded-token bg-muted/20 motion-safe:animate-pulse" />
                <div className="h-5 w-20 rounded-token bg-muted/20 motion-safe:animate-pulse" />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="h-11 w-32 rounded-token bg-muted/20 motion-safe:animate-pulse" />
            <div className="h-11 w-28 rounded-token bg-muted/20 motion-safe:animate-pulse" />
          </div>
        </div>

        {/* The tab bar, at the width the four labels take: it is the row a thumb is heading for,
            so it has to be in the fallback rather than arriving with the data. */}
        <div data-skeleton="tabs" className="flex gap-1">
          {[0, 1, 2, 3].map((tab) => (
            <div
              key={tab}
              data-skeleton="tab"
              className="h-11 w-24 rounded-token bg-muted/20 motion-safe:animate-pulse"
            />
          ))}
        </div>

        <ul className="flex flex-col gap-2">
          {[0, 1, 2].map((row) => (
            <li
              key={row}
              data-skeleton="expense-row"
              className="flex items-center gap-3 rounded-token border border-border bg-surface p-3"
            >
              <div className="size-8 shrink-0 rounded-full bg-muted/20 motion-safe:animate-pulse" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="h-5 w-40 rounded-token bg-muted/20 motion-safe:animate-pulse" />
                <div className="h-5 w-56 rounded-token bg-muted/20 motion-safe:animate-pulse" />
              </div>
              <div className="h-5 w-16 shrink-0 rounded-token bg-muted/20 motion-safe:animate-pulse" />
            </li>
          ))}
        </ul>
      </main>
    </AppShell>
  );
}
