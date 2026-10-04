import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The guard, against a real database. `next/headers` is a cookie jar this test owns, so the
 * whole path — read the cookie, resolve the session, join the membership to the group — runs
 * as it does in a request; only the browser is missing.
 *
 * What these cases are really about is what a refusal *carries*. A 404 that differs by case is
 * the defect the whole module exists to prevent, so the assertions compare the three refusals
 * to each other rather than to a string.
 */

const jar = vi.hoisted(() => ({ entries: new Map<string, string>() }));

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

const { guardGroup, requireOwner } = await import('./authz');
const { SESSION_COOKIE, mintSession } = await import('../auth/session');
const { hashPassword } = await import('../auth/password');
const { withDb } = await import('../db/client');
const { runMigrations } = await import('../db/migrate');
const { activityEvents, groups, memberships, sessions, users } = await import('../db/schema');

const PASSWORD = 'correct horse battery staple';
const MALFORMED = 'not-a-uuid';
const MISSING = '11111111-2222-4333-8444-555555555555';

let passwordHash: string;
let ownerId: string;
let strangerId: string;
let groupId: string;
let ownerMembershipId: string;
let strangerMembershipId: string;

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

  ownerId = await createAccount('owner@example.co', 'Owner');
  strangerId = await createAccount('stranger@example.co', 'Stranger');

  ({ groupId, ownerMembershipId, strangerMembershipId } = await withDb(async (handle) => {
    const [group] = await handle.db
      .insert(groups)
      .values({ name: 'Goa trip', currency: 'INR', type: 'trip' })
      .returning({ id: groups.id });

    const [ownerMembership] = await handle.db
      .insert(memberships)
      .values({ groupId: group.id, userId: ownerId, displayName: 'Owner', role: 'owner' })
      .returning({ id: memberships.id });

    // A membership row in a *different* group, so "is a member of something" cannot be what
    // the guard is accidentally reading.
    const [other] = await handle.db
      .insert(groups)
      .values({ name: 'Flat', currency: 'INR', type: 'home' })
      .returning({ id: groups.id });

    const [strangerMembership] = await handle.db
      .insert(memberships)
      .values({ groupId: other.id, userId: strangerId, displayName: 'Stranger', role: 'owner' })
      .returning({ id: memberships.id });

    return {
      groupId: group.id,
      ownerMembershipId: ownerMembership.id,
      strangerMembershipId: strangerMembership.id,
    };
  }));
});

describe('guardGroup', () => {
  it('admits a member and hands back their own row', async () => {
    await signInAs(ownerId);

    const access = await withDb((handle) => guardGroup(handle.db, groupId));

    expect(access.status).toBe('ok');
    if (access.status !== 'ok') return;

    expect(access.group.id).toBe(groupId);
    expect(access.membership.id).toBe(ownerMembershipId);
    expect(access.user.id).toBe(ownerId);
  });

  it('answers an unknown group, a malformed id and a non-member identically', async () => {
    await signInAs(strangerId);

    const missing = await withDb((handle) => guardGroup(handle.db, MISSING));
    const malformed = await withDb((handle) => guardGroup(handle.db, MALFORMED));
    const forbidden = await withDb((handle) => guardGroup(handle.db, groupId));

    expect(missing).toEqual({ status: 'not-found' });
    expect(malformed).toEqual(missing);
    expect(forbidden).toEqual(missing);
  });

  it('carries no group data on a refusal, however it was reached', async () => {
    await signInAs(strangerId);

    const refusals = [
      await withDb((handle) => guardGroup(handle.db, MISSING)),
      await withDb((handle) => guardGroup(handle.db, MALFORMED)),
      await withDb((handle) => guardGroup(handle.db, groupId)),
    ];

    for (const refusal of refusals) {
      // Not just "no name": no group-shaped field at all, so nothing downstream can render one.
      expect(Object.keys(refusal)).toEqual(['status']);
      expect(JSON.stringify(refusal)).not.toContain('Goa');
    }
  });

  it('checks the id before it checks the session, so a malformed one is a 404 either way', async () => {
    jar.entries.clear();

    expect(await withDb((handle) => guardGroup(handle.db, MALFORMED))).toEqual({
      status: 'not-found',
    });
    expect(await withDb((handle) => guardGroup(handle.db, groupId))).toEqual({
      status: 'unauthenticated',
    });
  });

  it('answers a signed-out caller without a session at all', async () => {
    jar.entries.clear();

    const access = await withDb((handle) => guardGroup(handle.db, groupId));

    expect(access).toEqual({ status: 'unauthenticated' });
    expect(JSON.stringify(access)).not.toContain('Goa');
  });
});

describe('requireOwner', () => {
  it('admits the owner', async () => {
    await signInAs(ownerId);

    const access = await withDb((handle) => requireOwner(handle.db, groupId));

    expect(access.status).toBe('ok');
  });

  it('refuses a plain member with a refusal indistinguishable from a stranger’s', async () => {
    await withDb((handle) =>
      handle.db.insert(memberships).values({
        groupId,
        userId: strangerId,
        displayName: 'Stranger',
        role: 'member',
      }),
    );
    await signInAs(strangerId);

    const asMember = await withDb((handle) => requireOwner(handle.db, groupId));

    jar.entries.clear();
    const signedOut = await withDb((handle) => requireOwner(handle.db, groupId));
    await signInAs(ownerId);
    const asMissing = await withDb((handle) => requireOwner(handle.db, MISSING));

    // The member is refused the same way a stranger and a missing group are: the guard has one
    // answer for "not yours", and the screen that renders it says the same thing either way.
    expect(asMember).toEqual({ status: 'not-found' });
    expect(asMissing).toEqual(asMember);
    expect(signedOut).toEqual({ status: 'unauthenticated' });
  });

  it('still admits a member through guardGroup, so only owner work is closed', async () => {
    await withDb((handle) =>
      handle.db.insert(memberships).values({
        groupId,
        userId: strangerId,
        displayName: 'Stranger',
        role: 'member',
      }),
    );
    await signInAs(strangerId);

    expect((await withDb((handle) => guardGroup(handle.db, groupId))).status).toBe('ok');
    expect(strangerMembershipId).toBeDefined();
  });
});
