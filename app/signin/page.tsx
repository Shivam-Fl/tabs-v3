import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TabsMark } from '../../components/app-shell';
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
 *
 * Somebody who is already signed in is bounced to the same place a successful sign-in lands,
 * which is Home and not Profile (IAC-4): arriving at an auth screen is not a request to open
 * your account settings. The `next` in the URL still wins, so an invite link opened while
 * signed in goes where it was pointing.
 *
 * The mark in the header is the way back to the landing page (IAC-5) — an auth screen reached
 * from it must not be the one screen with no way out.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = parseNextPath((await searchParams).next);
  const signedIn = await withDb((handle) => getSessionUser(handle.db));
  if (signedIn) redirect(next ?? '/');

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-[1024px] items-center px-4 py-3">
        <Link
          href="/"
          aria-label="Tabs"
          className="inline-flex items-center gap-2 rounded-token p-1"
        >
          <TabsMark />
          <span className="text-lead font-semibold text-ink">Tabs</span>
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center gap-5 px-4 py-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-page font-semibold text-ink">Sign in</h1>
          <p className="text-body text-ink-muted">Welcome back. Your groups are waiting.</p>
        </div>
        <AuthForm
          mode="signin"
          action={signin}
          next={next}
          submitLabel="Sign in"
          pendingLabel="Signing in…"
        />
        <p className="text-body text-ink-muted">
          New to Tabs?{' '}
          {/* The way back travels with the visitor: signing up instead must not cost them the
              invite link they arrived through. */}
          <Link
            className="font-medium text-accent underline-offset-4 hover:underline"
            href={next ? `/signup?next=${encodeURIComponent(next)}` : '/signup'}
          >
            Create an account
          </Link>
        </p>
      </main>
    </div>
  );
}
