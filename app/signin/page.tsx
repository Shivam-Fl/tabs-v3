import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthForm } from '../../components/auth-form';
import { signin } from '../../lib/auth/actions';
import { getSessionUser } from '../../lib/auth/session';
import { withDb } from '../../lib/db/client';

export const metadata: Metadata = { title: 'Sign in · Tabs' };

/**
 * Sign-in mirrors sign-up on purpose, copy included: the two screens must be the same shape,
 * because the one thing they must never do is tell a visitor whether an address is
 * registered. Same tokens, same states, same neutral error.
 */
export default async function SignInPage() {
  const signedIn = await withDb((handle) => getSessionUser(handle.db));
  if (signedIn) redirect('/profile');

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
        <Link className="text-accent underline" href="/signup">
          Create an account
        </Link>
      </p>
    </main>
  );
}
