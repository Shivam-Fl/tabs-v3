import { z } from 'zod';
import { PASSWORD_MAX_BYTES } from './password';

/**
 * The one boundary every auth input crosses. `normalizeEmail` is called here and nowhere else,
 * so the lookup, the rate limiter and the uniqueness check all agree that ` Ada@X.CO ` and
 * `ada@x.co` are the same account — an address that normalizes differently in two places is
 * how one email ends up registered twice, or an enumeration guard ends up comparing the
 * attacker's spelling against a stored one it never matches.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** New profiles default to INR (project brief: the product's amounts are in paisa). */
export const DEFAULT_CURRENCY = 'INR';

/**
 * The currencies a profile may hold in v1. A currency is what amounts are formatted and
 * grouped by, so the set is closed rather than free text — the group tickets may widen it,
 * but until a formatter handles a code, accepting it would only store something nothing can
 * render. The column stays `text` so widening it is data, not a migration.
 */
export const SUPPORTED_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export function normalizeCurrency(raw: string): string {
  return raw.trim().toUpperCase();
}

export const PASSWORD_MIN_LENGTH = 8;

/**
 * The messages an attacker must not be able to tell apart. They live here, beside the schemas,
 * so the sign-in action and the sign-up action cannot drift into two slightly different
 * phrasings of "wrong credentials" — which is itself an oracle.
 */
export const NEUTRAL_CREDENTIALS_MESSAGE = 'Email or password is incorrect.';
export const SIGNUP_SUCCESS_MESSAGE = 'Account created.';
export const THROTTLE_MESSAGE = 'Too many attempts. Wait a moment and try again.';
export const FIELD_MESSAGE = 'Check the highlighted fields.';

const emailField = z
  .string()
  .transform(normalizeEmail)
  .pipe(z.email({ message: 'Enter a valid email address' }));

const passwordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .refine((value) => new TextEncoder().encode(value).length <= PASSWORD_MAX_BYTES, {
    message: `Password must be at most ${PASSWORD_MAX_BYTES} bytes`,
  });

const displayNameField = z
  .string()
  .trim()
  .min(1, 'Enter a display name')
  .max(80, 'Display name must be at most 80 characters');

export const signupSchema = z.object({
  email: emailField,
  password: passwordField,
  displayName: displayNameField,
});

/**
 * Sign-in validates the *shape* only; every failure above ends at the same neutral message, so
 * the messages on these fields are for a developer reading a log, never for the sign-in screen.
 */
export const signinSchema = z.object({
  email: emailField,
  password: z
    .string()
    .min(1, 'Enter your password')
    .refine((value) => new TextEncoder().encode(value).length <= PASSWORD_MAX_BYTES, {
      message: `Password must be at most ${PASSWORD_MAX_BYTES} bytes`,
    }),
});

export const profileSchema = z.object({
  displayName: displayNameField,
  currency: z
    .string()
    .transform(normalizeCurrency)
    .refine(
      (value): value is Currency => (SUPPORTED_CURRENCIES as readonly string[]).includes(value),
      { message: `Choose one of ${SUPPORTED_CURRENCIES.join(', ')}` },
    ),
});

/** Field name -> first message for it, in the shape the auth form island renders inline. */
export type FieldErrors = Record<string, string>;

export function fieldErrorsFrom(error: z.ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const [first] = issue.path;
    if (typeof first === 'string' && fieldErrors[first] === undefined) {
      fieldErrors[first] = issue.message;
    }
  }
  return fieldErrors;
}

/**
 * What an auth action hands back to the form island, and what the island renders. Declared
 * here rather than in the `'use server'` module so both sides import a type, not a value: a
 * server-action file may export only async functions.
 */
export interface AuthFormState {
  status: 'idle' | 'error' | 'success';
  message: string;
  fieldErrors?: FieldErrors;
}

export const IDLE_AUTH_STATE: AuthFormState = { status: 'idle', message: '' };

/**
 * The sentence a refused profile save reads, in one place (AC-5).
 *
 * It is both what the island renders under the fields it refused and what the page still renders
 * for a direct hit on `?error=invalid`, so the two cannot become two phrasings of the same
 * refusal. Kept beside the schema for the reason the auth messages are.
 */
export const PROFILE_REFUSAL_MESSAGE = 'Check the highlighted fields and try again.';

/**
 * The sentence a saved profile reads, in one place (AC-3).
 *
 * It is both what `updateProfile` hands back on success and what the island paints, so the two
 * cannot become two phrasings of the same confirmation — the same reason the auth messages above
 * are constants rather than string literals at their call sites.
 */
export const PROFILE_SAVED_MESSAGE = 'Profile saved.';

/** The values the two profile notice params carry. They are a closed set: the saved value is the
 * one the action used to redirect with, and the error value is what a bookmark of the old refusal
 * URL still spells. Anything else — forged, blank, or repeated — says nothing at all. */
export const PROFILE_SAVED_VALUE = '1';
export const PROFILE_ERROR_VALUE = 'invalid';

/** Which of the two notices the query carried, and the tone it wears. */
export interface ProfileNotice {
  tone: 'danger' | 'lent';
  text: string;
}

/**
 * The profile notice the URL is carrying, read the way every other notice is (ADR-0008): a closed
 * vocabulary in, one sentence out, and nothing for anything else.
 *
 * The page used to test these two params for truthiness, so `?saved=yes` rendered "Profile saved."
 * for a save that never happened and `?error=lol` rendered the refusal sentence for a refusal that
 * never happened. Both now cross this function, which is the only reader of either param.
 *
 * Its arguments are `unknown` rather than `string | undefined` on purpose: Next hands a repeated
 * param over as an array, and `['1']` is not the value it spells, so a repeated param renders
 * nothing instead of a sentence.
 *
 * Error is tested first because a URL carrying both is a refusal with a stale success beside it —
 * the one outcome the two must never render together (AC-3).
 */
export function profileNoticeText(params: {
  error?: unknown;
  saved?: unknown;
}): ProfileNotice | null {
  if (params.error === PROFILE_ERROR_VALUE) {
    return { tone: 'danger', text: PROFILE_REFUSAL_MESSAGE };
  }
  if (params.saved === PROFILE_SAVED_VALUE) {
    return { tone: 'lent', text: PROFILE_SAVED_MESSAGE };
  }
  return null;
}

/**
 * The two values the profile form displays, and the shape both the island and the page pass
 * around.
 *
 * `currency` is a plain string rather than `Currency` on purpose: a refusal holds the raw
 * submitted text, and only `profileFormDefaults` decides whether that is a code the select can
 * actually render. Typing it `Currency` here would assert a guarantee the raw value does not
 * carry, and the compiler would be right to reject it.
 */
export interface ProfileFormValues {
  displayName: string;
  currency: string;
}

/**
 * What `updateProfile` hands back to its island.
 *
 * Declared here rather than in the `'use server'` module beside it, for the same reason
 * `AuthFormState` is: a server-action file may export only async functions, so the island and
 * the action share the shape through this module.
 */
export interface ProfileFormState {
  status: 'idle' | 'error' | 'success';
  message: string;
  fieldErrors?: FieldErrors;
  /**
   * What was literally submitted, present only on a refusal (AC-8). The island has no other
   * source for it: the props it renders from are the values the database already holds, so a
   * form that repaints from those reverts the select to the saved currency and silently
   * discards the choice the person made.
   */
  values?: ProfileFormValues;
}

export const IDLE_PROFILE_STATE: ProfileFormState = { status: 'idle', message: '' };

/**
 * Which values the profile fields display, given the last action state and the saved props
 * (AC-8, PR #44 BUG-1).
 *
 * A refused save keeps exactly what was submitted — the empty display name *and* the currency
 * that was chosen — so the echoed values win over the saved props the render arrived with.
 * Display names are taken literally, empty ones included: an empty name is the refusal this
 * exists for, not a value to substitute.
 *
 * The one case the props win is a currency no select can offer. It is reachable only by a forged
 * POST (the dropdown offers exactly `SUPPORTED_CURRENCIES`), and painting it would leave the
 * styled select holding a value with no matching option, so the saved currency stands in and the
 * field error still names the valid choices.
 */
export function profileFormDefaults(
  state: ProfileFormState,
  saved: ProfileFormValues,
): ProfileFormValues {
  const submitted = state.status === 'error' ? state.values : undefined;
  if (submitted === undefined) return saved;

  const renderable = (SUPPORTED_CURRENCIES as readonly string[]).includes(submitted.currency);
  return {
    displayName: submitted.displayName,
    currency: renderable ? submitted.currency : saved.currency,
  };
}
