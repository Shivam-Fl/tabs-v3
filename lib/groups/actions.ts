'use server';

import { and, asc, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getSessionUser } from '../auth/session';
import { fieldErrorsFrom } from '../auth/validation';
import { withDb } from '../db/client';
import { isUniqueViolation } from '../db/errors';
import { activityEvents, groups, memberships } from '../db/schema';
import { guardGroup, requireOwner, type GroupAccess } from './authz';
import { NonZeroBalanceError, assertZeroBalance, getMemberBalance } from './members';
import { findGroupByInviteToken } from './queries';
import { generateInviteToken } from './tokens';
import {
  ALREADY_MEMBER_MESSAGE,
  ARCHIVED_GROUP_MESSAGE,
  ARCHIVED_NOTICE,
  ARCHIVED_NOTICE_PARAM,
  CHECK_FIELDS_MESSAGE,
  CLAIM_NOTICE_PARAM,
  CLAIM_TAKEN,
  GROUP_NOT_FOUND_MESSAGE,
  INVITE_DISABLED,
  INVITE_DISABLED_NOTICE,
  INVITE_INVALID_MESSAGE,
  INVITE_NOTICE_PARAM,
  INVITE_ROTATE_FAILED_MESSAGE,
  INVITE_ROTATED,
  INVITE_ROTATED_NOTICE,
  LEFT_NOTICE_PARAM,
  REMOVED_NOTICE_PARAM,
  SEAT_TAKEN_MESSAGE,
  SELF_REMOVE_MESSAGE,
  UNAUTHENTICATED_MESSAGE,
  addPlaceholderSchema,
  archivedNoticeText,
  claimPlaceholderSchema,
  createGroupSchema,
  joinByTokenSchema,
  leftNoticeText,
  membershipScope,
  removedNoticeText,
  renameGroupSchema,
  type GroupActionState,
} from './validation';

/**
 * Every write to a group, in one audited module (TR-3, TR-7).
 *
 * The shape is the same for all of them, and it is the shape the TRD states — the caller comes
 * from the request's own session, the group comes through the guard, and the input crosses a
 * zod boundary — so there is no action here where the answer to "who may do this?" is written
 * anywhere but in `authz.ts`.
 *
 * Each action opens exactly one database handle through `withDb`, so the pool a request opens
 * is closed before the request ends (ADR-0002), and every change it makes and the activity row
 * that records it commit in one transaction: a membership cannot move without the feed saying
 * so, and the feed cannot claim something the membership table disagrees with.
 *
 * Actions that change a screen's data return a `GroupActionState` for their island to render.
 * The ones whose success takes the page they were on with it — create, join, claim, leave,
 * remove and archive — redirect instead, and the success notice travels as a query on the page
 * they land on, because the form that would have held the message is unmounted by the change
 * itself (AC-9, AC-11).
 *
 * Rotate and disable redirect too, for a different reason: their forms do stay mounted, but the
 * two successes share one slot, and an inline answer per form cannot express "replace", only
 * "stack" (AC-13). They ride the same members-page query, so the later outcome is the only one
 * left to render. Refusals still return state and stay inline everywhere, because the form that
 * shows them is never the thing the refusal unmounts.
 */

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/** The three refusals every action can answer with, so no two of them read differently. */
const UNAUTHENTICATED_STATE: GroupActionState = {
  status: 'error',
  message: UNAUTHENTICATED_MESSAGE,
};
const NOT_FOUND_STATE: GroupActionState = { status: 'error', message: GROUP_NOT_FOUND_MESSAGE };
const ARCHIVED_STATE: GroupActionState = { status: 'error', message: ARCHIVED_GROUP_MESSAGE };

/** A guard result that is not `ok`, said the way a caller sees it. */
function refusal(access: GroupAccess): GroupActionState {
  return access.status === 'unauthenticated' ? UNAUTHENTICATED_STATE : NOT_FOUND_STATE;
}

interface Outcome {
  state: GroupActionState;
  /** Where a successful action sends the caller, when staying put no longer makes sense. */
  redirectTo?: string;
  /** The group the outcome changed, so the screens that render it are refreshed. */
  groupId?: string;
}

function finish(outcome: Outcome): GroupActionState {
  if (outcome.redirectTo) redirect(outcome.redirectTo);
  return outcome.state;
}

function groupPath(groupId: string): string {
  return `/groups/${groupId}`;
}

/** Where a lost claim sends the loser: back to the join page, which renders the notice (AC-9). */
function claimTakenPath(token: string): string {
  return `/join/${encodeURIComponent(token)}?${CLAIM_NOTICE_PARAM}=${CLAIM_TAKEN}`;
}

/** Where a successful remove sends the owner: the members page, which renders the note (AC-11). */
function removedNoticePath(groupId: string, memberName: string): string {
  return `${groupPath(groupId)}/members?${REMOVED_NOTICE_PARAM}=${encodeURIComponent(memberName)}`;
}

/** Where a successful archive sends the owner: the group, whose banner the note sits beside. */
function archivedNoticePath(groupId: string): string {
  return `${groupPath(groupId)}?${ARCHIVED_NOTICE_PARAM}=${ARCHIVED_NOTICE}`;
}

/** Where leaving lands: home, carrying the name of the group that was left. */
function leftNoticePath(groupName: string): string {
  return `/?${LEFT_NOTICE_PARAM}=${encodeURIComponent(groupName)}`;
}

/**
 * Where a successful invite change sends the owner: the members page, whose panel renders the
 * one notice (AC-13). Both outcomes use this one parameter, which is what makes their notices
 * replace each other rather than accumulate.
 */
function inviteNoticePath(groupId: string, notice: string): string {
  return `${groupPath(groupId)}/members?${INVITE_NOTICE_PARAM}=${notice}`;
}

/** The group list and the group's own pages, refreshed after anything that changes them. */
function revalidateGroup(groupId?: string): void {
  revalidatePath('/');
  if (groupId) {
    revalidatePath(groupPath(groupId));
    revalidatePath(`${groupPath(groupId)}/members`);
  }
}

// --- Create, rename, archive ---

export async function createGroup(
  _previous: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const parsed = createGroupSchema.safeParse({
    name: field(formData, 'name'),
    currency: field(formData, 'currency'),
    type: field(formData, 'type'),
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: CHECK_FIELDS_MESSAGE,
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const created = await withDb(async (handle) => {
    const user = await getSessionUser(handle.db);
    if (!user) return null;

    return handle.db.transaction(async (tx) => {
      const [group] = await tx
        .insert(groups)
        .values({
          name: parsed.data.name,
          currency: parsed.data.currency,
          type: parsed.data.type,
          // A group is created with a working link: the members screen's whole job is to hand
          // one out, and a group whose owner had to rotate before anybody could join would be
          // one step of ceremony with no purpose.
          inviteToken: generateInviteToken(),
          inviteEnabled: true,
        })
        .returning({ id: groups.id });

      await tx.insert(memberships).values({
        groupId: group.id,
        userId: user.id,
        displayName: user.displayName,
        role: 'owner',
      });

      return group.id;
    });
  });

  if (created === null) return UNAUTHENTICATED_STATE;

  revalidateGroup(created);
  return finish({ state: { status: 'success', message: 'Group created.' }, redirectTo: groupPath(created) });
}

export async function renameGroup(
  _previous: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const parsed = renameGroupSchema.safeParse({ name: field(formData, 'name') });

  if (!parsed.success) {
    return {
      status: 'error',
      message: CHECK_FIELDS_MESSAGE,
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const state = await withDb(async (handle) => {
    const access = await requireOwner(handle.db, field(formData, 'groupId'));
    if (access.status !== 'ok') return refusal(access);
    if (access.group.archived) return ARCHIVED_STATE;

    await handle.db
      .update(groups)
      .set({ name: parsed.data.name, updatedAt: new Date() })
      .where(eq(groups.id, access.group.id));

    return { status: 'success', message: `Renamed to ${parsed.data.name}.` } as GroupActionState;
  });

  revalidateGroup(field(formData, 'groupId'));
  return state;
}

export async function archiveGroup(
  _previous: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const outcome = await withDb(async (handle): Promise<Outcome> => {
    const access = await requireOwner(handle.db, field(formData, 'groupId'));
    if (access.status !== 'ok') return { state: refusal(access) };
    if (access.group.archived) return { state: ARCHIVED_STATE };

    // One-way in this ticket: archiving hides the group from the home list and turns its writes
    // off. Members keep read access at the group's own URL.
    await handle.db
      .update(groups)
      .set({ archived: true, updatedAt: new Date() })
      .where(eq(groups.id, access.group.id));

    return {
      state: { status: 'success', message: archivedNoticeText(access.group.name) },
      // Archiving is what removes the settings section this form lives in, so the confirmation
      // cannot stay here. It goes to the group page, where the read-only banner it belongs
      // beside is about to appear.
      redirectTo: archivedNoticePath(access.group.id),
    };
  });

  revalidateGroup(field(formData, 'groupId'));
  return finish(outcome);
}

// --- Members ---

export async function addPlaceholder(
  _previous: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const parsed = addPlaceholderSchema.safeParse({ displayName: field(formData, 'displayName') });

  if (!parsed.success) {
    return {
      status: 'error',
      message: CHECK_FIELDS_MESSAGE,
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const state = await withDb(async (handle) => {
    // Any member may hold a seat for somebody (the work order's first assumption); only the
    // owner-only actions below go through `requireOwner`.
    const access = await guardGroup(handle.db, field(formData, 'groupId'));
    if (access.status !== 'ok') return refusal(access);
    if (access.group.archived) return ARCHIVED_STATE;

    await handle.db.insert(memberships).values({
      groupId: access.group.id,
      userId: null,
      displayName: parsed.data.displayName,
      role: 'member',
    });

    return {
      status: 'success',
      message: `Added ${parsed.data.displayName}. Share the invite link so they can claim the seat.`,
    } as GroupActionState;
  });

  revalidateGroup(field(formData, 'groupId'));
  return state;
}

export async function removeMember(
  _previous: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const membershipId = membershipScope.safeParse(field(formData, 'membershipId'));
  if (!membershipId.success) return NOT_FOUND_STATE;

  const outcome = await withDb(async (handle): Promise<Outcome> => {
    const access = await requireOwner(handle.db, field(formData, 'groupId'));
    if (access.status !== 'ok') return { state: refusal(access) };
    if (access.group.archived) return { state: ARCHIVED_STATE };

    const [target] = await handle.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, membershipId.data), eq(memberships.groupId, access.group.id)))
      .limit(1);

    // A member id that is not in *this* group is not a member of it, and says so the same way
    // a group the caller cannot see does.
    if (!target) return { state: NOT_FOUND_STATE };
    if (target.userId === access.user.id) {
      return { state: { status: 'error', message: SELF_REMOVE_MESSAGE } };
    }

    try {
      assertZeroBalance(getMemberBalance(access.group.id, target.id), target.displayName);
    } catch (error) {
      if (error instanceof NonZeroBalanceError) {
        // Refusals stay on the form, which is still mounted — only success unmounts it.
        return { state: { status: 'error', message: error.message } };
      }
      throw error;
    }

    await handle.db.transaction(async (tx) => {
      await tx.delete(memberships).where(eq(memberships.id, target.id));
      await tx.insert(activityEvents).values({
        groupId: access.group.id,
        actorUserId: access.user.id,
        subjectUserId: target.userId,
        subjectName: target.displayName,
        kind: 'remove',
      });
    });

    return {
      state: {
        status: 'success',
        message: removedNoticeText(target.displayName, access.group.name),
      },
      // The removed member's row *was* the form that would have shown this: it is gone by the
      // time the message exists, so the note goes to the member list the row was part of.
      redirectTo: removedNoticePath(access.group.id, target.displayName),
    };
  });

  revalidateGroup(field(formData, 'groupId'));
  return finish(outcome);
}

export async function leaveGroup(
  _previous: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const outcome = await withDb(async (handle): Promise<Outcome> => {
    // Leaving is the one write an archived group still accepts.
    const access = await guardGroup(handle.db, field(formData, 'groupId'));
    if (access.status !== 'ok') return { state: refusal(access) };

    const { group, membership, user } = access;

    try {
      assertZeroBalance(getMemberBalance(group.id, membership.id), membership.displayName);
    } catch (error) {
      if (error instanceof NonZeroBalanceError) {
        return { state: { status: 'error', message: error.message } };
      }
      throw error;
    }

    await handle.db.transaction(async (tx) => {
      const remaining = await tx
        .select({
          id: memberships.id,
          userId: memberships.userId,
          displayName: memberships.displayName,
          role: memberships.role,
        })
        .from(memberships)
        .where(eq(memberships.groupId, group.id))
        .orderBy(asc(memberships.createdAt), asc(memberships.id));

      const others = remaining.filter((row) => row.id !== membership.id);
      // Ownership only ever passes to somebody who can hold it, so a group of placeholders
      // cannot inherit an owner — and a group nobody owns is archived rather than orphaned.
      const heir = others.find((row) => row.userId !== null);

      await tx.delete(memberships).where(eq(memberships.id, membership.id));

      if (!heir) {
        await tx
          .update(groups)
          .set({ archived: true, updatedAt: new Date() })
          .where(eq(groups.id, group.id));
      } else if (membership.role === 'owner') {
        await tx
          .update(memberships)
          .set({ role: 'owner', updatedAt: new Date() })
          .where(eq(memberships.id, heir.id));
      }

      await tx.insert(activityEvents).values({
        groupId: group.id,
        actorUserId: user.id,
        subjectUserId: user.id,
        subjectName: membership.displayName,
        kind: 'leave',
      });
    });

    // Home is where leaving already landed; the notice rides along, because the members page
    // the form lived on is not a page the caller is a member of any more.
    return {
      state: { status: 'success', message: leftNoticeText(group.name) },
      redirectTo: leftNoticePath(group.name),
    };
  });

  revalidateGroup(field(formData, 'groupId'));
  return finish(outcome);
}

// --- Invite links ---

export async function rotateInvite(
  _previous: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const groupId = field(formData, 'groupId');

  const outcome = await withDb(async (handle): Promise<Outcome> => {
    const access = await requireOwner(handle.db, groupId);
    if (access.status !== 'ok') return { state: refusal(access) };
    if (access.group.archived) return { state: ARCHIVED_STATE };

    try {
      // One statement: either the row carries the new token or it still carries the old one.
      // A failure here is why the caller is told the current link still works, and it is true.
      await handle.db
        .update(groups)
        .set({ inviteToken: generateInviteToken(), inviteEnabled: true, updatedAt: new Date() })
        .where(eq(groups.id, access.group.id));
    } catch {
      // A refusal stays on the form, which is still mounted to show it.
      return { state: { status: 'error', message: INVITE_ROTATE_FAILED_MESSAGE } };
    }

    // Success, unlike the refusals above, is a notice the panel has to share with the other
    // invite outcome: it rides the query so a later disable replaces it rather than joining it
    // on screen (AC-13).
    return {
      state: { status: 'success', message: INVITE_ROTATED_NOTICE },
      redirectTo: inviteNoticePath(access.group.id, INVITE_ROTATED),
    };
  });

  revalidateGroup(groupId);
  return finish(outcome);
}

export async function disableInvite(
  _previous: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const groupId = field(formData, 'groupId');

  const outcome = await withDb(async (handle): Promise<Outcome> => {
    const access = await requireOwner(handle.db, groupId);
    if (access.status !== 'ok') return { state: refusal(access) };
    if (access.group.archived) return { state: ARCHIVED_STATE };

    // The token stays on the row; the enabled flag is what a joiner is checked against, so
    // re-enabling later is another rotate rather than a lost secret to recover.
    await handle.db
      .update(groups)
      .set({ inviteEnabled: false, updatedAt: new Date() })
      .where(eq(groups.id, access.group.id));

    // Same one slot as rotate: disabling replaces the rotate notice instead of stacking on it.
    return {
      state: { status: 'success', message: INVITE_DISABLED_NOTICE },
      redirectTo: inviteNoticePath(access.group.id, INVITE_DISABLED),
    };
  });

  revalidateGroup(groupId);
  return finish(outcome);
}

// --- Joining through a link ---

/**
 * Joining without claiming a seat: a fresh membership row. A member who opens the link again
 * is a safe no-op — not an error, because a link posted in a group chat is opened twice by
 * ordinary people — and the unique `(group_id, user_id)` is what makes that true even when two
 * tabs race, rather than a check that two requests can both pass.
 */
export async function joinByToken(
  _previous: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const parsed = joinByTokenSchema.safeParse({ token: field(formData, 'token') });
  if (!parsed.success) return { status: 'error', message: INVITE_INVALID_MESSAGE };

  const outcome = await withDb(async (handle): Promise<Outcome> => {
    const user = await getSessionUser(handle.db);
    if (!user) return { state: UNAUTHENTICATED_STATE };

    // Re-resolved at submit time, not trusted from the page that rendered the button: a link
    // disabled or rotated between load and click must not still work.
    const group = await findGroupByInviteToken(handle.db, parsed.data.token);
    if (!group) return { state: { status: 'error', message: INVITE_INVALID_MESSAGE } };

    const alreadyIn = await handle.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.groupId, group.id), eq(memberships.userId, user.id)))
      .limit(1);

    if (alreadyIn.length > 0) {
      return {
        state: { status: 'success', message: ALREADY_MEMBER_MESSAGE },
        redirectTo: groupPath(group.id),
        groupId: group.id,
      };
    }

    try {
      await handle.db.transaction(async (tx) => {
        await tx.insert(memberships).values({
          groupId: group.id,
          userId: user.id,
          displayName: user.displayName,
          role: 'member',
        });
        await tx.insert(activityEvents).values({
          groupId: group.id,
          actorUserId: user.id,
          subjectUserId: user.id,
          subjectName: user.displayName,
          kind: 'join',
        });
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // The other tab got there first. That is the same outcome, not a failure.
    }

    return {
      state: { status: 'success', message: `You joined ${group.name}.` },
      redirectTo: groupPath(group.id),
      groupId: group.id,
    };
  });

  revalidateGroup(outcome.groupId);
  return finish(outcome);
}

/**
 * Claiming a seat *is* joining (AC-3). The update adopts the placeholder row — the same row
 * everything already recorded against that seat points at — and `user_id IS NULL` in the
 * WHERE clause is what makes it atomic: of two people claiming the same seat, exactly one
 * gets a row back. A member who already holds a membership here cannot take a second one,
 * and the unique `(group_id, user_id)` is what enforces that even under a race.
 *
 * Whoever loses — the second claimer of the seat, or somebody who already holds a membership —
 * is sent somewhere that can still tell them so: back to the join page with the notice in its
 * query (AC-9), or on to the group they are already in.
 */
export async function claimPlaceholder(
  _previous: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const parsed = claimPlaceholderSchema.safeParse({
    token: field(formData, 'token'),
    membershipId: field(formData, 'membershipId'),
  });

  if (!parsed.success) return { status: 'error', message: INVITE_INVALID_MESSAGE };

  const outcome = await withDb(async (handle): Promise<Outcome> => {
    const user = await getSessionUser(handle.db);
    if (!user) return { state: UNAUTHENTICATED_STATE };

    const group = await findGroupByInviteToken(handle.db, parsed.data.token);
    if (!group) return { state: { status: 'error', message: INVITE_INVALID_MESSAGE } };

    const alreadyIn = await handle.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.groupId, group.id), eq(memberships.userId, user.id)))
      .limit(1);

    // Already a member is the same landing the join page gives somebody who opens the link
    // twice: the group, not an error, because there is nothing left for them to do here.
    if (alreadyIn.length > 0) {
      return {
        state: { status: 'success', message: ALREADY_MEMBER_MESSAGE },
        redirectTo: groupPath(group.id),
        groupId: group.id,
      };
    }

    try {
      const adopted = await handle.db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(memberships)
          // The seat takes the person's own name once there is a person: the row keeps its id
          // (so everything recorded for the seat is now theirs) and stops reading as a stranger.
          .set({ userId: user.id, displayName: user.displayName, updatedAt: new Date() })
          .where(
            and(
              eq(memberships.id, parsed.data.membershipId),
              eq(memberships.groupId, group.id),
              isNull(memberships.userId),
            ),
          )
          .returning({ id: memberships.id, displayName: memberships.displayName });

        if (!claimed) return null;

        await tx.insert(activityEvents).values({
          groupId: group.id,
          actorUserId: user.id,
          subjectUserId: user.id,
          subjectName: claimed.displayName,
          kind: 'claim',
        });

        return claimed;
      });

      // Somebody got there first. The refusal is a redirect rather than returned state because
      // this action's own revalidation refreshes the join page to a list without this seat, and
      // the form that would render the message unmounts with the seat — the loser would see the
      // page simply come back blank. The notice rides the URL back to that page instead.
      if (!adopted) {
        return {
          state: { status: 'error', message: SEAT_TAKEN_MESSAGE },
          redirectTo: claimTakenPath(parsed.data.token),
        };
      }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // The unique (group_id, user_id) says this person already holds a seat here — the race
      // equivalent of the check above, and it lands them in the same place.
      return {
        state: { status: 'success', message: ALREADY_MEMBER_MESSAGE },
        redirectTo: groupPath(group.id),
        groupId: group.id,
      };
    }

    return {
      state: {
        status: 'success',
        message: `You claimed ${user.displayName} and joined ${group.name}.`,
      },
      redirectTo: groupPath(group.id),
      groupId: group.id,
    };
  });

  revalidateGroup(outcome.groupId);
  return finish(outcome);
}
