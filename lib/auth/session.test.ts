import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client';
import { runMigrations } from '../db/migrate';
import * as schema from '../db/schema';

const jar = vi.hoisted(() => {
  const entries = new Map<string, string>();
  const writes: { name: string; value: string; options: Record<string, unknown> }[] = [];
  return { entries, writes };
});

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.entries.has(name) ? { name, value: jar.entries.get(name) as string } : undefined,
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      jar.entries.set(name, value);
      jar.writes.push({ name, value, options });
    },
    delete: (name: string) => {
      jar.entries.delete(name);
    },
  }),
}));

const {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  SESSION_TOKEN_BYTES,
  clearSessionCookie,
  getSessionUser,
  hashToken,
  mintSession,
  mintToken,
  resolveSession,
  revokeSession,
  sessionCookieOptions,
  setSessionCookie,
} = await import('./session');
const { sessions, users } = await import('../db/schema');

const SECRET_ENV_BEFORE = process.env.SESSION_SECRET;
const PRODUCTION_ENV_BEFORE = process.env.VERCEL_ENV;

let db: Db;

async function createUser(email = 'ada@example.co') {
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: 'stored-hash', displayName: 'Ada' })
    .returning({ id: users.id, email: users.email, displayName: users.displayName, currency: users.currency });
  return user;
}

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-session-secret';
  delete process.env.VERCEL_ENV;
  db = drizzle(new PGlite(), { schema });
  await runMigrations(db);
});

afterAll(() => {
  if (SECRET_ENV_BEFORE === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = SECRET_ENV_BEFORE;
  if (PRODUCTION_ENV_BEFORE === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = PRODUCTION_ENV_BEFORE;
});

beforeEach(async () => {
  await db.delete(sessions);
  await db.delete(users);
  jar.entries.clear();
  jar.writes.length = 0;
});

describe('tokens', () => {
  it('mints 32 random bytes, encoded for a cookie', () => {
    const token = mintToken();

    expect(Buffer.from(token, 'base64url')).toHaveLength(SESSION_TOKEN_BYTES);
    expect(mintToken()).not.toBe(token);
  });

  it('peppers the stored hash with the secret, so the same token hashes differently under another secret', () => {
    const token = mintToken();

    expect(hashToken(token, 'secret-a')).not.toBe(hashToken(token, 'secret-b'));
    expect(hashToken(token, 'secret-a')).not.toContain(token);
  });
});

describe('the session lifecycle', () => {
  it('creates a session that resolves to its user and stores only the hash', async () => {
    const user = await createUser();
    const { token, expiresAt } = await mintSession(db, user.id);

    expect(await resolveSession(db, token)).toEqual({
      id: user.id,
      email: 'ada@example.co',
      displayName: 'Ada',
      currency: 'INR',
    });

    const [row] = await db.select().from(sessions);
    expect(row.tokenHash).toBe(hashToken(token, 'test-session-secret'));
    expect(row.tokenHash).not.toContain(token);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(SESSION_TTL_MS - 60_000);
  });

  it('authorizes nothing after sign-out, and signing in again works', async () => {
    const user = await createUser();
    const first = await mintSession(db, user.id);
    await revokeSession(db, first.token);
    expect(await resolveSession(db, first.token)).toBeNull();

    const second = await mintSession(db, user.id);
    expect(await resolveSession(db, second.token)).not.toBeNull();
  });

  it('revoking a token that is already gone is a no-op, not an error', async () => {
    await expect(revokeSession(db, mintToken())).resolves.toBeUndefined();
  });

  it('lazily deletes an expired session the first time it is presented', async () => {
    const user = await createUser();
    const token = mintToken();
    await db.insert(sessions).values({
      userId: user.id,
      tokenHash: hashToken(token, 'test-session-secret'),
      expiresAt: new Date(Date.now() - 1000),
    });

    expect(await resolveSession(db, token)).toBeNull();
    expect(await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token, 'test-session-secret')))).toHaveLength(0);
  });

  it('returns null for a token that was never issued', async () => {
    await createUser();
    expect(await resolveSession(db, mintToken())).toBeNull();
  });
});

describe('the session cookie', () => {
  it('is httpOnly, SameSite=Lax, path-wide, and lives exactly as long as the session', () => {
    expect(sessionCookieOptions()).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    });
  });

  it('is Secure once the app is running in production', () => {
    process.env.VERCEL_ENV = 'production';
    try {
      expect(sessionCookieOptions().secure).toBe(true);
    } finally {
      delete process.env.VERCEL_ENV;
    }
  });

  it('writes the token under the session cookie name', async () => {
    await setSessionCookie('a-token');

    expect(jar.entries.get(SESSION_COOKIE)).toBe('a-token');
    expect(jar.writes[0]).toMatchObject({ name: SESSION_COOKIE, value: 'a-token' });
  });

  it('clears it by expiring it, keeping the same flags', async () => {
    jar.entries.set(SESSION_COOKIE, 'a-token');

    await clearSessionCookie();

    expect(jar.entries.get(SESSION_COOKIE)).toBe('');
    expect(jar.writes[0]).toMatchObject({ name: SESSION_COOKIE, value: '', options: { maxAge: 0 } });
  });
});

describe('getSessionUser', () => {
  it('answers null when the request carries no cookie', async () => {
    await createUser();
    expect(await getSessionUser(db)).toBeNull();
  });

  it('answers the user for the request that holds their token', async () => {
    const user = await createUser();
    const { token } = await mintSession(db, user.id);
    jar.entries.set(SESSION_COOKIE, token);

    expect(await getSessionUser(db)).toMatchObject({ id: user.id, email: 'ada@example.co' });
  });

  it('answers null for a cookie holding a token that was never issued', async () => {
    await createUser();
    jar.entries.set(SESSION_COOKIE, 'forged');

    expect(await getSessionUser(db)).toBeNull();
  });
});
