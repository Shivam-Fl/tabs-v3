import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '../../../components/app-shell';
import { CreateGroupForm } from '../../../components/groups-panels';
import { getSessionUser } from '../../../lib/auth/session';
import { withDb } from '../../../lib/db/client';

export const metadata: Metadata = { title: 'New group · Tabs' };

/**
 * Creating a group (IAC-1). The session check is the same one every group route makes; a
 * signed-out visitor is sent to sign in with the way back, so the form they were opening is
 * where they land afterwards.
 */
export default async function NewGroupPage() {
  const user = await withDb((handle) => getSessionUser(handle.db));
  if (!user) redirect(`/signin?next=${encodeURIComponent('/groups/new')}`);

  return (
    <AppShell place="New group" viewer={{ displayName: user.displayName }}>
      <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center gap-5 px-4 py-5">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">New group</h1>
          <p className="text-muted">
            A name and a currency are all it takes. You can invite everyone else afterwards.
          </p>
        </div>

        <CreateGroupForm defaultCurrency={user.currency} />

        <p className="text-muted">
          <Link className="text-accent underline" href="/">
            Back to your groups
          </Link>
        </p>
      </main>
    </AppShell>
  );
}
