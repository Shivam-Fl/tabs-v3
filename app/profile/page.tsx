import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '../../components/app-shell';
import { ProfileSaveButton } from '../../components/profile-save-button';
import { signOut, updateProfile } from '../../lib/auth/actions';
import { getSessionUser } from '../../lib/auth/session';
import { SUPPORTED_CURRENCIES } from '../../lib/auth/validation';
import { withDb } from '../../lib/db/client';

export const metadata: Metadata = { title: 'Your profile · Tabs' };

/**
 * The signed-in home for an account: display name, default currency, and the way out. Every
 * read and write here is authorized against the request's own session (the architecture
 * invariant), and the form posts to a Server Action. The one piece of client code is the Save
 * button, which needs the in-flight state a server render cannot hold; everything else — the
 * fields, the sign-out form, and the redirect-based saved/invalid notices — stays on the server.
 *
 * It wears the shared app shell now (IAC-4) and carries the way back to Home (IAC-5). The form
 * below it is untouched: this slice gives the account screen its navigation, not its redesign.
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
    ? { tone: 'danger' as const, text: 'Check the highlighted fields and try again.' }
    : params.saved
      ? { tone: 'lent' as const, text: 'Profile saved.' }
      : null;

  return (
    <AppShell place="Profile" viewer={{ displayName: user.displayName }}>
      <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col gap-5 px-4 py-5">
        <Link
          className="inline-flex items-center gap-2 text-secondary text-accent underline-offset-4 hover:underline"
          href="/"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to Home
        </Link>

        <h1 className="text-2xl font-semibold">Your profile</h1>

        {notice ? (
          <p
            role={notice.tone === 'danger' ? 'alert' : 'status'}
            className={notice.tone === 'danger' ? 'text-sm text-danger' : 'text-sm text-lent'}
          >
            {notice.text}
          </p>
        ) : null}

        <p className="text-muted">{user.email}</p>

        <form
          action={updateProfile}
          className="flex flex-col gap-4 rounded-token border border-muted/20 bg-surface p-5"
        >
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="profile-displayName">
              Display name
            </label>
            <input
              id="profile-displayName"
              name="displayName"
              type="text"
              autoComplete="name"
              maxLength={80}
              defaultValue={user.displayName}
              className="min-h-11 w-full rounded-token border border-muted/40 bg-surface px-3 text-ink"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="profile-currency">
              Default currency
            </label>
            <select
              id="profile-currency"
              name="currency"
              defaultValue={user.currency}
              className="min-h-11 w-full rounded-token border border-muted/40 bg-surface px-3 text-ink"
            >
              {SUPPORTED_CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
            <p className="text-sm text-muted">New groups start in this currency.</p>
          </div>

          <ProfileSaveButton />
        </form>

        <form action={signOut}>
          <button
            type="submit"
            className="min-h-11 w-full rounded-token border border-muted/40 px-4 font-medium"
          >
            Sign out
          </button>
        </form>
      </main>
    </AppShell>
  );
}
