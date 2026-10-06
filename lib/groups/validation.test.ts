import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROUP_TYPE,
  INVITE_DISABLED,
  INVITE_DISABLED_NOTICE,
  INVITE_ROTATED,
  INVITE_ROTATED_NOTICE,
  addPlaceholderSchema,
  claimPlaceholderSchema,
  createGroupSchema,
  groupScope,
  inviteNoticeText,
  isBalanceBlockedRefusal,
  nonZeroBalanceMessage,
  isSameOriginPath,
  joinByTokenSchema,
  joinNextSchema,
  membershipScope,
  parseNextPath,
  renameGroupSchema,
} from './validation';

/**
 * The boundary, on its own. Nothing here touches a database or a session, which is the point of
 * the module: every rule a group form can break is decided by a function that needs no fixture
 * to prove it.
 */

const UUID = '6f0a2b1c-3d4e-4f50-8a9b-0c1d2e3f4a5b';

function firstError(result: ReturnType<typeof createGroupSchema.safeParse>): string | undefined {
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe('createGroupSchema', () => {
  it('accepts a name and currency, and defaults a missing type to other', () => {
    const parsed = createGroupSchema.safeParse({ name: 'Goa trip', currency: 'INR' });

    expect(parsed.success && parsed.data).toEqual({
      name: 'Goa trip',
      currency: 'INR',
      type: DEFAULT_GROUP_TYPE,
    });
  });

  it('treats a blank type the way a missing one is treated', () => {
    const parsed = createGroupSchema.safeParse({ name: 'Flat', currency: 'usd', type: '  ' });

    expect(parsed.success && parsed.data).toMatchObject({ currency: 'USD', type: 'other' });
  });

  it('accepts every type in the closed set, however it is spelled', () => {
    for (const type of ['trip', 'HOME', 'Couple', 'other']) {
      const parsed = createGroupSchema.safeParse({ name: 'x', currency: 'EUR', type });
      expect(parsed.success).toBe(true);
    }
  });

  it('trims the name rather than storing one that would sort apart from itself', () => {
    const parsed = createGroupSchema.safeParse({ name: '  Goa trip  ', currency: 'INR' });

    expect(parsed.success && parsed.data.name).toBe('Goa trip');
  });

  it('names the field for a blank name, an unrenderable currency and an unknown type', () => {
    const parsed = createGroupSchema.safeParse({ name: '   ', currency: 'BTC', type: 'safari' });

    expect(parsed.success).toBe(false);
    const issues = parsed.success ? [] : parsed.error.issues;
    expect(issues.map((issue) => issue.path[0]).sort()).toEqual(['currency', 'name', 'type']);
    expect(firstError(parsed)).toBeDefined();
  });

  it('caps a group name at 80 characters', () => {
    const parsed = createGroupSchema.safeParse({ name: 'a'.repeat(81), currency: 'INR' });

    expect(parsed.success).toBe(false);
    expect(firstError(parsed)).toMatch(/at most 80/);
  });
});

describe('the other input schemas', () => {
  it('renameGroup refuses a blank name like creation does', () => {
    expect(renameGroupSchema.safeParse({ name: ' ' }).success).toBe(false);
    expect(renameGroupSchema.safeParse({ name: 'Goa' }).success).toBe(true);
  });

  it('addPlaceholder refuses a blank or overlong name', () => {
    expect(addPlaceholderSchema.safeParse({ displayName: '' }).success).toBe(false);
    expect(addPlaceholderSchema.safeParse({ displayName: 'a'.repeat(81) }).success).toBe(false);
    expect(addPlaceholderSchema.safeParse({ displayName: 'Bo' }).success).toBe(true);
  });

  it('joinByToken refuses an empty token', () => {
    expect(joinByTokenSchema.safeParse({ token: '  ' }).success).toBe(false);
    expect(joinByTokenSchema.safeParse({ token: 'abc123' }).success).toBe(true);
  });

  it('claimPlaceholder needs both a token and a membership id', () => {
    expect(claimPlaceholderSchema.safeParse({ token: 'abc', membershipId: UUID }).success).toBe(
      true,
    );
    expect(claimPlaceholderSchema.safeParse({ token: '', membershipId: UUID }).success).toBe(false);
    expect(claimPlaceholderSchema.safeParse({ token: 'abc', membershipId: 'nope' }).success).toBe(
      false,
    );
  });
});

describe('group and membership scopes', () => {
  it('accepts a uuid and refuses anything else', () => {
    expect(groupScope.safeParse(UUID).success).toBe(true);
    expect(membershipScope.safeParse(UUID).success).toBe(true);

    for (const value of ['', 'abc', '123', `${UUID}-extra`]) {
      expect(groupScope.safeParse(value).success).toBe(false);
      expect(membershipScope.safeParse(value).success).toBe(false);
    }
  });
});

describe('the invite notice', () => {
  it('maps each outcome the query can carry to its sentence', () => {
    expect(inviteNoticeText(INVITE_ROTATED)).toBe(INVITE_ROTATED_NOTICE);
    expect(inviteNoticeText(INVITE_DISABLED)).toBe(INVITE_DISABLED_NOTICE);
  });

  it('says nothing for an absent, blank or unknown value', () => {
    for (const value of [undefined, '', '   ', 'ROTATED', 'rotated,disabled', 'taken']) {
      expect(inviteNoticeText(value)).toBeNull();
    }
  });

  it('leads each sentence with the wording the acceptance criterion quotes (AC-13)', () => {
    expect(INVITE_ROTATED_NOTICE).toMatch(/^New invite link created\./);
    expect(INVITE_DISABLED_NOTICE).toMatch(/^Invite link disabled\./);
  });
});

describe('the post-sign-in destination', () => {
  it('accepts a same-origin path', () => {
    expect(isSameOriginPath('/join/abc')).toBe(true);
    expect(joinNextSchema.safeParse('  /groups/123  ').data).toBe('/groups/123');
  });

  it('refuses everything that would leave the origin', () => {
    for (const value of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'join/abc',
      'javascript:alert(1)',
      '',
    ]) {
      expect(isSameOriginPath(value)).toBe(false);
      expect(joinNextSchema.safeParse(value).success).toBe(false);
    }
  });

  it('drops an unusable value instead of passing it on', () => {
    expect(parseNextPath('/join/abc')).toBe('/join/abc');
    expect(parseNextPath('https://evil.example')).toBeNull();
    expect(parseNextPath(undefined)).toBeNull();
    expect(parseNextPath(null)).toBeNull();
  });

  it('drops every shape that would leave the origin, including the empty one', () => {
    // This value no longer only feeds a server redirect and a link href: the auth island hands
    // it straight to router.push, so the shapes that must never reach it are pinned by name.
    // A browser reads `//evil.example` as another host, and normalizes `/\evil.example` into the
    // same thing, which is why the backslash is refused as well.
    for (const value of ['//evil.example', '/\\evil.example', 'https://evil.example', '', '   ']) {
      expect(parseNextPath(value)).toBeNull();
    }
  });

  it('keeps the destinations the auth pages actually navigate to', () => {
    // The legitimate half: an invite link, a group, and the profile the account menu opens all
    // survive parsing byte for byte, trimmed.
    expect(parseNextPath('/join/abc123')).toBe('/join/abc123');
    expect(parseNextPath(`/groups/${UUID}`)).toBe(`/groups/${UUID}`);
    expect(parseNextPath('/profile')).toBe('/profile');
    expect(parseNextPath(`  /groups/${UUID}  `)).toBe(`/groups/${UUID}`);
  });
});

/**
 * Recognising the balance guard's own sentence (AC-2).
 *
 * The members panel is a client island and the guard that throws this lives behind the database,
 * so the two share the wording through `nonZeroBalanceMessage` rather than the island importing
 * the guard. These cases pin the two halves of that contract: the builder produces the sentence
 * the guard throws, and the predicate says yes to exactly that and no to everything else — a
 * message that merely mentions balances, another member's refusal, or nothing at all.
 */
describe('the non-zero-balance refusal', () => {
  it('names the member in the sentence the guard throws', () => {
    expect(nonZeroBalanceMessage('Bo')).toBe(
      'Bo has a non-zero balance. Settle up first, then try again.',
    );
    expect(nonZeroBalanceMessage('Ada Lovelace')).toMatch(/^Ada Lovelace /);
  });

  it('recognises the sentence it built, whoever it names', () => {
    expect(isBalanceBlockedRefusal(nonZeroBalanceMessage('Bo'))).toBe(true);
    expect(isBalanceBlockedRefusal(nonZeroBalanceMessage('A very long display name'))).toBe(true);
  });

  it('does not recognise unrelated refusals that talk about balances', () => {
    for (const message of [
      'Bo has a non-zero balance.',
      'has a non-zero balance. Settle up first, then try again.',
      'You have a non-zero balance. Settle up first, then try again.',
      'Bo has a non-zero balance. Settle up first, then try again',
      '',
      'Something else went wrong.',
    ]) {
      expect(isBalanceBlockedRefusal(message)).toBe(false);
    }
  });

  it('is a plain string test — nothing here needs a database or a session', () => {
    // The point of the predicate living in this module: the island can call it in the browser.
    expect(typeof isBalanceBlockedRefusal).toBe('function');
    expect(nonZeroBalanceMessage('Bo')).toContain('Settle up');
  });
});
