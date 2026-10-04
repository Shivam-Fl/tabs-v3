'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { withDb } from '../db/client';
import { users } from '../db/schema';
import { hashPassword, verifyPasswordOrDummy } from './password';
import { checkRateLimit, clearRateLimit, clientIp, recordFailure } from './rate-limit';
import {
  clearSessionCookie,
  getSessionUser,
  mintSession,
  readSessionToken,
  revokeSession,
  setSessionCookie,
} from './session';
import {
  FIELD_MESSAGE,
  NEUTRAL_CREDENTIALS_MESSAGE,
  SIGNUP_SUCCESS_MESSAGE,
  THROTTLE_MESSAGE,
  fieldErrorsFrom,
  profileSchema,
  signinSchema,
  signupSchema,
  type AuthFormState,
} from './validation';

/**
 * The only HTTP entry points into auth. Every one of them opens exactly one database handle
 * through `withDb`, so the Neon Pool a request opens is closed before the request ends
 * (ADR-0002) — nothing here holds a client between requests.
 */

const UNIQUE_VIOLATION = '23505';
const DUPLICATE_KEY_MESSAGE = /duplicate key value|unique constraint/i;
const MAX_ERROR_CAUSES = 5;

/**
 * Postgres's unique violation, however the driver in front of it chose to wrap it. Drizzle
 * wraps a failed statement in its own error and hangs the driver's on `.cause`, so the code
 * and the constraint name are one or two links down the chain rather than on the error that
 * reaches us — checking only the top-level error would make the duplicate-email path throw
 * instead of answering neutrally.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_ERROR_CAUSES; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string' && DUPLICATE_KEY_MESSAGE.test(message)) return true;
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/**
 * Sign-up. Two things must be true at once and they pull in opposite directions: a real
 * account lands the user signed in, and a sign-up for an address that already exists must be
 * indistinguishable from one for a fresh address.
 *
 * The response is therefore byte-identical either way — same status, same message — and the
 * only difference is whether a session cookie came back. Reaching this through the unique
 * constraint rather than a lookup-first is deliberate: a pre-check would make the existing
 * case skip the hash and answer faster, and the constraint is the only version that is also
 * correct when two requests race the same address.
 */
export async function signup(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const ip = clientIp(await headers());

  // Sign-up is gated on the IP hint alone. Keying it on the email would buy nothing — the
  // address is the attacker's to choose — and would block an honest user who mistypes.
  if (checkRateLimit({ ip }).limited) {
    return { status: 'error', message: THROTTLE_MESSAGE };
  }

  const parsed = signupSchema.safeParse({
    email: field(formData, 'email'),
    password: field(formData, 'password'),
    displayName: field(formData, 'displayName'),
  });

  if (!parsed.success) {
    recordFailure({ ip });
    return { status: 'error', message: FIELD_MESSAGE, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const { email, password, displayName } = parsed.data;

  const token = await withDb(async (handle) => {
    // Hashed before the insert is attempted, so the duplicate path costs the same as the
    // fresh one — an early exit on a taken address would be a stopwatch oracle.
    const passwordHash = await hashPassword(password);

    try {
      const [created] = await handle.db
        .insert(users)
        .values({ email, passwordHash, displayName })
        .returning({ id: users.id });
      const session = await mintSession(handle.db, created.id);
      return session.token;
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  });

  if (token) await setSessionCookie(token);

  return { status: 'success', message: SIGNUP_SUCCESS_MESSAGE };
}

/**
 * Sign-in. Unknown address, wrong password and throttled all answer with a message that names
 * neither, and an unknown address still pays for a bcrypt comparison so it cannot be told
 * apart by how long the answer took.
 */
export async function signin(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const ip = clientIp(await headers());

  const parsed = signinSchema.safeParse({
    email: field(formData, 'email'),
    password: field(formData, 'password'),
  });

  // A malformed attempt is not a guess at a password, so it is answered neutrally without
  // spending a slot in the address's budget.
  if (!parsed.success) return { status: 'error', message: NEUTRAL_CREDENTIALS_MESSAGE };

  const { email, password } = parsed.data;
  const keys = { email, ip };

  if (checkRateLimit(keys).limited) {
    return { status: 'error', message: THROTTLE_MESSAGE };
  }

  const token = await withDb(async (handle) => {
    const [account] = await handle.db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    const matched = await verifyPasswordOrDummy(password, account?.passwordHash ?? null);
    if (!account || !matched) return null;

    const session = await mintSession(handle.db, account.id);
    return session.token;
  });

  if (token === null) {
    recordFailure(keys);
    return { status: 'error', message: NEUTRAL_CREDENTIALS_MESSAGE };
  }

  clearRateLimit({ email });
  await setSessionCookie(token);
  return { status: 'success', message: 'Signed in.' };
}

/** Sign-out: the row goes first, so a failure to clear the cookie still ends the session. */
export async function signOut(): Promise<void> {
  const token = await readSessionToken();
  if (token) {
    await withDb((handle) => revokeSession(handle.db, token));
  }
  await clearSessionCookie();
  redirect('/');
}

/**
 * Profile edit. The session user comes from the request's own cookie, never from the form, so
 * a form cannot address a row it does not own. A failed save reports by redirect rather than
 * by state: the profile form stays server-rendered, with redirect-based saved/invalid notices,
 * and its only client code is the Save button island (components/profile-save-button.tsx),
 * which holds the in-flight pending state a server render cannot.
 */
export async function updateProfile(formData: FormData): Promise<void> {
  const parsed = profileSchema.safeParse({
    displayName: field(formData, 'displayName'),
    currency: field(formData, 'currency'),
  });

  if (!parsed.success) redirect('/profile?error=invalid');

  const saved = await withDb(async (handle) => {
    const current = await getSessionUser(handle.db);
    if (!current) return false;

    await handle.db
      .update(users)
      .set({ displayName: parsed.data.displayName, currency: parsed.data.currency })
      .where(eq(users.id, current.id));
    return true;
  });

  if (!saved) redirect('/signin');

  revalidatePath('/profile');
  redirect('/profile?saved=1');
}
