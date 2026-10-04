import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { groups, memberships } from '../db/schema';

/**
 * The group reads the screens render. They sit beside the guard rather than inside the pages so
 * the listing rule — "you see only the groups you belong to" (TR-3) — is one query a test can
 * call, not a join re-typed into each Server Component where a missing `where` would look fine
 * on screen and leak nothing until somebody else's group appeared in the list.
 *
 * Nothing here decides access to a single group: that is `authz.ts`, and every write goes
 * through it. These are the two listings and the invite lookup, and the latter only resolves
 * a group a token already authorizes.
 */

export interface GroupSummary {
  id: string;
  name: string;
  currency: string;
  type: string;
  joinedAt: Date;
}

/**
 * The signed-in home list: the groups this user holds a membership in, newest membership first.
 * Archived groups are left out — archiving is what takes a group off this screen — but they
 * are still readable at their own URL, which is why the guard does not filter them.
 */
export async function listGroupsForUser(db: Db, userId: string): Promise<GroupSummary[]> {
  return db
    .select({
      id: groups.id,
      name: groups.name,
      currency: groups.currency,
      type: groups.type,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(and(eq(memberships.userId, userId), eq(groups.archived, false)))
    .orderBy(desc(memberships.createdAt), asc(groups.name));
}

export interface MemberRow {
  id: string;
  userId: string | null;
  displayName: string;
  role: string;
  createdAt: Date;
}

/**
 * Everyone in the group, earliest-joined first, which puts the owner at the top by construction
 * — and is the same order the leave path reads to find who inherits ownership. Placeholders
 * (a null `user_id`) sort in among the people, because that is what they are: a seat somebody
 * is holding.
 */
export async function listMembers(db: Db, groupId: string): Promise<MemberRow[]> {
  return db
    .select({
      id: memberships.id,
      userId: memberships.userId,
      displayName: memberships.displayName,
      role: memberships.role,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .where(eq(memberships.groupId, groupId))
    .orderBy(asc(memberships.createdAt), asc(memberships.id));
}

/** The group a live invite token points at, or null for unknown, disabled and archived alike. */
export async function findGroupByInviteToken(
  db: Db,
  token: string,
): Promise<typeof groups.$inferSelect | null> {
  const [group] = await db
    .select()
    .from(groups)
    .where(
      and(
        eq(groups.inviteToken, token),
        eq(groups.inviteEnabled, true),
        eq(groups.archived, false),
      ),
    )
    .limit(1);

  return group ?? null;
}
