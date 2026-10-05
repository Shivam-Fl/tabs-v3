import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TabsMark } from '../../components/app-shell';
import { AuthForm } from '../../components/auth-form';
import { signup } from '../../lib/auth/actions';
import { getSessionUser } from '../../lib/auth/session';
import { withDb } from '../../lib/db/client';
import { parseNextPath } from '../../lib/groups/validation';

export const metadata: Metadata = { title: 'Create your account · Tabs' };

/**
 * The sign-up screen from ui.md's Auth pattern: one centred card, labelled controls, a
 * neutral success state. It reads the session only to bounce an already-signed-in visitor to
 * Home — reading the cookie is also what makes the route render per request.
 *
 * `next` works exactly as it does on sign-in, and matters more here: somebody invited to a
 * group who has no account yet must be able to create one without losing the link they came
 * through. Same-origin only, and dropped rather than echoed when it is not.
 *
 * The mark in the header is the way back to the landing page (IAC-5), the same one sign-in
 * carries.
 */
export default async function SignUpPage({
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
          <h1 className="text-page font-semibold text-ink">Create your account</h1>
          <p className="text-body text-ink-muted">
            Tabs keeps a group&rsquo;s shared expenses straight — who paid for what, and the fewest
            payments that settle it up.
          </p>
        </div>
        <AuthForm
          mode="signup"
          action={signup}
          next={next}
          submitLabel="Create account"
          pendingLabel="Creating account…"
        />
        <p className="text-body text-ink-muted">
          Already have an account?{' '}
          <Link
            className="font-medium text-accent underline-offset-4 hover:underline"
            href={next ? `/signin?next=${encodeURIComponent(next)}` : '/signin'}
          >
            Sign in
          </Link>
        </p>
      </main>
    </div>
  );
}
