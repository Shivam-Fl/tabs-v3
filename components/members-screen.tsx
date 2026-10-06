import { ArrowLeft, Users } from 'lucide-react';
import Link from 'next/link';
import type { GroupAccess } from '../lib/groups/authz';
import type { listMembers } from '../lib/groups/queries';
import { removedNoticeText } from '../lib/groups/validation';
import type { computeNetBalances } from '../lib/settle/balances';
import { AppShell } from './app-shell';
import {
  AddPlaceholderForm,
  CopyLinkButton,
  InvitePanel,
  MembersPanel,
} from './groups-panels';
import { Card, EmptyState } from './ui';

/**
 * Who is in this group and how new people join (TR-7, TR-11, AC-2).
 *
 * It lives here rather than in `app/groups/[id]/members/page.tsx` because the page is the one
 * seam that cannot be imported: Next rejects any named export but `metadata` and `default` from a
 * page file at build time, so a screen with a branch worth testing has to sit in a component
 * module the page — and the test — can both reach. The page stays the thin wrapper that guards the
 * route and loads the reads.
 *
 * It is a server component: everything in it is markup the server can render, and the client
 * islands it composes (the panels) receive nothing but plain data. The props are the page's
 * types, unchanged, so the wrapper passes what it loaded straight through.
 *
 * The three archived exceptions are the same fact seen three times — an archived group is
 * read-only, so nothing here may offer a control that cannot work (AC-2). The invite panel says
 * it once and offers nothing; the solo-owner prompt to share a link is suppressed, because the
 * read-only seats note below already carries what an archived group needs and a sharing prompt
 * beside it would be inviting someone to an action that returns nothing; and the add-a-seat form
 * is replaced by the note that seats cannot be added.
 */
export function MembersScreen({
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
  // An archived group has nobody to invite and no working link to share, so it is never the
  // solo-owner case ui.md's empty state describes, however few members it has (AC-2).
  const soloOwner = isOwner && members.length === 1 && !group.archived;

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
          {/* The label is its own box rather than a bare text node: this link is a flex container,
              and a flex item's automatic minimum size is its min-content width — an 80-character
              unbroken name would hold that at the full string and widen the page. `min-w-0` lets
              the box take the width the phone gives it and `break-words` (inherited) wraps the
              name inside it, so the destination is still named in full (AC-1, AC-2). */}
          <span className="min-w-0 break-words">{`Back to ${group.name}`}</span>
        </Link>

        <header className="flex flex-col gap-2">
          <h1 className="text-page font-semibold text-ink break-words">{group.name}</h1>
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
                archived={group.archived}
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
                  the invite link is offered, and only while it is live (AC-2). An archived group
                  is excluded rather than shown copy with no action: the seats note below is the
                  whole of what an archived group needs to say. */}
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

        {/* The same wrapping treatment as the top link, one class deep: `overflow-wrap` inherits,
            so the `<p>` carries it and the inline `<a>` inside it wraps with it (AC-1, AC-2). */}
        <p className="text-body text-ink-muted break-words">
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
