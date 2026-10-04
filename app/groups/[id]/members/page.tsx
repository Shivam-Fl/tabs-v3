import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AddPlaceholderForm, InvitePanel, MembersPanel } from '../../../../components/groups-panels';
import { withDb } from '../../../../lib/db/client';
import { guardGroup, type GroupAccess } from '../../../../lib/groups/authz';
import { getMemberBalance } from '../../../../lib/groups/members';
import { listMembers } from '../../../../lib/groups/queries';

export const metadata: Metadata = { title: 'Members · Tabs' };

/**
 * Who is in this group and how new people join (TR-7, TR-11).
 *
 * Same guard, same 404 as the group itself: a member of the group sees it, a stranger does not
 * learn it exists. The invite panel is the owner's — the link is theirs to hand out and to
 * revoke — while adding a seat by name is any member's, because the person holding the seat is
 * whoever the group is keeping accounts for.
 */
export default async function MembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await withDb((handle) => guardGroup(handle.db, id));

  if (access.status === 'unauthenticated') {
    redirect(`/signin?next=${encodeURIComponent(`/groups/${id}/members`)}`);
  }
  if (access.status === 'not-found') notFound();

  const members = await withDb((handle) => listMembers(handle.db, access.group.id));

  return <MembersScreen access={access} members={members} />;
}

function MembersScreen({
  access,
  members,
}: {
  access: Extract<GroupAccess, { status: 'ok' }>;
  members: Awaited<ReturnType<typeof listMembers>>;
}) {
  const { group, membership, user } = access;
  const isOwner = membership.role === 'owner';

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1024px] flex-col gap-5 p-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{group.name}</h1>
        <p className="text-muted">Members and invite link</p>
      </header>

      {/* Narrow screens put the invite panel first, so the thing a new group needs is the
          thing you see; the member list follows. */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {isOwner ? (
          <div className="flex flex-col gap-4 rounded-token border border-muted/20 bg-surface p-4 lg:order-2 lg:w-[22rem]">
            <InvitePanel
              groupId={group.id}
              groupName={group.name}
              invitePath={group.inviteToken ? `/join/${group.inviteToken}` : null}
              inviteEnabled={group.inviteEnabled}
            />
          </div>
        ) : null}

        <div className="flex flex-1 flex-col gap-5 rounded-token border border-muted/20 bg-surface p-4">
          <MembersPanel
            groupId={group.id}
            groupName={group.name}
            members={members.map((member) => ({
              id: member.id,
              userId: member.userId,
              displayName: member.displayName,
              role: member.role,
              balanceMinor: getMemberBalance(group.id, member.id),
            }))}
            viewerMembershipId={membership.id}
            isOwner={isOwner}
            archived={group.archived}
            currency={group.currency}
          />

          {!group.archived ? (
            <AddPlaceholderForm groupId={group.id} />
          ) : (
            <p className="text-sm text-muted">
              This group is archived, so seats cannot be added to it.
            </p>
          )}
        </div>
      </div>

      <p className="text-muted">
        <Link className="text-accent underline" href={`/groups/${group.id}`}>
          Back to {group.name}
        </Link>
      </p>
    </main>
  );
}
