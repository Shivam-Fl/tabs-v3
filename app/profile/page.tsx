import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '../../components/app-shell';
import { ProfileForm } from '../../components/profile-form';
import { Card } from '../../components/ui';
import { getSessionUser } from '../../lib/auth/session';
import { PROFILE_REFUSAL_MESSAGE } from '../../lib/auth/validation';
import { withDb } from '../../lib/db/client';

export const metadata: Metadata = { title: 'Your profile · Tabs' };

/**
 * The signed-in home for an account: the one settings card, with the display name, the default
 * currency and a Save that guards itself (AC-5, ui.md's Profile screen).
 *
 * Every read and write here is authorized against the request's own session (the architecture
 * invariant). The form itself is the island — see `components/profile-form.tsx` for why a
 * refusal comes back inline rather than as a redirect — and this page keeps the one thing a
 * redirect still owns: the `?saved=1` confirmation, in a single `role="status"` slot.
 *
 * **Sign-out is not here.** ui.md puts it in the account menu, never as a button on this page,
 * so the shell's avatar is the only way out and the card has nothing destructive in it.
 *
 * `?error=invalid` is still read and rendered, byte-identically: it is how a direct hit on the
 * old URL — a bookmark, a back button, a link somebody pasted — still lands on a page that says
 * what went wrong instead of one that silently shows nothing.
 */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const user = await withDb((handle) => getSessionUser(handle.db));
  if (!user) redirect('/signin');

  const params = await searchParams;
  const notice = params.error
    ? { tone: 'danger' as const, text: PROFILE_REFUSAL_MESSAGE }
    : params.saved
      ? { tone: 'lent' as const, text: 'Profile saved.' }
      : null;

  return (
    <AppShell place="Profile" viewer={{ displayName: user.displayName }}>
      <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-5 px-4 py-5">
        <Link
          className="inline-flex items-center gap-2 text-secondary text-accent underline-offset-4 hover:underline"
          href="/"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to Home
        </Link>

        <h1 className="text-page font-semibold text-ink">Your profile</h1>

        {/* One slot, like every other success notice in the app: whichever outcome last landed
            here is the one worth saying, and there is never a second one beside it. */}
        {notice ? (
          <p
            role={notice.tone === 'danger' ? 'alert' : 'status'}
            className={
              notice.tone === 'danger' ? 'text-secondary text-danger' : 'text-secondary text-lent'
            }
          >
            {notice.text}
          </p>
        ) : null}

        <Card>
          <p className="text-secondary text-ink-muted">{user.email}</p>
          <ProfileForm displayName={user.displayName} currency={user.currency} />
        </Card>
      </main>
    </AppShell>
  );
}
