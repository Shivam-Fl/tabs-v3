import { AppShell } from './app-shell';

/**
 * The shapes the group screens paint while their data is on its way (IAC-6, AC-9).
 *
 * These are **Suspense fallbacks, not route files**, and that distinction is the whole reason this
 * module exists. A `loading.tsx` at a segment wraps that segment's *page*, so Next streams the
 * fallback and commits the response's status before the page's own guard has run: a signed-out,
 * stranger, malformed or missing request got HTTP 200 with a skeleton or a not-available body, and
 * only a router-driven browser corrected it from the Flight payload. Guard-first ordering cannot
 * be promised from a file above the guard. A fallback handed to a `<Suspense>` *below* the guard
 * can: the guard has already thrown its `redirect()`/`notFound()` by the time either of these is
 * ever considered, so the wire status is the guard's and the skeleton is only ever what a viewer
 * who may see the group watches while the group's data comes back.
 *
 * Both hold no data and read none — that is what keeps them safe wherever they sit.
 *
 * They differ in what they cover, and that is deliberate rather than an accident of history. The
 * group page renders its shell — breadcrumb, header, notices — synchronously from the guard's own
 * result, so its fallback is only the region the data fills, and painting a header-shaped block
 * there would print a second header under the real one. The expense editors render nothing until
 * their read returns, so their fallback wears the shell itself; without it the top bar would
 * appear only when the form did, which is the layout jump these exist to prevent.
 *
 * Motion comes from the ui.md rule like every other animation: `motion-safe` means the pulse runs
 * only for a viewer who has not asked for less.
 */

/**
 * The group page's fallback: the summary card, the tab bar and rows of the list, in the order the
 * loaded screen puts them.
 *
 * The shape is the loaded screen's, not an approximation of it: if the skeleton and the screen
 * disagree about where the tab bar sits, the arrival of the data moves the thing the reader's
 * thumb is heading for.
 *
 * The one thing it deliberately does not do is guess an **empty** state. An empty group's screen
 * says "no expenses yet" and this says nothing, because saying it here would mean claiming the
 * group is empty before anybody has asked it.
 */
export function GroupPageSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-5">
      <p role="status" className="sr-only">
        Loading this group…
      </p>

      {/* A reader with scripting off is left holding this fallback and nothing else: the resolved
          ledger waits in the streamed Flight payload for a client-JS swap that never runs without
          JavaScript, so the skeleton above would pulse forever. This says what is actually missing
          instead (AC-16) — a designed sentence, not a bare loader nobody can finish. */}
      <noscript>
        <p className="rounded-token border border-border bg-surface p-4 text-secondary text-ink shadow-sm">
          Tabs needs JavaScript to load this group&rsquo;s ledger. Turn it on and reload the page.
        </p>
      </noscript>

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
    </div>
  );
}

/**
 * The expense editors' fallback: the form the reader asked for, never the ledger they did not.
 *
 * It draws a form and nothing else — a title, the fields in the shape the editor stacks them, and
 * a submit. A ledger skeleton (a summary card, a tab bar, expense rows) painting over an expense
 * form would be worse than no skeleton at all: the reader would watch one screen arrive and then
 * get another.
 *
 * `place` is the group's name, which the editor pages already hold — their guard resolved it
 * before this fallback can ever be considered — so the top bar can name where the reader is
 * instead of showing the shell's placeholder.
 */
export function EditorFormSkeleton({ place = null }: { place?: string | null }) {
  return (
    <AppShell place={place}>
      <main
        className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-5 px-4 py-5"
        aria-busy="true"
      >
        <p role="status" className="sr-only">
          Loading the expense form…
        </p>

        <div className="flex flex-col gap-2">
          <div
            data-skeleton="editor-title"
            className="h-8 w-56 rounded-token bg-muted/20 motion-safe:animate-pulse"
          />
          <div
            data-skeleton="editor-subtitle"
            className="h-6 w-72 rounded-token bg-muted/20 motion-safe:animate-pulse"
          />
        </div>

        <div
          data-skeleton="expense-form"
          className="flex flex-col gap-4 rounded-token border border-border bg-surface p-4 shadow-sm"
        >
          {[0, 1, 2].map((field) => (
            <div key={field} className="flex flex-col gap-2">
              <div className="h-5 w-24 rounded-token bg-muted/20 motion-safe:animate-pulse" />
              <div
                data-skeleton="expense-field"
                className="h-11 w-full rounded-token bg-muted/20 motion-safe:animate-pulse"
              />
            </div>
          ))}

          <div className="flex flex-wrap gap-3">
            <div
              data-skeleton="expense-submit"
              className="h-11 w-32 rounded-token bg-muted/20 motion-safe:animate-pulse"
            />
            <div className="h-11 w-24 rounded-token bg-muted/20 motion-safe:animate-pulse" />
          </div>
        </div>
      </main>
    </AppShell>
  );
}
