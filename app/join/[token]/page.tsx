import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AppShell } from '../../../components/app-shell';
import { JoinPanel } from '../../../components/groups-panels';
import { Card } from '../../../components/ui';
import { getSessionUser } from '../../../lib/auth/session';
import { withDb } from '../../../lib/db/client';
import { memberships } from '../../../lib/db/schema';
import { findGroupByInviteToken } from '../../../lib/groups/queries';
import {
  CLAIM_NOTICE_PARAM,
  CLAIM_TAKEN,
  GROUP_TYPE_LABELS,
  SEAT_TAKEN_MESSAGE,
  type GroupType,
} from '../../../lib/groups/validation';

export const metadata: Metadata = { title: 'Join a group · Tabs' };

/**
 * Where an invite link lands (IAC-2, AC-3).
 *
 * The token is resolved on the server, every time: unknown, disabled, rotated and archived all
 * render the same 404 rather than an explanation, because the difference between them is the
 * owner's business and not a stranger's. Signed out, the visitor is sent to sign in with the
 * link as the way back — not to a dead end — so the invitation survives authentication.
 *
 * A signed-in non-member chooses between two things that look similar and are not: claiming a
 * seat somebody already added for them (which adopts that row, and everything recorded on it)
 * or joining as a new member.
 *
 * A losing claim arrives back here with `?claim=taken` (AC-9). It is read and rendered rather
 * than acted on: the seat is gone, so the panel simply says why and offers the plain join that
 * was always the other half of this page.
 */
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ claim?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const claimNotice = query[CLAIM_NOTICE_PARAM] === CLAIM_TAKEN ? SEAT_TAKEN_MESSAGE : null;

  const resolved = await withDb(async (handle) => {
    const group = await findGroupByInviteToken(handle.db, token);
    if (!group) return { kind: 'invalid' as const };

    const user = await getSessionUser(handle.db);
    if (!user) return { kind: 'signed-out' as const };

    const [mine] = await handle.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.groupId, group.id), eq(memberships.userId, user.id)))
      .limit(1);

    if (mine) return { kind: 'member' as const, groupId: group.id };

    const seats = await handle.db
      .select({ id: memberships.id, displayName: memberships.displayName })
      .from(memberships)
      .where(and(eq(memberships.groupId, group.id), isNull(memberships.userId)))
      .orderBy(asc(memberships.createdAt), asc(memberships.id));

    return { kind: 'join' as const, group, seats, userName: user.displayName };
  });

  if (resolved.kind === 'invalid') notFound();
  if (resolved.kind === 'signed-out') {
    redirect(`/signin?next=${encodeURIComponent(`/join/${token}`)}`);
  }
  if (resolved.kind === 'member') redirect(`/groups/${resolved.groupId}`);

  const { group, seats, userName } = resolved;

  return (
    <AppShell place={group.name} viewer={{ displayName: userName }}>
      <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center gap-5 px-4 py-5">
        <div className="flex flex-col gap-2">
          {/* The heading names the group in full, so an 80-character unbroken name wraps inside
              the phone rather than setting the document width — the same one-class treatment as
              the group page's h1, whose truncated ellipsis would stop saying which group the page
              is about (AC-1). */}
          <h1 className="text-page font-semibold text-ink break-words">Join {group.name}</h1>
          <p className="text-body text-ink-muted">
            {GROUP_TYPE_LABELS[group.type as GroupType] ?? group.type} · {group.currency} · invited
            by link
          </p>
        </div>

        {/* The same Card the rest of the app's panels sit on, and the same tokens as the
            JoinPanel inside it — the invitation should look like the app it is inviting you
            into, not like a form that arrived from somewhere else (AC-9). */}
        <Card>
          <JoinPanel
            token={token}
            groupName={group.name}
            claimNotice={claimNotice}
            seats={seats.map((seat) => ({
              id: seat.id,
              displayName: seat.displayName,
              matchesYou: seat.displayName.trim().toLowerCase() === userName.trim().toLowerCase(),
            }))}
          />
        </Card>

        <p className="text-body text-ink-muted">
          <Link className="text-accent underline underline-offset-4" href="/">
            Not now — back to your groups
          </Link>
        </p>
      </main>
    </AppShell>
  );
}
