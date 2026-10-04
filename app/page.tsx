import Link from 'next/link';
import { getSessionUser } from '../lib/auth/session';
import { withDb } from '../lib/db/client';

/**
 * Still a landing page rather than the product's Home screen — groups, balances and the
 * activity feed arrive in their own tickets and will replace it. What changed here is that it
 * is now session-aware: it reads the request's cookie and offers the door that fits, which
 * is also why it renders per request rather than being prerendered.
 */
export default async function HomePage() {
  const user = await withDb((handle) => getSessionUser(handle.db));

  return (
    <main className="mx-auto flex min-h-dvh max-w-[1024px] flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Tabs</h1>
      <p className="max-w-[72ch] text-muted">
        Tabs keeps a group&rsquo;s shared expenses straight: who paid for what, what everyone
        owes, and the fewest payments that settle it up.
      </p>
      {user ? (
        <p className="max-w-[72ch] text-muted">
          Signed in as {user.displayName}.{' '}
          <Link className="text-accent underline" href="/profile">
            Your profile
          </Link>
        </p>
      ) : (
        <p className="max-w-[72ch] text-muted">
          <Link className="text-accent underline" href="/signin">
            Sign in
          </Link>{' '}
          or{' '}
          <Link className="text-accent underline" href="/signup">
            create an account
          </Link>{' '}
          to start a group.
        </p>
      )}
      <p>
        <a className="text-accent underline" href="/api/health">
          /api/health
        </a>
      </p>
    </main>
  );
}
