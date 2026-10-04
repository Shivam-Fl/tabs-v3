import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArchiveGroupForm, RenameGroupForm } from '../../../components/groups-panels';
import { guardGroup, type GroupAccess } from '../../../lib/groups/authz';
import { getMemberBalance } from '../../../lib/groups/members';
import {
  ARCHIVED_NOTICE,
  ARCHIVED_NOTICE_PARAM,
  GROUP_TYPE_LABELS,
  archivedNoticeText,
  type GroupType,
} from '../../../lib/groups/validation';
import { formatMinorUnits } from '../../../lib/money/format';
import { withDb } from '../../../lib/db/client';

export const metadata: Metadata = { title: 'Group · Tabs' };

/**
 * The group detail screen: who owes whom here, and what happened recently — of which this slice
 * builds the header, the balance banner shell and the settings section. The debts card, the
 * expenses list and the activity excerpt belong to TR-8, TR-9 and TR-10, and land on this page
 * rather than in a second one.
 *
 * The guard decides everything else. A signed-out visitor is sent to sign in with the way back;
 * a stranger, a malformed id and a group that does not exist all render the same 404, because
 * the guard cannot tell them apart any more than the reader can.
 *
 * An archive lands here carrying the notice flag, because archiving is what unmounts the
 * settings form that would have shown the confirmation (AC-11). The note renders directly above
 * the read-only banner it belongs beside, and only for a group that really is archived.
 */
export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ archived?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const access = await withDb((handle) => guardGroup(handle.db, id));

  if (access.status === 'unauthenticated') {
    redirect(`/signin?next=${encodeURIComponent(`/groups/${id}`)}`);
  }
  if (access.status === 'not-found') notFound();

  const justArchived = query[ARCHIVED_NOTICE_PARAM] === ARCHIVED_NOTICE;

  return <GroupDetail access={access} justArchived={justArchived} />;
}

function GroupDetail({
  access,
  justArchived,
}: {
  access: Extract<GroupAccess, { status: 'ok' }>;
  justArchived: boolean;
}) {
  const { group, membership, user } = access;
  const isOwner = membership.role === 'owner';
  const balance = getMemberBalance(group.id, membership.id);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1024px] flex-col gap-5 p-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{group.name}</h1>
        <p className="text-muted">
          {GROUP_TYPE_LABELS[group.type as GroupType] ?? group.type} · {group.currency} ·{' '}
          {user.displayName}
        </p>
        <p>
          <Link className="text-accent underline" href={`/groups/${group.id}/members`}>
            Members and invite link
          </Link>
        </p>
      </header>

      {group.archived ? (
        <>
          {justArchived ? (
            <p
              role="status"
              aria-live="polite"
              className="rounded-token border border-muted/40 bg-surface p-3 text-sm text-lent"
            >
              {archivedNoticeText(group.name)}
            </p>
          ) : null}
          <p
            role="status"
            className="rounded-token border border-muted/40 bg-surface p-3 text-sm"
          >
            This group is archived. You can read it, but nothing in it can change — and you can
            still leave it.
          </p>
        </>
      ) : null}

      <section
        className="rounded-token border border-muted/20 bg-surface p-4"
        aria-labelledby="balance-heading"
      >
        <h2 id="balance-heading" className="text-lg font-semibold">
          Your balance
        </h2>
        <p data-amount className="text-xl font-semibold">
          {formatMinorUnits(balance, group.currency)}
        </p>
        <p className="text-sm text-muted">
          Everyone is settled up. Balances appear here once the group records expenses.
        </p>
      </section>

      {isOwner && !group.archived ? (
        <section
          className="flex flex-col gap-4 rounded-token border border-muted/20 bg-surface p-4"
          aria-labelledby="settings-heading"
        >
          <h2 id="settings-heading" className="text-lg font-semibold">
            Group settings
          </h2>
          <RenameGroupForm groupId={group.id} name={group.name} />
          <ArchiveGroupForm groupId={group.id} groupName={group.name} />
          <p className="text-sm text-muted">
            Removing members and leaving live with the member list.
          </p>
          <p>
            <Link className="text-accent underline" href={`/groups/${group.id}/members`}>
              Go to members
            </Link>
          </p>
        </section>
      ) : null}
    </main>
  );
}
