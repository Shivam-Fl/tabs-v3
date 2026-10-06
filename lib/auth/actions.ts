'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { withDb } from '../db/client';
import { isUniqueViolation } from '../db/errors';
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
  PROFILE_REFUSAL_MESSAGE,
  SIGNUP_SUCCESS_MESSAGE,
  THROTTLE_MESSAGE,
  fieldErrorsFrom,
  profileSchema,
  signinSchema,
  signupSchema,
  type AuthFormState,
  type ProfileFormState,
} from './validation';

/**
 * The only HTTP entry points into auth. Every one of them opens exactly one database handle
 * through `withDb`, so the Neon Pool a request opens is closed before the request ends
 * (ADR-0002) — nothing here holds a client between requests.
 */

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
 * a form cannot address a row it does not own.
 *
 * A refusal is returned as state, not as a redirect (ADR-0008, conventions): a redirect would
 * remount the form and throw away exactly the submitted values a refused save has to keep
 * (AC-5, ui.md "failed saves never clear what the person typed"). Returning them inline is only
 * half of that — the state carries the submitted values back in `values`, because the island
 * renders from the *saved* props and would otherwise have nothing to restore the choice from.
 * Success still changes the page, so success still redirects with its notice — `?saved=1` is
 * untouched, and `?error=invalid` stays readable by the page for a direct hit.
 *
 * The `(previous, formData)` signature is what `useActionState` calls this with; nothing else
 * in the app calls it.
 */
export async function updateProfile(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const parsed = profileSchema.safeParse({
    displayName: field(formData, 'displayName'),
    currency: field(formData, 'currency'),
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: PROFILE_REFUSAL_MESSAGE,
      fieldErrors: fieldErrorsFrom(parsed.error),
      // The raw submitted strings, not the parsed ones — a refused save restores literally what
      // was chosen, and the parsed values are exactly what a refusal could not produce (they are
      // trimmed and upper-cased, and there are none at all for the field that failed). This is
      // the island's only source for them (AC-8, PR #44 BUG-1).
      values: {
        displayName: field(formData, 'displayName'),
        currency: field(formData, 'currency'),
      },
    };
  }

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