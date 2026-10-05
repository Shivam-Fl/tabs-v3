import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import type { Db } from '../db/client';
import { sessions, users } from '../db/schema';
import { getEnv, isProduction } from '../env';
import { randomToken } from '../random';

/**
 * Opaque, server-side sessions (ADR-0003). The browser holds a random token; the database
 * holds only its hash, so a leaked dump cannot be replayed, and sign-out is a row delete —
 * which is the property a JWT cannot give without a denylist.
 *
 * The hash is peppered with SESSION_SECRET. That does two things: it makes the stored hash
 * useless to anyone who has the database but not the secret, and it gives the production-only
 * secret a live consumer rather than leaving it as a boot-time formality.
 */

export const SESSION_COOKIE = 'tabs_session';

/** 30 days, fixed: TR-6 asks for a durable session, and there is no sliding renewal in v1. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

/** 32 bytes of CSPRNG output, base64url — 256 bits, no padding for a cookie value. */
export const SESSION_TOKEN_BYTES = 32;

/** The session token, minted by the shared generator so invites and sessions cannot drift. */
export function mintToken(): string {
  return randomToken(SESSION_TOKEN_BYTES);
}

/** The signed-in identity every later scope reads. Never carries the password or the token. */
export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  currency: string;
}

export interface MintedSession {
  token: string;
  expiresAt: Date;
}

/**
 * The stored form of a token. SHA-256 is enough here where bcrypt is not: the token is 256
 * bits of uniform randomness, so there is no dictionary to slow down — the pepper is what
 * makes an offline guess impossible without the secret.
 */
export function hashToken(token: string, secret: string): string {
  return createHash('sha256').update(`${secret}:${token}`).digest('hex');
}

function sessionSecret(): string {
  return getEnv().SESSION_SECRET;
}

/**
 * The cookie flags, in one place so the unit suite can assert them and the two callers below
 * cannot drift. httpOnly keeps the token away from any script; SameSite=Lax still allows the
 * top-level redirect back from a link while blocking cross-site form posts; Secure is on in
 * production and off locally, because a Secure cookie is never sent over the QA box's http.
 */
export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction(),
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}

export async function mintSession(db: Db, userId: string): Promise<MintedSession> {
  const token = mintToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token, sessionSecret()),
    expiresAt,
  });
  return { token, expiresAt };
}

/**
 * The token, or null when it was never issued, was revoked, or has expired. Expiry is lazy:
 * the row is deleted the first time a stale token is presented rather than by a cleanup job,
 * which keeps the runner to one place (TR-1: no process outliving a request).
 */
export async function resolveSession(db: Db, token: string): Promise<SessionUser | null> {
  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      currency: users.currency,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token, sessionSecret())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, row.sessionId));
    return null;
  }

  return { id: row.id, email: row.email, displayName: row.displayName, currency: row.currency };
}

/** Sign-out. Idempotent: revoking a token that is already gone is a no-op, not an error. */
export async function revokeSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token, sessionSecret())));
}

// --- Cookie plumbing. Only Server Components and Server Actions may call these. ---

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE)?.value;
  return value ? value : null;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
}

/** The current request's signed-in user, or null. One query; no token means no query. */
export async function getSessionUser(db: Db): Promise<SessionUser | null> {
  const token = await readSessionToken();
  if (!token) return null;
  return resolveSession(db, token);
}
