import { AppShell } from '../../../../components/app-shell';

/**
 * What a cold navigation to an expense editor paints (IAC-6).
 *
 * This file exists because of where it sits, not because of what it draws. Next uses the nearest
 * `loading.tsx` above a segment, so without a boundary here the new-expense and edit-expense
 * screens would inherit the group page's fallback — a ledger skeleton, with a summary card, tab
 * bar and expense rows, painted over a form. That is worse than no skeleton at all: the reader
 * would watch a ledger arrive and then get a form.
 *
 * So it draws a form and nothing else: a title, the fields in the shape the editor stacks them,
 * and a submit. It holds no data and reads none, for the reason every boundary does — it paints
 * before the guard has decided whether the viewer may touch this group.
 *
 * Motion comes from the ui.md rule like everywhere else: `motion-safe` means the pulse runs only
 * for a viewer who has not asked for less.
 */
export default function ExpenseEditorLoading() {
  return (
    <AppShell place={null}>
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
