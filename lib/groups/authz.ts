import { and, eq } from 'drizzle-orm';
import { getSessionUser, type SessionUser } from '../auth/session';
import type { Db } from '../db/client';
import { groups, memberships } from '../db/schema';
import { groupScope } from './validation';

/**
 * The contract every group route copies (TR-3): a caller is resolved from the request's own
 * session, a group is resolved from that caller's own membership, and the two ways of failing
 * are deliberately the same answer.
 *
 * Three things about the shape are load-bearing.
 *
 * The **scope is parsed first**. A malformed id never reaches a query and never gets a
 * different answer from a well-formed one that does not exist — `groupScope` failing is the
 * 404, not a 400 a prober could use to tell the two apart.
 *
 * The **membership is the lookup**. The guard joins the caller's membership to the group rather
 * than loading the group and then asking whether the caller may see it, so "no such group" and
 * "not a member" are one query returning no rows, one code path, and one message. There is no
 * branch for existence to leak through.
 *
 * The **failure carries nothing**. `not-found` has no group fields on it at all, so a caller
 * cannot accidentally render a name it should not have: the type is what stops the leak, not
 * the care of whoever writes the next page.
 */

export type GroupAccess =
  | { status: 'unauthenticated' }
  | { status: 'not-found' }
  | {
      status: 'ok';
      user: SessionUser;
      group: typeof groups.$inferSelect;
      membership: typeof memberships.$inferSelect;
    };

/**
 * Who is asking, and may they see this group. Signed out is 401-shaped; every other refusal is
 * the same 404 whether the group is absent, the id is malformed, or the caller is a stranger.
 */
export async function guardGroup(db: Db, rawGroupId: string): Promise<GroupAccess> {
  const scope = groupScope.safeParse(rawGroupId);
  if (!scope.success) return { status: 'not-found' };

  const user = await getSessionUser(db);
  if (!user) return { status: 'unauthenticated' };

  const [row] = await db
    .select({ group: groups, membership: memberships })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(and(eq(memberships.groupId, scope.data), eq(memberships.userId, user.id)))
    .limit(1);

  if (!row) return { status: 'not-found' };

  return { status: 'ok', user, group: row.group, membership: row.membership };
}

/**
 * The owner-only half: rename, archive, remove a member, and the invite link. A plain member
 * gets the same 404 as a stranger — the group's existence is something they already know, but
 * there is no reason for the refusal itself to describe which of the two they are, and staying
 * with one answer means no screen can be tempted to reveal the difference.
 */
export async function requireOwner(db: Db, rawGroupId: string): Promise<GroupAccess> {
  const access = await guardGroup(db, rawGroupId);
  if (access.status !== 'ok') return access;
  if (access.membership.role !== 'owner') return { status: 'not-found' };
  return access;
}
