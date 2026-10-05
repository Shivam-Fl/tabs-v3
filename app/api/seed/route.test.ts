import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  listActivityGroups,
  listGroupActivity,
  listUserActivity,
  type ActivityRow,
} from '../../../lib/activity/queries';
import { withDb } from '../../../lib/db/client';
import { runMigrations } from '../../../lib/db/migrate';
import { activityEvents, users } from '../../../lib/db/schema';
import { SEED_ACCOUNTS, SEED_REQUEST_HEADER, SEED_REQUEST_VALUE } from '../../../lib/seed/fixtures';
import { POST } from './route';

/**
 * The dev-only seed route, called as a request rather than as a function.
 *
 * The route is the reason the fixtures can reach a browser at all: with the embedded database,
 * the rows only exist in the process that wrote them, and this is the door `scripts/seed.ts`
 * knocks on. So the cases here are about the door — that production cannot open it, that a
 * request without the seed header cannot, and that opening it leaves the instance's own feeds
 * non-empty rather than merely leaving rows in tables.
 */

function seedRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/seed', {
    method: 'POST',
    headers: { [SEED_REQUEST_HEADER]: SEED_REQUEST_VALUE, ...headers },
  });
}

async function counts(): Promise<{ users: number; activity: number }> {
  return withDb(async (handle) => ({
    users: (await handle.db.select({ id: users.id }).from(users)).length,
    activity: (await handle.db.select({ id: activityEvents.id }).from(activityEvents)).length,
  }));
}

/** Every activity row the fixture wrote, in the order it was written. */
async function writtenOrder(): Promise<{ kind: string; createdAt: number }[]> {
  return withDb(async (handle) => {
    const rows = await handle.db
      .select({ kind: activityEvents.kind, createdAt: activityEvents.createdAt })
      .from(activityEvents);

    return rows
      .map((row) => ({ kind: row.kind, createdAt: row.createdAt.getTime() }))
      .sort((left, right) => left.createdAt - right.createdAt);
  });
}

beforeAll(async () => {
  await withDb((handle) => runMigrations(handle.db));
});

beforeEach(async () => {
  // A clean slate with no fixtures in it: the route's own wipe is what the cases observe.
  await withDb(async (handle) => {
    await handle.db.delete(activityEvents);
    await handle.db.delete(users);
  });
});

afterEach(() => {
  delete process.env.VERCEL_ENV;
});

describe('POST /api/seed', () => {
  it('refuses a production deployment before it touches the database', async () => {
    // Something of the caller's own, which the loader would delete if it ran at all.
    await withDb((handle) =>
      handle.db
        .insert(users)
        .values({ email: 'marker@example.co', passwordHash: 'x', displayName: 'Marker' }),
    );

    process.env.VERCEL_ENV = 'production';
    const response = await POST(seedRequest());
    // Cleared before the assertion below, because a production process is one this test cannot
    // open a connection in either — which is itself part of what the refusal buys.
    delete process.env.VERCEL_ENV;

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ status: 'refused' });
    expect(await counts()).toEqual({ users: 1, activity: 0 });
  });

  it('refuses a request that does not carry the seed header', async () => {
    const response = await POST(seedRequest({ [SEED_REQUEST_HEADER]: '' }));

    expect(response.status).toBe(403);
    expect(await counts()).toEqual({ users: 0, activity: 0 });
  });

  it('loads the fixture set in the serving process and reports what it wrote', async () => {
    const response = await POST(seedRequest());

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(await counts()).toEqual({ users: body.users, activity: body.activity });
    expect(body).toMatchObject({ users: SEED_ACCOUNTS.length, groups: 2 });
  });

  it('leaves every account’s own feeds non-empty, not merely rows in tables', async () => {
    await POST(seedRequest());

    for (const account of SEED_ACCOUNTS) {
      const read = await withDb(async (handle) => {
        const [user] = await handle.db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, account.email));
        const groups = await listActivityGroups(handle.db, user.id);

        const perGroup: ActivityRow[][] = [];
        for (const group of groups) {
          perGroup.push(await listGroupActivity(handle.db, group.id, 'all'));
        }

        return { groups, perGroup, crossGroup: await listUserActivity(handle.db, user.id, 'all') };
      });

      expect(read.groups.length).toBeGreaterThan(0);
      for (const rows of read.perGroup) expect(rows.length).toBeGreaterThan(0);
      expect(read.crossGroup.length).toBeGreaterThan(0);
    }
  });

  it('reloads to the same fixture set on a second call', async () => {
    const first = (await (await POST(seedRequest())).json()) as Record<string, number>;
    const second = (await (await POST(seedRequest())).json()) as Record<string, number>;

    expect(second).toEqual(first);
    expect(await counts()).toEqual({ users: first.users, activity: first.activity });
  });

  it('staggers the timestamps oldest-first, so both feeds read chronologically', async () => {
    await POST(seedRequest());

    const written = await writtenOrder();
    const moments = new Set(written.map((row) => row.createdAt));
    expect(moments.size).toBe(written.length);

    // The fixture opens with the first join and closes with the flat's payment.
    expect(written[0].kind).toBe('join');
    expect(written[written.length - 1].kind).toBe('payment-created');

    // And the reader agrees about the order those instants put the rows in: the second group's
    // three events came out newest-first as its payment, its expense, then the join that opened it.
    const kinds = await withDb(async (handle) => {
      const [ada] = await handle.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, SEED_ACCOUNTS[0].email));
      const groups = await listActivityGroups(handle.db, ada.id);
      const flat = groups.find((group) => group.name === 'Flat 4B');
      return (await listGroupActivity(handle.db, flat?.id ?? '', 'all')).map((row) => row.kind);
    });

    expect(kinds).toEqual(['payment-created', 'expense-created', 'join']);
  });
});
