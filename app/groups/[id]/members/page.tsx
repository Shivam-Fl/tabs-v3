import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Users } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { AppShell } from '../../../../components/app-shell';
import {
  AddPlaceholderForm,
  CopyLinkButton,
  InvitePanel,
  MembersPanel,
} from '../../../../components/groups-panels';
import { Card, EmptyState } from '../../../../components/ui';
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

  // One read at a time — the embedded backend serves a single connection — and both inside the
  // one try, because to the reader they are the same failure: the roster did not come back. What
  // is left is a card that says so with a retry, rather than a route that throws (TR-11).
  let members: Awaited<ReturnType<typeof listMembers>> = [];
  let balances: Awaited<ReturnType<typeof computeNetBalances>> = [];
  let failed = false;

  try {
    members = await withDb((handle) => listMembers(handle.db, access.group.id));
    balances = await withDb((handle) => computeNetBalances(handle.db, access.group.id));
  } catch (error) {
    console.error('[tabs] members: could not load the roster', error);
    failed = true;
  }

  const removedName = parseNoticeName(query[REMOVED_NOTICE_PARAM]);
  const inviteNotice = inviteNoticeText(query[INVITE_NOTICE_PARAM]);

  return (
    <MembersScreen
      access={access}
      members={members}
      balances={balances}
      failed={failed}
      removedName={removedName}
      inviteNotice={inviteNotice}
    />
  );
}

function MembersScreen({
  access,
  members,
  balances,
  failed,
  removedName,
  inviteNotice,
}: {
  access: Extract<GroupAccess, { status: 'ok' }>;
  members: Awaited<ReturnType<typeof listMembers>>;
  /** The one recompute path's output, keyed by membership, so no row does its own arithmetic. */
  balances: Awaited<ReturnType<typeof computeNetBalances>>;
  /** Whether the roster reads came back; the invite panel is unaffected and still renders. */
  failed: boolean;
  removedName: string | null;
  inviteNotice: string | null;
}) {
  const { group, membership, user } = access;
  const isOwner = membership.role === 'owner';
  const balanceOf = new Map(balances.map((balance) => [balance.membershipId, balance.balanceMinor]));
  const invitePath = group.inviteToken ? `/join/${group.inviteToken}` : null;
  const soloOwner = isOwner && members.length === 1;

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
          <h1 className="text-page font-semibold text-ink">{group.name}</h1>
          <p className="text-body text-ink-muted">Members and invite link</p>
        </header>

        {/* Narrow screens put the invite panel first, so the thing a new group needs is the
            thing you see; the member list follows. The two are Cards with no title of their own:
            each panel carries the h2 that names it, so a Card title would be the same heading
            rendered twice. */}
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          {isOwner ? (
            <Card className="lg:order-2 lg:w-[22rem]">
              <InvitePanel
                groupId={group.id}
                groupName={group.name}
                invitePath={invitePath}
                inviteEnabled={group.inviteEnabled}
                inviteNotice={inviteNotice}
              />
            </Card>
          ) : null}

          {failed ? (
            <Card className="flex-1">
              <div className="flex flex-col gap-3" aria-labelledby="members-error">
                <h2 id="members-error" className="text-section font-semibold text-ink">
                  We could not load the members
                </h2>
                <p className="text-body text-ink-muted">
                  Nothing has changed — the list did not come back this time. Try again.
                </p>
                <Link
                  className="text-body text-accent underline underline-offset-4"
                  href={`/groups/${group.id}/members`}
                >
                  Retry
                </Link>
              </div>
            </Card>
          ) : (
            <Card className="flex-1">
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

              {/* A group with nobody but its owner is the one case where the roster has nothing
                  to act on and the thing to do is somewhere else on the page — so this is where
                  the invite link is offered, and only while it is live (AC-2). */}
              {soloOwner ? (
                <EmptyState
                  icon={<Users aria-hidden="true" className="size-5" />}
                  title="Nobody else is here yet"
                  body="Your group is just you so far. Share the invite link and the rest can join — or add somebody by name below if they have not signed up."
                  action={<SoloOwnerAction group={group} invitePath={invitePath} />}
                />
              ) : null}

              {!group.archived ? (
                <AddPlaceholderForm groupId={group.id} />
              ) : (
                <p className="text-body text-ink-muted">
                  This group is archived, so seats cannot be added to it.
                </p>
              )}
            </Card>
          )}
        </div>

        <p className="text-body text-ink-muted">
          <Link
            className="text-accent underline underline-offset-4"
            href={`/groups/${group.id}`}
          >
            Back to {group.name}
          </Link>
        </p>
      </main>
    </AppShell>
  );
}

/**
 * What a solo owner is offered instead of a copy button, in the cases that are not "the link
 * works". An archived group has nothing to offer — its read-only note is already below — while a
 * disabled link is replaced rather than copied and a group with no link yet needs one created;
 * both point at the invite panel above, where the control actually lives, rather than duplicating
 * it here.
 */
function SoloOwnerAction({
  group,
  invitePath,
}: {
  group: Extract<GroupAccess, { status: 'ok' }>['group'];
  invitePath: string | null;
}) {
  if (group.archived) return null;

  if (invitePath === null) {
    return (
      <Link className="text-body text-accent underline underline-offset-4" href="#invite-heading">
        Create an invite link
      </Link>
    );
  }

  if (!group.inviteEnabled) {
    return (
      <Link className="text-body text-accent underline underline-offset-4" href="#invite-heading">
        Create a new invite link
      </Link>
    );
  }

  return <CopyLinkButton invitePath={invitePath} />;
}
