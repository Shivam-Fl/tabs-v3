import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The group writes, driven the way a form drives them: `next/headers` is a cookie jar this test
 * owns, so session → guard → membership → transaction runs for real against the embedded
 * database. Only the browser is missing.
 *
 * Two modules are mocked, both to reach a state a passing run cannot: the balance seam, so a
 * non-zero balance can be forced through it (TR-9 is what will make that real), and the token
 * generator, so a rotation can be made to fail. Everything else is the shipped code path.
 */

const jar = vi.hoisted(() => ({ entries: new Map<string, string>() }));

const redirected = vi.hoisted(() => {
  class Redirected extends Error {
    constructor(readonly url: string) {
      super(`redirect:${url}`);
      this.name = 'Redirected';
    }
  }
  return { Redirected };
});

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.entries.has(name) ? { name, value: jar.entries.get(name) as string } : undefined,
    set: (name: string, value: string) => {
      jar.entries.set(name, value);
    },
    delete: (name: string) => {
      jar.entries.delete(name);
    },
  }),
  headers: async () => new Headers(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new redirected.Redirected(url);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('./members', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./members')>();
  return { ...actual, getMemberBalance: vi.fn(() => 0) };
});

vi.mock('./tokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tokens')>();
  return { ...actual, generateInviteToken: vi.fn(actual.generateInviteToken) };
});

const {
  addPlaceholder,
  archiveGroup,
  claimPlaceholder,
  createGroup,
  disableInvite,
  joinByToken,
  leaveGroup,
  removeMember,
  renameGroup,
  rotateInvite,
} = await import('./actions');
const { getMemberBalance } = await import('./members');
const { generateInviteToken } = await import('./tokens');
const { listGroupsForUser, listMembers } = await import('./queries');
const { randomToken } = await import('../random');
const { SESSION_COOKIE, mintSession } = await import('../auth/session');
const { hashPassword } = await import('../auth/password');
const { withDb } = await import('../db/client');
const { listMigrationFiles, runMigrations } = await import('../db/migrate');
const { activityEvents, groups, memberships, sessions, users } = await import('../db/schema');
const { ARCHIVED_GROUP_MESSAGE, GROUP_NOT_FOUND_MESSAGE, IDLE_GROUP_STATE, INVITE_INVALID_MESSAGE, INVITE_ROTATE_FAILED_MESSAGE, UNAUTHENTICATED_MESSAGE, parseNoticeName } = await import('./validation');

const PASSWORD = 'correct horse battery staple';

let passwordHash: string;
let ownerId: string;
let joinerId: string;
let thirdId: string;

async function createAccount(email: string, displayName: string): Promise<string> {
  const [user] = await withDb((handle) =>
    handle.db
      .insert(users)
      .values({ email, passwordHash, displayName })
      .returning({ id: users.id }),
  );
  return user.id;
}

async function signInAs(userId: string): Promise<void> {
  const { token } = await withDb((handle) => mintSession(handle.db, userId));
  jar.entries.set(SESSION_COOKIE, token);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** Runs an action that is expected to land the caller somewhere, and returns where. */
async function redirectUrl(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof redirected.Redirected) return error.url;
    throw error;
  }
  throw new Error('expected the action to redirect');
}

/** A group with an owner and a live invite token, written straight to the database. */
async function seedGroup(
  name = 'Goa trip',
  options: { archived?: boolean; inviteEnabled?: boolean } = {},
): Promise<{ groupId: string; token: string; ownerMembershipId: string }> {
  const token = randomToken();

  return withDb(async (handle) => {
    const [group] = await handle.db
      .insert(groups)
      .values({
        name,
        currency: 'INR',
        type: 'trip',
        inviteToken: token,
        inviteEnabled: options.inviteEnabled ?? true,
        archived: options.archived ?? false,
      })
      .returning();

    const [membership] = await handle.db
      .insert(memberships)
      .values({ groupId: group.id, userId: ownerId, displayName: 'Owner', role: 'owner' })
      .returning({ id: memberships.id });

    return { groupId: group.id, token, ownerMembershipId: membership.id };
  });
}

async function membersOf(groupId: string) {
  return withDb((handle) =>
    handle.db.select().from(memberships).where(eq(memberships.groupId, groupId)),
  );
}

async function eventsOf(groupId: string) {
  return withDb((handle) =>
    handle.db.select().from(activityEvents).where(eq(activityEvents.groupId, groupId)),
  );
}

/** Pins join order, so "earliest-joined" is the fixture's decision and not the clock's. */
async function pinJoinedAt(groupId: string, entries: Array<[string, string]>): Promise<void> {
  await withDb(async (handle) => {
    for (const [membershipId, at] of entries) {
      await handle.db
        .update(memberships)
        .set({ createdAt: new Date(at) })
        .where(and(eq(memberships.id, membershipId), eq(memberships.groupId, groupId)));
    }
  });
}

async function tokenOf(groupId: string): Promise<string | null> {
  const [group] = await withDb((handle) =>
    handle.db.select().from(groups).where(eq(groups.id, groupId)),
  );
  return group.inviteToken;
}

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-session-secret';
  passwordHash = await hashPassword(PASSWORD);
  await withDb((handle) => runMigrations(handle.db));
});

beforeEach(async () => {
  await withDb(async (handle) => {
    await handle.db.delete(activityEvents);
    await handle.db.delete(memberships);
    await handle.db.delete(sessions);
    await handle.db.delete(groups);
    await handle.db.delete(users);
  });
  jar.entries.clear();

  vi.mocked(getMemberBalance).mockReset();
  vi.mocked(getMemberBalance).mockReturnValue(0);
  vi.mocked(generateInviteToken).mockReset();
  vi.mocked(generateInviteToken).mockImplementation(() => randomToken());

  ownerId = await createAccount('owner@example.co', 'Ada');
  joinerId = await createAccount('joiner@example.co', 'Bo');
  thirdId = await createAccount('third@example.co', 'Cy');
});

describe('migration 0003', () => {
  it('is part of the shipped set and applies cleanly', async () => {
    const shipped = await listMigrationFiles();

    expect(shipped).toContain('0003_groups_memberships.sql');
    expect(await withDb((handle) => runMigrations(handle.db))).toEqual([]);
  });
});

describe('createGroup', () => {
  it('creates the group with the caller as owner and lands them on it', async () => {
    await signInAs(ownerId);

    const url = await redirectUrl(
      createGroup(IDLE_GROUP_STATE, form({ name: 'Goa trip', currency: 'INR', type: 'trip' })),
    );
    const groupId = url.replace('/groups/', '');

    const [group] = await withDb((handle) =>
      handle.db.select().from(groups).where(eq(groups.id, groupId)),
    );
    expect(group).toMatchObject({
      name: 'Goa trip',
      currency: 'INR',
      type: 'trip',
      archived: false,
      inviteEnabled: true,
    });
    // A group is born with a working link, or the members screen has nothing to hand out.
    expect(group.inviteToken).toBeTruthy();

    const members = await membersOf(groupId);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: ownerId, role: 'owner', displayName: 'Ada' });
  });

  it('defaults an omitted type to other rather than refusing the form', async () => {
    await signInAs(ownerId);

    const url = await redirectUrl(
      createGroup(IDLE_GROUP_STATE, form({ name: 'Flat', currency: 'EUR' })),
    );
    const [group] = await withDb((handle) =>
      handle.db.select().from(groups).where(eq(groups.id, url.replace('/groups/', ''))),
    );

    expect(group).toMatchObject({ type: 'other', currency: 'EUR' });
  });

  it('reports invalid input on its fields and creates nothing', async () => {
    await signInAs(ownerId);

    const state = await createGroup(
      IDLE_GROUP_STATE,
      form({ name: '  ', currency: 'BTC', type: 'safari' }),
    );

    expect(state.status).toBe('error');
    expect(state.fieldErrors).toMatchObject({
      name: expect.any(String),
      currency: expect.any(String),
      type: expect.any(String),
    });
    expect(await withDb((handle) => handle.db.select().from(groups))).toHaveLength(0);
  });

  it('refuses a signed-out caller', async () => {
    const state = await createGroup(IDLE_GROUP_STATE, form({ name: 'Sneaky', currency: 'INR' }));

    expect(state).toEqual({ status: 'error', message: UNAUTHENTICATED_MESSAGE });
    expect(await withDb((handle) => handle.db.select().from(groups))).toHaveLength(0);
  });
});

describe('group visibility', () => {
  it('lists a group for its members only', async () => {
    const { groupId } = await seedGroup();
    await withDb((handle) =>
      handle.db
        .insert(memberships)
        .values({ groupId, userId: joinerId, displayName: 'Bo', role: 'member' }),
    );

    const forOwner = await withDb((handle) => listGroupsForUser(handle.db, ownerId));
    const forJoiner = await withDb((handle) => listGroupsForUser(handle.db, joinerId));
    const forStranger = await withDb((handle) => listGroupsForUser(handle.db, thirdId));

    expect(forOwner.map((group) => group.id)).toEqual([groupId]);
    expect(forJoiner.map((group) => group.id)).toEqual([groupId]);
    expect(forStranger).toEqual([]);
  });

  it('leaves an archived group off the list while the membership remains', async () => {
    const { groupId } = await seedGroup('Old trip', { archived: true });

    expect(await withDb((handle) => listGroupsForUser(handle.db, ownerId))).toEqual([]);
    // Still a member of it: archiving is what takes it off the list, not a lost membership.
    expect(await membersOf(groupId)).toHaveLength(1);
  });
});

describe('owner-only writes', () => {
  let groupId: string;
  let token: string;
  let ownerMembershipId: string;

  beforeEach(async () => {
    ({ groupId, token, ownerMembershipId } = await seedGroup());
    // A plain member of the same group: the case that must not be able to do what the owner can.
    await withDb((handle) =>
      handle.db
        .insert(memberships)
        .values({ groupId, userId: joinerId, displayName: 'Bo', role: 'member' }),
    );
  });

  it('refuses rename, archive, remove, rotate and disable for a plain member', async () => {
    await signInAs(joinerId);

    const refusals = await Promise.all([
      renameGroup(IDLE_GROUP_STATE, form({ groupId, name: 'Taken over' })),
      archiveGroup(IDLE_GROUP_STATE, form({ groupId })),
      removeMember(IDLE_GROUP_STATE, form({ groupId, membershipId: ownerMembershipId })),
      rotateInvite(IDLE_GROUP_STATE, form({ groupId })),
      disableInvite(IDLE_GROUP_STATE, form({ groupId })),
    ]);

    for (const refusal of refusals) {
      expect(refusal).toEqual({ status: 'error', message: GROUP_NOT_FOUND_MESSAGE });
    }

    const [group] = await withDb((handle) =>
      handle.db.select().from(groups).where(eq(groups.id, groupId)),
    );
    expect(group).toMatchObject({ name: 'Goa trip', archived: false, inviteEnabled: true });
    expect(group.inviteToken).toBe(token);
    expect(await membersOf(groupId)).toHaveLength(2);
  });

  it('refuses the same writes for a signed-out caller, saying only that they must sign in', async () => {
    const state = await renameGroup(IDLE_GROUP_STATE, form({ groupId, name: 'Taken over' }));

    expect(state).toEqual({ status: 'error', message: UNAUTHENTICATED_MESSAGE });
  });

  it('renames for the owner', async () => {
    await signInAs(ownerId);

    const state = await renameGroup(IDLE_GROUP_STATE, form({ groupId, name: 'Goa 2026' }));

    expect(state.status).toBe('success');
    const [group] = await withDb((handle) =>
      handle.db.select().from(groups).where(eq(groups.id, groupId)),
    );
    expect(group.name).toBe('Goa 2026');
  });

  it('rejects a rename that breaks the boundary without touching the group', async () => {
    await signInAs(ownerId);

    const state = await renameGroup(IDLE_GROUP_STATE, form({ groupId, name: '   ' }));

    expect(state.fieldErrors?.name).toBeDefined();
    const [group] = await withDb((handle) =>
      handle.db.select().from(groups).where(eq(groups.id, groupId)),
    );
    expect(group.name).toBe('Goa trip');
  });

  it('archives for the owner and sends them back to the group with the notice', async () => {
    await signInAs(ownerId);

    const url = await redirectUrl(archiveGroup(IDLE_GROUP_STATE, form({ groupId })));

    // Archiving unmounts the settings section the confirming form lived in, so the success
    // confirmation travels to the page that can still show it (AC-11). The query is spelled out
    // because it is the contract between this action and the group page that reads it.
    expect(url).toBe(`/groups/${groupId}?archived=1`);

    const [group] = await withDb((handle) =>
      handle.db.select().from(groups).where(eq(groups.id, groupId)),
    );
    expect(group.archived).toBe(true);
    expect(await withDb((handle) => listGroupsForUser(handle.db, ownerId))).toEqual([]);
  });

});

describe('invite links', () => {
  let groupId: string;
  let token: string;

  beforeEach(async () => {
    ({ groupId, token } = await seedGroup());
  });

  it('lets a signed-in non-member join, and records it', async () => {
    await signInAs(joinerId);

    const url = await redirectUrl(joinByToken(IDLE_GROUP_STATE, form({ token })));

    expect(url).toBe(`/groups/${groupId}`);
    const members = await membersOf(groupId);
    expect(members).toHaveLength(2);
    expect(members.find((member) => member.userId === joinerId)).toMatchObject({
      role: 'member',
      displayName: 'Bo',
    });

    const events = await eventsOf(groupId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'join',
      actorUserId: joinerId,
      subjectUserId: joinerId,
      subjectName: 'Bo',
    });
    expect(events[0].createdAt).toBeInstanceOf(Date);
  });

  it('is a safe no-op when a member opens the link again', async () => {
    await signInAs(joinerId);
    await redirectUrl(joinByToken(IDLE_GROUP_STATE, form({ token })));

    const url = await redirectUrl(joinByToken(IDLE_GROUP_STATE, form({ token })));

    expect(url).toBe(`/groups/${groupId}`);
    expect(await membersOf(groupId)).toHaveLength(2);
    expect(await eventsOf(groupId)).toHaveLength(1);
  });

  it('refuses a token that is not a link, and one that was rotated away', async () => {
    await signInAs(joinerId);

    expect(await joinByToken(IDLE_GROUP_STATE, form({ token: ' ' }))).toEqual({
      status: 'error',
      message: INVITE_INVALID_MESSAGE,
    });

    await signInAs(ownerId);
    await rotateInvite(IDLE_GROUP_STATE, form({ groupId }));

    await signInAs(joinerId);
    expect(await joinByToken(IDLE_GROUP_STATE, form({ token }))).toEqual({
      status: 'error',
      message: INVITE_INVALID_MESSAGE,
    });
    expect(await membersOf(groupId)).toHaveLength(1);
  });

  it('works with the token rotation issued', async () => {
    await signInAs(ownerId);
    await rotateInvite(IDLE_GROUP_STATE, form({ groupId }));
    const rotated = await tokenOf(groupId);

    await signInAs(joinerId);
    await redirectUrl(joinByToken(IDLE_GROUP_STATE, form({ token: rotated as string })));

    expect(await membersOf(groupId)).toHaveLength(2);
  });

  it('rejects a join with a disabled link', async () => {
    await signInAs(ownerId);
    expect((await disableInvite(IDLE_GROUP_STATE, form({ groupId }))).status).toBe('success');

    await signInAs(joinerId);
    expect(await joinByToken(IDLE_GROUP_STATE, form({ token }))).toEqual({
      status: 'error',
      message: INVITE_INVALID_MESSAGE,
    });
    expect(await membersOf(groupId)).toHaveLength(1);
  });

  it('keeps the previous link working when rotation fails', async () => {
    await signInAs(ownerId);
    vi.mocked(generateInviteToken).mockImplementationOnce(() => {
      throw new Error('the generator failed');
    });

    const state = await rotateInvite(IDLE_GROUP_STATE, form({ groupId }));

    expect(state).toEqual({ status: 'error', message: INVITE_ROTATE_FAILED_MESSAGE });
    expect(await tokenOf(groupId)).toBe(token);

    await signInAs(joinerId);
    await redirectUrl(joinByToken(IDLE_GROUP_STATE, form({ token })));
    expect(await membersOf(groupId)).toHaveLength(2);
  });

  it('re-checks the link at submit time rather than trusting the page that rendered it', async () => {
    // The page resolved this token; the owner rotates before the visitor presses the button.
    await signInAs(joinerId);
    await signInAs(ownerId);
    await rotateInvite(IDLE_GROUP_STATE, form({ groupId }));

    await signInAs(joinerId);
    const state = await joinByToken(IDLE_GROUP_STATE, form({ token }));

    expect(state.status).toBe('error');
    expect(await membersOf(groupId)).toHaveLength(1);
  });
});

describe('claiming a seat', () => {
  let groupId: string;
  let token: string;
  let seatId: string;

  beforeEach(async () => {
    ({ groupId, token } = await seedGroup());
    await signInAs(ownerId);
    await addPlaceholder(IDLE_GROUP_STATE, form({ groupId, displayName: 'Bo' }));

    const members = await membersOf(groupId);
    seatId = members.find((member) => member.userId === null)?.id as string;
  });

  it('adopts the placeholder row as the join, with no second membership row', async () => {
    await signInAs(joinerId);

    const url = await redirectUrl(
      claimPlaceholder(IDLE_GROUP_STATE, form({ token, membershipId: seatId })),
    );

    expect(url).toBe(`/groups/${groupId}`);
    const members = await membersOf(groupId);
    expect(members).toHaveLength(2);

    const adopted = members.find((member) => member.id === seatId);
    // The same row, now theirs: everything recorded against the seat moved with it.
    expect(adopted).toMatchObject({ userId: joinerId, displayName: 'Bo' });
  });

  it('records the claim once, with its actor and a timestamp', async () => {
    await signInAs(joinerId);
    await redirectUrl(claimPlaceholder(IDLE_GROUP_STATE, form({ token, membershipId: seatId })));

    const events = await eventsOf(groupId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'claim', actorUserId: joinerId });
    expect(events[0].createdAt).toBeInstanceOf(Date);
  });

  it('sends a lost claim back to the join page with the seat-taken notice', async () => {
    await signInAs(joinerId);
    await redirectUrl(claimPlaceholder(IDLE_GROUP_STATE, form({ token, membershipId: seatId })));

    await signInAs(thirdId);
    const url = await redirectUrl(
      claimPlaceholder(IDLE_GROUP_STATE, form({ token, membershipId: seatId })),
    );

    // The rejection has to outlive the action's own revalidation, which refreshes this page to
    // a list without the seat and unmounts the form that used to hold the message. So it is
    // asserted as the URL the join page reads, spelling the query out: that string is the
    // contract between the two, and a change to either side has to fail here (AC-9).
    expect(url).toBe(`/join/${token}?claim=taken`);

    const members = await membersOf(groupId);
    expect(members).toHaveLength(2);
    // The seat stayed with the first claimant, and losing did not half-join the loser.
    expect(members.find((member) => member.id === seatId)?.userId).toBe(joinerId);
    expect(members.some((member) => member.userId === thirdId)).toBe(false);
  });

  it('sends a claim by somebody who is already in the group to the group page', async () => {
    await signInAs(joinerId);
    await redirectUrl(claimPlaceholder(IDLE_GROUP_STATE, form({ token, membershipId: seatId })));

    const url = await redirectUrl(
      claimPlaceholder(IDLE_GROUP_STATE, form({ token, membershipId: seatId })),
    );

    // Same landing as the page-load member bounce, so an already-member claim has one answer
    // whichever way it is reached.
    expect(url).toBe(`/groups/${groupId}`);
    expect(await membersOf(groupId)).toHaveLength(2);
  });

  it('rejects a claim against a seat in another group with the same notice', async () => {
    const other = await seedGroup('Other trip');
    await signInAs(thirdId);

    const url = await redirectUrl(
      claimPlaceholder(IDLE_GROUP_STATE, form({ token, membershipId: other.ownerMembershipId })),
    );

    // A seat this group does not have is a claim that failed, and says so the way a lost race
    // does rather than naming the other group.
    expect(url).toBe(`/join/${token}?claim=taken`);
    expect(await membersOf(other.groupId)).toHaveLength(1);
  });

  it('keeps a malformed claim on the page as an inline error', async () => {
    await signInAs(thirdId);

    // Input that never reached a seat cannot describe one, so there is nothing to redirect
    // back with — this stays on the form.
    const state = await claimPlaceholder(
      IDLE_GROUP_STATE,
      form({ token, membershipId: 'not-a-uuid' }),
    );

    expect(state).toEqual({ status: 'error', message: INVITE_INVALID_MESSAGE });
    expect(await membersOf(groupId)).toHaveLength(2);
  });

  it('rejects a claim through a link that is no longer live', async () => {
    await signInAs(ownerId);
    await disableInvite(IDLE_GROUP_STATE, form({ groupId }));

    await signInAs(joinerId);
    const state = await claimPlaceholder(IDLE_GROUP_STATE, form({ token, membershipId: seatId }));

    expect(state).toEqual({ status: 'error', message: INVITE_INVALID_MESSAGE });
    expect(await membersOf(groupId)).toHaveLength(2);
  });
});

describe('archived groups', () => {
  it('reject every write but leaving', async () => {
    const { groupId, token } = await seedGroup('Old trip', { archived: true });
    await withDb((handle) =>
      handle.db
        .insert(memberships)
        .values({ groupId, userId: joinerId, displayName: 'Bo', role: 'member' }),
    );

    await signInAs(ownerId);
    const archived = { status: 'error', message: ARCHIVED_GROUP_MESSAGE };
    expect(await renameGroup(IDLE_GROUP_STATE, form({ groupId, name: 'x' }))).toEqual(archived);
    expect(await archiveGroup(IDLE_GROUP_STATE, form({ groupId }))).toEqual(archived);
    expect(await rotateInvite(IDLE_GROUP_STATE, form({ groupId }))).toEqual(archived);
    expect(await disableInvite(IDLE_GROUP_STATE, form({ groupId }))).toEqual(archived);
    expect(await addPlaceholder(IDLE_GROUP_STATE, form({ groupId, displayName: 'Dee' }))).toEqual(
      archived,
    );

    await signInAs(thirdId);
    expect(await joinByToken(IDLE_GROUP_STATE, form({ token }))).toEqual({
      status: 'error',
      message: INVITE_INVALID_MESSAGE,
    });

    // Leaving is the exception: an archived group must still be possible to walk away from.
    await signInAs(joinerId);
    await redirectUrl(leaveGroup(IDLE_GROUP_STATE, form({ groupId })));
    expect(await membersOf(groupId)).toHaveLength(1);
  });
});

describe('removing and leaving', () => {
  let groupId: string;
  let seatId: string;

  beforeEach(async () => {
    ({ groupId } = await seedGroup());
    await withDb((handle) =>
      handle.db
        .insert(memberships)
        .values({ groupId, userId: joinerId, displayName: 'Bo', role: 'member' }),
    );
    const members = await membersOf(groupId);
    seatId = members.find((member) => member.userId === joinerId)?.id as string;
  });

  it('removes a member for the owner and records it in the same breath', async () => {
    await signInAs(ownerId);

    const url = await redirectUrl(
      removeMember(IDLE_GROUP_STATE, form({ groupId, membershipId: seatId })),
    );

    // The removed member's row held the form that would have shown this, so the note lands on
    // the member list the row was part of (AC-11) — asserted as the URL, the contract between
    // this action and the members page that reads it.
    expect(url).toBe(`/groups/${groupId}/members?removed=Bo`);
    expect(await membersOf(groupId)).toHaveLength(1);

    const events = await eventsOf(groupId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'remove',
      actorUserId: ownerId,
      subjectUserId: joinerId,
      subjectName: 'Bo',
    });
  });

  it('carries a name with spaces through the redirect and back out of the query', async () => {
    await withDb((handle) =>
      handle.db
        .insert(memberships)
        .values({ groupId, userId: thirdId, displayName: 'Dee Ann', role: 'member' }),
    );
    const dee = (await membersOf(groupId)).find((member) => member.userId === thirdId)?.id as string;

    await signInAs(ownerId);
    const url = await redirectUrl(
      removeMember(IDLE_GROUP_STATE, form({ groupId, membershipId: dee })),
    );

    // The two halves of one round trip: the action percent-encodes the name into the query and
    // the page's reader gets it back whole, with blank and absent values reading as no note.
    const carried = new URL(url, 'http://localhost').searchParams.get('removed');
    expect(carried).toBe('Dee Ann');
    expect(parseNoticeName(carried ?? undefined)).toBe('Dee Ann');
    expect(parseNoticeName(undefined)).toBeNull();
    expect(parseNoticeName('   ')).toBeNull();
  });

  it('asks the balance seam about the membership it is about to remove', async () => {
    await signInAs(ownerId);

    await redirectUrl(removeMember(IDLE_GROUP_STATE, form({ groupId, membershipId: seatId })));

    expect(getMemberBalance).toHaveBeenCalledWith(groupId, seatId);
  });

  it('sends a leaver home with the left group in the notice', async () => {
    await signInAs(joinerId);

    const url = await redirectUrl(leaveGroup(IDLE_GROUP_STATE, form({ groupId })));

    // Home is where leaving already landed; the note names the group that is now off the list.
    expect(url).toBe('/?left=Goa%20trip');
    expect(await membersOf(groupId)).toHaveLength(1);
    expect(await eventsOf(groupId)).toHaveLength(1);
  });

  it('blocks a removal whose balance is not zero, and says to settle up', async () => {
    await signInAs(ownerId);
    vi.mocked(getMemberBalance).mockReturnValue(1250);

    const state = await removeMember(IDLE_GROUP_STATE, form({ groupId, membershipId: seatId }));

    expect(state.status).toBe('error');
    expect(state.message).toMatch(/settle up/i);
    expect(await membersOf(groupId)).toHaveLength(2);
    expect(await eventsOf(groupId)).toHaveLength(0);
  });

  it('blocks a leave whose balance is not zero, inline and with nothing changed', async () => {
    await signInAs(joinerId);
    vi.mocked(getMemberBalance).mockReturnValue(-500);

    // Awaited directly: a refusal that redirected would throw instead of returning, so this
    // also pins that refusals stay on the form, which is still mounted to show them.
    const state = await leaveGroup(IDLE_GROUP_STATE, form({ groupId }));

    expect(state.status).toBe('error');
    expect(state.message).toMatch(/settle up/i);
    expect(await membersOf(groupId)).toHaveLength(2);
    expect(await eventsOf(groupId)).toHaveLength(0);
  });

  it('sends the owner who removes themselves to the leave flow instead', async () => {
    await signInAs(ownerId);
    const ownerMembershipId = (await membersOf(groupId)).find(
      (member) => member.userId === ownerId,
    )?.id as string;

    const state = await removeMember(
      IDLE_GROUP_STATE,
      form({ groupId, membershipId: ownerMembershipId }),
    );

    expect(state.status).toBe('error');
    expect(await membersOf(groupId)).toHaveLength(2);
  });

  it('hands ownership to the earliest-joined remaining member when the owner leaves', async () => {
    await withDb((handle) =>
      handle.db
        .insert(memberships)
        .values({ groupId, userId: thirdId, displayName: 'Cy', role: 'member' }),
    );

    // Join order pinned, so "earliest-joined" is decided by the fixture rather than by which
    // insert won the millisecond.
    const rows = await membersOf(groupId);
    await pinJoinedAt(groupId, [
      [rows.find((row) => row.userId === ownerId)?.id as string, '2026-01-01T00:00:00Z'],
      [seatId, '2026-01-02T00:00:00Z'],
      [rows.find((row) => row.userId === thirdId)?.id as string, '2026-01-03T00:00:00Z'],
    ]);

    await signInAs(ownerId);
    await redirectUrl(leaveGroup(IDLE_GROUP_STATE, form({ groupId })));

    const members = await withDb((handle) => listMembers(handle.db, groupId));
    expect(members).toHaveLength(2);
    expect(members.find((member) => member.id === seatId)?.role).toBe('owner');
    expect(members.find((member) => member.userId === thirdId)?.role).toBe('member');

    const events = await eventsOf(groupId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'leave', actorUserId: ownerId, subjectUserId: ownerId });
  });

  it('archives rather than handing the group to a placeholder when the owner leaves', async () => {
    // The only row left behind is a seat nobody has claimed, and a seat cannot own a group.
    await withDb((handle) =>
      handle.db.delete(memberships).where(eq(memberships.id, seatId)),
    );
    await withDb((handle) =>
      handle.db
        .insert(memberships)
        .values({ groupId, userId: null, displayName: 'Dee', role: 'member' }),
    );

    await signInAs(ownerId);
    await redirectUrl(leaveGroup(IDLE_GROUP_STATE, form({ groupId })));

    const [group] = await withDb((handle) =>
      handle.db.select().from(groups).where(eq(groups.id, groupId)),
    );
    expect(group.archived).toBe(true);
    expect(await membersOf(groupId)).toHaveLength(1);
  });

  it('archives the group when the last member leaves', async () => {
    await withDb((handle) => handle.db.delete(memberships).where(eq(memberships.id, seatId)));

    await signInAs(ownerId);
    await redirectUrl(leaveGroup(IDLE_GROUP_STATE, form({ groupId })));

    const [group] = await withDb((handle) =>
      handle.db.select().from(groups).where(eq(groups.id, groupId)),
    );
    expect(group.archived).toBe(true);
    expect(await membersOf(groupId)).toHaveLength(0);
    expect(await eventsOf(groupId)).toHaveLength(1);
  });
});
