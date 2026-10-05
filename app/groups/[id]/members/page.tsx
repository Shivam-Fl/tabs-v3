import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { AppShell } from '../../../../components/app-shell';
import { AddPlaceholderForm, InvitePanel, MembersPanel } from '../../../../components/groups-panels';
import { withDb } from '../../../../lib/db/client';
import { guardGroup, type GroupAccess } from '../../../../lib/groups/authz';
import { computeNetBalances } from '../../../../lib/settle/balances';
import { listMembers } from '../../../../lib/groups/queries';
import {
  INVITE_NOTICE_PARAM,
  REMOVED_NOTICE_PARAM,
  inviteNoticeText,
  parseNoticeName,
  removedNoticeText,
} from '../../../../lib/groups/validation';

export const metadata: Metadata = { title: 'Members · Tabs' };

/**
 * Who is in this group and how new people join (TR-7, TR-11).
 *
 * Same guard, same 404 as the group itself: a member of the group sees it, a stranger does not
 * learn it exists. The invite panel is the owner's — the link is theirs to hand out and to
 * revoke — while adding a seat by name is any member's, because the person holding the seat is
 * whoever the group is keeping accounts for.
 *
 * A remove lands here with the removed name in the query, because the row that held the
 * confirming form is the row the remove deleted (AC-11). The name is reflected into one
 * sentence and nothing else; absent or blank, there is no note to render.
 *
 * A rotate or a disable lands here the same way, with its outcome in the invite query (AC-13).
 * Both outcomes use that one parameter, so the sentence read here is always the latest one —
 * the panel has a single slot and a later success overwrites the earlier rather than stacking.
 */
export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ removed?: string; invite?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const access = await withDb((handle) => guardGroup(handle.db, id));

  if (access.status === 'unauthenticated') {
    redirect(`/signin?next=${encodeURIComponent(`/groups/${id}/members`)}`);
  }
  if (access.status === 'not-found') notFound();

  const members = await withDb((handle) => listMembers(handle.db, access.group.id));
  const balances = await withDb((handle) => computeNetBalances(handle.db, access.group.id));
  const removedName = parseNoticeName(query[REMOVED_NOTICE_PARAM]);
  const inviteNotice = inviteNoticeText(query[INVITE_NOTICE_PARAM]);

  return (
    <MembersScreen
      access={access}
      members={members}
      balances={balances}
      removedName={removedName}
      inviteNotice={inviteNotice}
    />
  );
}

function MembersScreen({
  access,
  members,
  balances,
  removedName,
  inviteNotice,
}: {
  access: Extract<GroupAccess, { status: 'ok' }>;
  members: Awaited<ReturnType<typeof listMembers>>;
  /** The one recompute path's output, keyed by membership, so no row does its own arithmetic. */
  balances: Awaited<ReturnType<typeof computeNetBalances>>;
  removedName: string | null;
  inviteNotice: string | null;
}) {
  const { group, membership, user } = access;
  const isOwner = membership.role === 'owner';
  const balanceOf = new Map(balances.map((balance) => [balance.membershipId, balance.balanceMinor]));

  return (
    <AppShell place={group.name} viewer={{ displayName: user.displayName }}>
      <main className="mx-auto flex w-full max-w-[1024px] flex-1 flex-col gap-5 px-4 py-5">
        {/* The group is this screen's parent, and the shell's place is a label rather than a link:
            the way up has to be on the page. */}
        <Link
          className="inline-flex items-center gap-2 text-secondary text-accent underline-offset-4 hover:underline"
          href={`/groups/${group.id}`}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {`Back to ${group.name}`}
        </Link>

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
                inviteNotice={inviteNotice}
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
                balanceMinor: balanceOf.get(member.id) ?? 0,
              }))}
              viewerMembershipId={membership.id}
              isOwner={isOwner}
              archived={group.archived}
              currency={group.currency}
              removedNotice={
                removedName === null ? null : removedNoticeText(removedName, group.name)
              }
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
    </AppShell>
  );
}
