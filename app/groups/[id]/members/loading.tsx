import { AppShell } from '../../../../components/app-shell';
import { Skeleton } from '../../../../components/ui';

/**
 * What a cold navigation to the members screen paints (AC-12, TR-11).
 *
 * The page cannot render anything before its guard has read the session and the database, so
 * without this the whole route paints blank and then fills in. This is the boundary Next
 * streams in the meantime: skeleton blocks shaped like the screen they are standing in for
 * (header, invite panel, member rows), so nothing moves when the data arrives.
 *
 * It holds no data and reads none — that is what makes it safe to paint before the guard has
 * decided whether the viewer may see this group at all.
 *
 * The shell goes above the skeletons so the bar is already there when the data arrives rather
 * than appearing under the reader's eyes; its place is a placeholder here because the group's
 * name is one of the things this boundary is waiting for.
 *
 * Every block is the shared `Skeleton`, which is where the `bg-muted/20` fill and the
 * `motion-safe` pulse live — the pulse only runs for a viewer who has not asked for less, the
 * same trade globals.css makes. The names are the ones the loaded screen is measured by, so a
 * reader (and a test) can find the same landmarks before and after the data lands.
 */
export default function MembersLoading() {
  return (
    <AppShell place={null}>
      <main
        className="mx-auto flex w-full max-w-[1024px] flex-1 flex-col gap-5 px-4 py-5"
        aria-busy="true"
      >
        <p role="status" className="sr-only">
          Loading members…
        </p>

        {/* A reader with scripting off is left holding this skeleton: say what is missing rather
            than pulse forever (AC-16). */}
        <noscript>
          <p className="rounded-token border border-border bg-surface p-4 text-secondary text-ink shadow-sm">
            Tabs needs JavaScript to load this group&rsquo;s members. Turn it on and reload the page.
          </p>
        </noscript>

        <header className="flex flex-col gap-2">
          <div data-skeleton="title">
            <Skeleton className="h-8 w-52" />
          </div>
          <div data-skeleton="subtitle">
            <Skeleton className="h-6 w-64" />
          </div>
        </header>

        {/* Same split as the screen itself, invite panel first on narrow: the fallback has to
            have the loaded layout or the arrival of the data is a jump. */}
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <section className="flex flex-col gap-4 rounded-token border border-border bg-surface p-4 shadow-sm lg:order-2 lg:w-[22rem]">
            <div data-skeleton="invite-heading">
              <Skeleton className="h-7 w-32" />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div data-skeleton="invite-field" className="flex-1">
                <Skeleton className="h-11 w-full" />
              </div>
              {/* The invite panel's loading button state: a button-shaped block, disabled in
                  effect because there is nothing yet for it to act on. */}
              <div data-skeleton="invite-button">
                <Skeleton className="h-11 w-24" />
              </div>
            </div>
            <div data-skeleton="invite-note">
              <Skeleton className="h-5 w-full" />
            </div>
          </section>

          <section className="flex flex-1 flex-col gap-5 rounded-token border border-border bg-surface p-4 shadow-sm">
            <div data-skeleton="members-heading">
              <Skeleton className="h-7 w-24" />
            </div>
            <ul className="flex flex-col gap-2">
              {[0, 1, 2].map((row) => (
                <li
                  key={row}
                  data-skeleton="member-row"
                  className="flex items-start gap-3 rounded-token border border-border bg-surface p-3"
                >
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-6 w-40" />
                    <Skeleton className="h-5 w-24" />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </AppShell>
  );
}
