import { z } from 'zod';
import {
  SUPPORTED_CURRENCIES,
  normalizeCurrency,
  type Currency,
  type FieldErrors,
} from '../auth/validation';

/**
 * The one boundary every group input crosses. Trim and normalize happen here and nowhere else,
 * so the group the form created and the group the next request looks up are the same string —
 * the same rule `lib/auth/validation.ts` applies to an email.
 *
 * Nothing in this module reads the database or the session: a schema that knows who is asking
 * is a schema that cannot be tested without one.
 */

export type { FieldErrors };

/** TRD is silent on the cap; 1–80 mirrors the display-name rule the profile already enforces. */
export const GROUP_NAME_MAX = 80;
export const PLACEHOLDER_NAME_MAX = 80;

/** The closed set from the spec. `other` is the default a form that omits the field gets. */
export const GROUP_TYPES = ['trip', 'home', 'couple', 'other'] as const;
export type GroupType = (typeof GROUP_TYPES)[number];
export const DEFAULT_GROUP_TYPE: GroupType = 'other';

export const GROUP_TYPE_LABELS: Record<GroupType, string> = {
  trip: 'Trip',
  home: 'Home',
  couple: 'Couple',
  other: 'Other',
};

/** The two roles the TRD names. Stored as text so widening them is data, not a migration. */
export const GROUP_ROLES = ['owner', 'member'] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

/**
 * The member events this slice records (AC-8). Anything an expense or a payment does to a feed
 * belongs to their tickets — this list is closed on purpose, so the writer in `actions.ts` and
 * the reader TR-10 will add agree on what a member row can be.
 */
export const MEMBERSHIP_EVENTS = ['join', 'claim', 'leave', 'remove'] as const;
export type MembershipEvent = (typeof MEMBERSHIP_EVENTS)[number];

/**
 * The messages a caller sees. They live beside the schemas for the reason the auth ones do:
 * two call sites cannot drift into two phrasings of "that group is not available", and the
 * 404 must read identically whether the group is missing or the caller is not a member.
 */
export const GROUP_NOT_FOUND_MESSAGE = 'That group is not available.';
export const UNAUTHENTICATED_MESSAGE = 'Sign in to continue.';
export const CHECK_FIELDS_MESSAGE = 'Check the highlighted fields.';
export const ARCHIVED_GROUP_MESSAGE =
  'This group is archived, so it cannot be changed. You can still leave it.';
export const INVITE_INVALID_MESSAGE = 'This invite link is no longer valid.';
export const ALREADY_MEMBER_MESSAGE = 'You are already in this group.';
export const SEAT_TAKEN_MESSAGE = 'That seat has already been claimed.';
export const SELF_REMOVE_MESSAGE = 'Use Leave group to remove your own membership.';
export const INVITE_ROTATE_FAILED_MESSAGE =
  'The invite link could not be replaced. The current link still works.';

/**
 * A trim that cannot be walked around by a caller that skips the form: every name the product
 * stores is trimmed, because ` Ada` and `Ada ` render identically and would sort apart.
 */
const trimmed = z.string().transform((value) => value.trim());

const groupName = trimmed
  .refine((value) => value.length > 0, { message: 'Enter a group name' })
  .refine((value) => value.length <= GROUP_NAME_MAX, {
    message: `Group name must be at most ${GROUP_NAME_MAX} characters`,
  });

const placeholderName = trimmed
  .refine((value) => value.length > 0, { message: 'Enter a name for this member' })
  .refine((value) => value.length <= PLACEHOLDER_NAME_MAX, {
    message: `Name must be at most ${PLACEHOLDER_NAME_MAX} characters`,
  });

const groupCurrency = z
  .string()
  .transform(normalizeCurrency)
  .refine(
    (value): value is Currency => (SUPPORTED_CURRENCIES as readonly string[]).includes(value),
    { message: `Choose one of ${SUPPORTED_CURRENCIES.join(', ')}` },
  );

/** Absent, blank or explicit — the form's select is pre-selected, and a caller may omit it. */
const groupType = z
  .string()
  .optional()
  .transform((value) => (value ?? '').trim().toLowerCase() || DEFAULT_GROUP_TYPE)
  .refine((value): value is GroupType => (GROUP_TYPES as readonly string[]).includes(value), {
    message: `Choose one of ${GROUP_TYPES.join(', ')}`,
  });

const inviteToken = trimmed
  .refine((value) => value.length > 0, { message: INVITE_INVALID_MESSAGE })
  .refine((value) => value.length <= 128, { message: INVITE_INVALID_MESSAGE });

/**
 * A group id as it arrives from a URL or a form field. Nothing carries a message: the guard
 * answers a malformed id with the same 404 a missing group gets, so the reason never reaches
 * a caller — an id that is not a uuid is one more way to say "no such group".
 */
export const groupScope = z.uuid();

/** A membership id, used the same way: invalid and absent are both "no such member". */
export const membershipScope = z.uuid();

export const createGroupSchema = z.object({
  name: groupName,
  currency: groupCurrency,
  type: groupType,
});

export const renameGroupSchema = z.object({ name: groupName });

export const addPlaceholderSchema = z.object({ displayName: placeholderName });

export const joinByTokenSchema = z.object({ token: inviteToken });

export const claimPlaceholderSchema = z.object({
  token: inviteToken,
  membershipId: membershipScope,
});

/**
 * Where sign-in may send somebody afterwards, once they are in.
 *
 * Only a path on this origin is accepted, and the two shapes that would escape it are refused
 * explicitly: `//evil.example` is a protocol-relative URL a browser reads as another host, and
 * a backslash is normalized to a slash by every browser, so `/\evil.example` is the same
 * attack spelled differently. A value that fails is dropped — never echoed into a redirect —
 * which is what keeps the invite token out of an open-redirect oracle (TR-6).
 */
export function isSameOriginPath(value: string): boolean {
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  if (value.includes('\\')) return false;
  return true;
}

export const joinNextSchema = trimmed.refine(isSameOriginPath, {
  message: 'That link is not valid.',
});

/** The validated path, or null when there was none or it was not same-origin. */
export function parseNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const parsed = joinNextSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * What a group action hands back to its island. Declared here rather than in the `'use server'`
 * module beside it, because a server-action file may export only async functions.
 */
export interface GroupActionState {
  status: 'idle' | 'error' | 'success';
  message: string;
  fieldErrors?: FieldErrors;
}

export const IDLE_GROUP_STATE: GroupActionState = { status: 'idle', message: '' };
