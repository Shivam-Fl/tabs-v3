/**
 * A placeholder, not a product screen. It exists so the app has something to serve at `/` and
 * so `next build` has a page that needs neither a database nor a secret — accounts, groups,
 * balances and the activity feed arrive in their own tickets, and each replaces this.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[1024px] flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Tabs</h1>
      <p className="max-w-[72ch] text-muted">
        Tabs keeps a group&rsquo;s shared expenses straight: who paid for what, what everyone
        owes, and the fewest payments that settle it up.
      </p>
      <p className="max-w-[72ch] text-muted">
        There is nothing to sign in to yet — accounts, groups and expenses are the next tickets.
      </p>
      <p>
        <a className="text-accent underline" href="/api/health">
          /api/health
        </a>
      </p>
    </main>
  );
}
