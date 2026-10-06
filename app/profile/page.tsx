import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '../../components/app-shell';
import { ProfileForm } from '../../components/profile-form';
import { getSessionUser } from '../../lib/auth/session';
import { profileNoticeText } from '../../lib/auth/validation';
import { withDb } from '../../lib/db/client';

export const metadata: Metadata = { title: 'Your profile · Tabs' };

/**
 * The signed-in home for an account: the one settings card, with the display name, the default
 * currency and a Save that guards itself (AC-3, AC-5, ui.md's Profile screen).
 *
 * Every read and write here is authorized against the request's own session (the architecture
 * invariant). The card and its notice slot belong to the island — see
 * `components/profile-form.tsx` for why the notice has to be painted where the action state is
 * known, which is the only place a stale `?saved=1` can be kept away from a fresh refusal.
 *
 * What the page still owns is reading the URL for a *direct hit*: a bookmark, a back button, a
 * link somebody pasted to `/profile?saved=1` or `/profile?error=invalid` still lands on a page
 * that says what happened. Both are read through `profileNoticeText` and nothing else, so a value
 * outside its closed vocabulary — `?saved=yes`, `?error=lol`, a repeated param — renders nothing
 * rather than reflecting a stranger's string back into the page (ADR-0008).
 *
 * **Sign-out is not here.** ui.md puts it in the account menu, never as a button on this page,
 * so the shell's avatar is the only way out and the card has nothing destructive in it.
 */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await withDb((handle) => getSessionUser(handle.db));
  if (!user) redirect('/signin');

  // The params are `unknown` at the validator's boundary on purpose: Next hands a repeated one
  // over as an array, and typing them `string` here would be a promise the request does not keep.
  const notice = profileNoticeText(await searchParams);

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

        <ProfileForm
          displayName={user.displayName}
          currency={user.currency}
          email={user.email}
          notice={notice}
        />
      </main>
    </AppShell>
  );
}
