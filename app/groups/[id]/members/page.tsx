import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { MembersScreen } from '../../../../components/members-screen';
import { withDb } from '../../../../lib/db/client';
import { guardGroup } from '../../../../lib/groups/authz';
import { computeNetBalances } from '../../../../lib/settle/balances';
import { listMembers } from '../../../../lib/groups/queries';
import {
  INVITE_NOTICE_PARAM,
  REMOVED_NOTICE_PARAM,
  inviteNoticeText,
  parseNoticeName,
} from '../../../../lib/groups/validation';

export const metadata: Metadata = { title: 'Members · Tabs' };

/**
 * The members route (TR-7, TR-11).
 *
 * Same guard, same 404 as the group itself: a member of the group sees it, a stranger does not
 * learn it exists.
 *
 * This file is only the route — the guard, the two reads, and the query the notices arrive on.
 * The screen itself lives in `components/members-screen.tsx`, because a page file may export only
 * `metadata` and `default` and the archived branches in that screen are worth a test that can
 * import them.
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
