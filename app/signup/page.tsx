import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthForm } from '../../components/auth-form';
import { signup } from '../../lib/auth/actions';
import { getSessionUser } from '../../lib/auth/session';
import { withDb } from '../../lib/db/client';

export const metadata: Metadata = { title: 'Create your account · Tabs' };

/**
 * The sign-up screen from ui.md's Auth pattern: one centered card, labelled controls, a
 * neutral success state. It reads the session only to bounce an already-signed-in visitor to
 * their profile — reading the cookie is also what makes the route render per request.
 */
export default async function SignUpPage() {
  const signedIn = await withDb((handle) => getSessionUser(handle.db));
  if (signedIn) redirect('/profile');

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center gap-5 p-4">
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <p className="text-muted">
        Tabs keeps a group&rsquo;s shared expenses straight — who paid for what, and the fewest
        payments that settle it up.
      </p>
      <AuthForm
        mode="signup"
        action={signup}
        submitLabel="Create account"
        pendingLabel="Creating account…"
      />
      <p className="text-muted">
        Already have an account?{' '}
        <Link className="text-accent underline" href="/signin">
          Sign in
        </Link>
      </p>
    </main>
  );
}
