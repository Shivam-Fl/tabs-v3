import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthForm } from '../../components/auth-form';
import { signin } from '../../lib/auth/actions';
import { getSessionUser } from '../../lib/auth/session';
import { withDb } from '../../lib/db/client';
import { parseNextPath } from '../../lib/groups/validation';

export const metadata: Metadata = { title: 'Sign in · Tabs' };

/**
 * Sign-in mirrors sign-up on purpose, copy included: the two screens must be the same shape,
 * because the one thing they must never do is tell a visitor whether an address is
 * registered. Same tokens, same states, same neutral error.
 *
 * `next` is what makes an invite link survive authentication: the join page sends a signed-out
 * visitor here with the link in the query, and a successful sign-in lands them back on it.
 * Only a same-origin path is honoured — anything else is dropped, not echoed — so the parameter
 * cannot be turned into an open redirect (TR-6).
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = parseNextPath((await searchParams).next);
  const signedIn = await withDb((handle) => getSessionUser(handle.db));
  if (signedIn) redirect(next ?? '/profile');

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center gap-5 p-4">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="text-muted">Welcome back. Your groups are waiting.</p>
      <AuthForm
        mode="signin"
        action={signin}
        submitLabel="Sign in"
        pendingLabel="Signing in…"
      />
      <p className="text-muted">
        New to Tabs?{' '}
        {/* The way back travels with the visitor: signing up instead must not cost them the
            invite link they arrived through. */}
        <Link
          className="text-accent underline"
          href={next ? `/signup?next=${encodeURIComponent(next)}` : '/signup'}
        >
          Create an account
        </Link>
      </p>
    </main>
  );
}
