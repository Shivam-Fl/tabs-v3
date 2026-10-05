import { AppShell } from '../../../../components/app-shell';

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
 * Motion comes from the ui.md rule like every other animation: `motion-safe` means the pulse
 * only runs for a viewer who has not asked for less, which is the same trade globals.css makes.
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

        <header className="flex flex-col gap-2">
          <div
            data-skeleton="title"
            className="h-8 w-52 rounded-token bg-muted/20 motion-safe:animate-pulse"
          />
          <div
            data-skeleton="subtitle"
            className="h-6 w-64 rounded-token bg-muted/20 motion-safe:animate-pulse"
          />
        </header>

        {/* Same split as the screen itself, invite panel first on narrow: the fallback has to
            have the loaded layout or the arrival of the data is a jump. */}
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <div className="flex flex-col gap-4 rounded-token border border-muted/20 bg-surface p-4 lg:order-2 lg:w-[22rem]">
            <div
              data-skeleton="invite-heading"
              className="h-7 w-32 rounded-token bg-muted/20 motion-safe:animate-pulse"
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <div
                data-skeleton="invite-field"
                className="h-11 flex-1 rounded-token bg-muted/20 motion-safe:animate-pulse"
              />
              {/* The invite panel's loading button state: a button-shaped block, disabled in
                  effect because there is nothing yet for it to act on. */}
              <div
                data-skeleton="invite-button"
                className="h-11 w-24 rounded-token bg-muted/20 motion-safe:animate-pulse"
              />
            </div>
            <div
              data-skeleton="invite-note"
              className="h-5 w-full rounded-token bg-muted/20 motion-safe:animate-pulse"
            />
          </div>

          <div className="flex flex-1 flex-col gap-5 rounded-token border border-muted/20 bg-surface p-4">
            <div
              data-skeleton="members-heading"
              className="h-7 w-24 rounded-token bg-muted/20 motion-safe:animate-pulse"
            />
            <ul className="flex flex-col gap-2">
              {[0, 1, 2].map((row) => (
                <li
                  key={row}
                  data-skeleton="member-row"
                  className="flex flex-col gap-2 rounded-token border border-muted/20 bg-surface p-3"
                >
                  <div className="h-6 w-40 rounded-token bg-muted/20 motion-safe:animate-pulse" />
                  <div className="h-5 w-24 rounded-token bg-muted/20 motion-safe:animate-pulse" />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
