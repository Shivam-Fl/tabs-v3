import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The server actions, driven the way a form drives them. `next/headers` is replaced with a
 * cookie jar and a header set this test owns, so the whole round trip — read the cookie, hit
 * the database, set the cookie — runs for real against PGlite; only the browser is missing.
 *
 * Accounts the case is not *about* are inserted straight into the database with one hash made
 * once for the file, and sessions are minted directly: bcrypt is deliberately slow, and every
 * hash a test does not need is time stolen from the rest of the run.
 */

const jar = vi.hoisted(() => {
  const entries = new Map<string, string>();
  const writes: { name: string; value: string; options: Record<string, unknown> }[] = [];
  return { entries, writes };
});

const request = vi.hoisted(() => ({ headers: new Headers() }));

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
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      jar.entries.set(name, value);
      jar.writes.push({ name, value, options });
    },
    delete: (name: string) => {
      jar.entries.delete(name);
    },
  }),
  headers: async () => request.headers,
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new redirected.Redirected(url);
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { signin, signOut, signup, updateProfile } = await import('./actions');
const {
  IDLE_AUTH_STATE,
  IDLE_PROFILE_STATE,
  NEUTRAL_CREDENTIALS_MESSAGE,
  PROFILE_REFUSAL_MESSAGE,
  SIGNUP_SUCCESS_MESSAGE,
  THROTTLE_MESSAGE,
} = await import('./validation');
const { SESSION_COOKIE, hashToken, mintSession } = await import('./session');
const { EMAIL_FAILURE_LIMIT, IP_FAILURE_LIMIT, recordFailure } = await import('./rate-limit');
const { hashPassword } = await import('./password');
const { getEnv } = await import('../env');
const { withDb } = await import('../db/client');
const { runMigrations } = await import('../db/migrate');
const { sessions, users } = await import('../db/schema');

const PASSWORD = 'correct horse battery staple';

/**
 * The limiter's buckets are process-wide and outlive a case, exactly as they do in a running
 * server — so every case takes its own address and its own IP hint rather than assuming a
 * clean slate.
 */
let counter = 0;
function nextIdentity(): { email: string; ip: string } {
  counter += 1;
  return { email: `person-${counter}@example.co`, ip: `198.51.100.${counter % 250}` };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function countUsers(): Promise<number> {
  return withDb(async (handle) => (await handle.db.select().from(users)).length);
}

async function countSessions(): Promise<number> {
  return withDb(async (handle) => (await handle.db.select().from(sessions)).length);
}

let passwordHash: string;

async function createAccount(email: string, displayName = 'Ada'): Promise<string> {
  const [user] = await withDb((handle) =>
    handle.db
      .insert(users)
      .values({ email, passwordHash, displayName })
      .returning({ id: users.id }),
  );
  return user.id;
}

/** Puts a live session for `userId` in the request's jar, as a real sign-in would. */
async function signInAs(userId: string): Promise<void> {
  const { token } = await withDb((handle) => mintSession(handle.db, userId));
  jar.entries.set(SESSION_COOKIE, token);
}

function useIp(ip: string): void {
  request.headers = new Headers({ 'x-forwarded-for': ip });
}

function signUp(email: string, displayName = 'Ada') {
  return signup(IDLE_AUTH_STATE, form({ email, password: PASSWORD, displayName }));
}

function signIn(email: string, password: string) {
  return signin(IDLE_AUTH_STATE, form({ email, password }));
}

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-session-secret';
  passwordHash = await hashPassword(PASSWORD);
  await withDb((handle) => runMigrations(handle.db));
});

beforeEach(async () => {
  await withDb(async (handle) => {
    await handle.db.delete(sessions);
    await handle.db.delete(users);
  });
  jar.entries.clear();
  jar.writes.length = 0;
});

describe('signup', () => {
  it('creates the account, signs the new user in, and answers with the neutral success', async () => {
    const { email, ip } = nextIdentity();
    useIp(ip);

    const state = await signUp(email);

    expect(state).toEqual({ status: 'success', message: SIGNUP_SUCCESS_MESSAGE });
    expect(await countUsers()).toBe(1);
    expect(await countSessions()).toBe(1);

    const [write] = jar.writes;
    expect(write.name).toBe(SESSION_COOKIE);
    expect(write.options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
  });

  it('stores the address normalized, so one person has one account', async () => {
    const { email, ip } = nextIdentity();
    useIp(ip);

    await signUp(`  ${email.toUpperCase()}  `);

    const [row] = await withDb((handle) => handle.db.select().from(users));
    expect(row.email).toBe(email);
    expect(row.currency).toBe('INR');
    expect(row.passwordHash).not.toContain(PASSWORD);
  });

  it('answers a taken address byte-identically and creates no session', async () => {
    const { email, ip } = nextIdentity();
    useIp(ip);

    const first = await signUp(email, 'Ada');
    const [created] = await withDb((handle) => handle.db.select().from(users));
    const sessionsBefore = await countSessions();

    jar.entries.clear();
    jar.writes.length = 0;

    const second = await signUp(email, 'Someone Else');

    expect(second).toEqual(first);
    expect(await countUsers()).toBe(1);
    expect(await countSessions()).toBe(sessionsBefore);
    expect(jar.writes).toHaveLength(0);

    const [unchanged] = await withDb((handle) => handle.db.select().from(users));
    expect(unchanged).toMatchObject({ id: created.id, displayName: 'Ada' });
  });

  it('reports a malformed signup on the field it came from', async () => {
    const { ip } = nextIdentity();
    useIp(ip);

    const state = await signup(
      IDLE_AUTH_STATE,
      form({ email: 'not-an-email', password: 'short', displayName: '' }),
    );

    expect(state.status).toBe('error');
    expect(state.fieldErrors).toMatchObject({
      email: expect.stringMatching(/valid email/i),
      password: expect.stringContaining('at least 8'),
      displayName: expect.any(String),
    });
    expect(await countUsers()).toBe(0);
  });

  it('throttles sign-up from one address once its budget is spent', async () => {
    const { email, ip } = nextIdentity();
    useIp(ip);
    for (let attempt = 0; attempt < IP_FAILURE_LIMIT; attempt += 1) recordFailure({ ip });

    expect(await signUp(email)).toEqual({ status: 'error', message: THROTTLE_MESSAGE });
    expect(await countUsers()).toBe(0);
  });

  it('throttles headerless sign-up once the shared unknown budget is spent', async () => {
    // Unparseable forwarding headers make clientIp() answer null, and the header is the
    // caller's to choose — so the IP gate sign-up leans on entirely has to survive a null.
    request.headers = new Headers({ 'x-forwarded-for': 'not-an-address' });
    const { email } = nextIdentity();

    // Garbage headers alone block nobody while the shared budget is fresh.
    expect(await signUp(email)).toEqual({ status: 'success', message: SIGNUP_SUCCESS_MESSAGE });
    expect(await countUsers()).toBe(1);

    for (let attempt = 0; attempt < IP_FAILURE_LIMIT; attempt += 1) recordFailure({ ip: null });

    expect(await signUp(`second-${email}`)).toEqual({ status: 'error', message: THROTTLE_MESSAGE });
    expect(await countUsers()).toBe(1);
  });
});

describe('signin', () => {
  let email: string;

  beforeEach(async () => {
    const identity = nextIdentity();
    email = identity.email;
    useIp(identity.ip);
    await createAccount(email);
    // Every case here starts signed out: a session left in the jar by the setUp would let a
    // failing sign-in look like it worked.
    jar.entries.clear();
  });

  it('signs in with the right password and sets a fresh session', async () => {
    const state = await signIn(email, PASSWORD);

    expect(state.status).toBe('success');
    expect(jar.entries.get(SESSION_COOKIE)).toBeDefined();
    expect(await countSessions()).toBe(1);
  });

  it('answers an unknown address and a wrong password with the identical message', async () => {
    const unknown = await signIn('nobody@example.co', PASSWORD);
    const wrong = await signIn(email, 'not the password');

    expect(unknown).toEqual(wrong);
    expect(unknown).toEqual({ status: 'error', message: NEUTRAL_CREDENTIALS_MESSAGE });
    expect(jar.entries.has(SESSION_COOKIE)).toBe(false);
  });

  it('counts one address as one budget however it is spelled', async () => {
    const spelled = `  ${email.toUpperCase()}  `;
    for (let attempt = 0; attempt < EMAIL_FAILURE_LIMIT; attempt += 1) {
      recordFailure({ email: spelled });
    }

    // The budget is keyed on the normalized address, so failures charged under one spelling
    // spend another's — a limiter that keyed on the raw input would let anyone sidestep it by
    // capitalizing a letter, and the action normalizes before it asks the limiter anything.
    expect(await signIn(spelled, PASSWORD)).toEqual({ status: 'error', message: THROTTLE_MESSAGE });
  });

  it('throttles after five failures, and the throttle says nothing about the account', async () => {
    const before = await countSessions();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await signIn(email, 'wrong password')).toEqual({
        status: 'error',
        message: NEUTRAL_CREDENTIALS_MESSAGE,
      });
    }

    // The sixth attempt presents the *right* password and is still refused, and it opens no
    // session — throttling a correct password could walk around would not be throttling.
    expect(await signIn(email, PASSWORD)).toEqual({ status: 'error', message: THROTTLE_MESSAGE });
    expect(await countSessions()).toBe(before);
  });
});

describe('signOut', () => {
  it('deletes the row so the old token authorizes nothing, and signing in again works', async () => {
    const { email, ip } = nextIdentity();
    useIp(ip);
    const userId = await createAccount(email);
    await signInAs(userId);
    const token = jar.entries.get(SESSION_COOKIE) as string;

    await expect(signOut()).rejects.toBeInstanceOf(redirected.Redirected);

    expect(await countSessions()).toBe(0);
    expect(jar.entries.get(SESSION_COOKIE)).toBe('');
    const replayed = await withDb((handle) =>
      handle.db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token, getEnv().SESSION_SECRET))),
    );
    expect(replayed).toHaveLength(0);

    expect((await signIn(email, PASSWORD)).status).toBe('success');
  });

  it('is a no-op for a request with no cookie', async () => {
    await expect(signOut()).rejects.toBeInstanceOf(redirected.Redirected);
  });
});

describe('updateProfile', () => {
  let email: string;

  beforeEach(async () => {
    const identity = nextIdentity();
    email = identity.email;
    useIp(identity.ip);
    await signInAs(await createAccount(email));
  });

  it('writes the display name and currency for the signed-in user only', async () => {
    await expect(
      updateProfile(IDLE_PROFILE_STATE, form({ displayName: 'Ada Lovelace', currency: 'usd' })),
    ).rejects.toMatchObject({ url: '/profile?saved=1' });

    const [row] = await withDb((handle) => handle.db.select().from(users));
    expect(row).toMatchObject({ email, displayName: 'Ada Lovelace', currency: 'USD' });
  });

  it('answers a currency it cannot render with field errors instead of a redirect', async () => {
    // The refusal is the island's: it comes back as state so the form keeps what was typed,
    // which a redirect to `?error=invalid` could not do (ADR-0008).
    const [before] = await withDb((handle) => handle.db.select().from(users));

    const state = await updateProfile(
      IDLE_PROFILE_STATE,
      form({ displayName: 'Ada', currency: 'BTC' }),
    );

    expect(state).toMatchObject({ status: 'error', message: PROFILE_REFUSAL_MESSAGE });
    expect(state.fieldErrors?.currency).toBeDefined();

    const [row] = await withDb((handle) => handle.db.select().from(users));
    expect(row).toMatchObject({ currency: before.currency, displayName: before.displayName });
  });

  it('names the display name field when the name is the empty one', async () => {
    const state = await updateProfile(IDLE_PROFILE_STATE, form({ displayName: '', currency: 'USD' }));

    expect(state.status).toBe('error');
    expect(state.fieldErrors?.displayName).toBeDefined();
    expect(state.fieldErrors?.currency).toBeUndefined();
  });

  it('echoes the submitted values on a refusal, so the island can restore the chosen currency', async () => {
    // The regression PR #44 BUG-1 pinned: the island renders from the *saved* props, so a
    // refusal that does not carry the submission back has nothing to repaint the select from
    // and reverts it to the stored currency.
    const state = await updateProfile(IDLE_PROFILE_STATE, form({ displayName: '', currency: 'EUR' }));

    expect(state).toMatchObject({
      status: 'error',
      message: PROFILE_REFUSAL_MESSAGE,
      fieldErrors: { displayName: expect.any(String) },
      values: { displayName: '', currency: 'EUR' },
    });
    expect(state.fieldErrors?.currency).toBeUndefined();

    const [row] = await withDb((handle) => handle.db.select().from(users));
    expect(row).toMatchObject({ displayName: 'Ada', currency: 'INR' });
  });

  it('echoes what was submitted verbatim, not the normalized form of it', async () => {
    // A refusal restores literally what the person chose; a normalized echo would put a
    // different string back under the cursor than the one the field held.
    const state = await updateProfile(
      IDLE_PROFILE_STATE,
      form({ displayName: '  Ada  ', currency: 'bTc' }),
    );

    expect(state.values).toEqual({ displayName: '  Ada  ', currency: 'bTc' });
  });

  it('sends a caller with no session to sign in rather than updating anything', async () => {
    const userId = (await withDb((handle) => handle.db.select().from(users)))[0].id;
    jar.entries.clear();

    await expect(
      updateProfile(IDLE_PROFILE_STATE, form({ displayName: 'Someone Else', currency: 'USD' })),
    ).rejects.toMatchObject({ url: '/signin' });

    const [row] = await withDb(
      (handle) => handle.db.select().from(users).where(eq(users.id, userId)),
    );
    expect(row.displayName).toBe('Ada');
  });
});
