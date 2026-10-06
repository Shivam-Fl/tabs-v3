import { describe, expect, it } from 'vitest';
import { PASSWORD_MAX_BYTES } from './password';
import {
  IDLE_PROFILE_STATE,
  NEUTRAL_CREDENTIALS_MESSAGE,
  PROFILE_REFUSAL_MESSAGE,
  PROFILE_SAVED_MESSAGE,
  SIGNUP_SUCCESS_MESSAGE,
  SUPPORTED_CURRENCIES,
  fieldErrorsFrom,
  normalizeCurrency,
  normalizeEmail,
  profileFormDefaults,
  profileNoticeText,
  profileSchema,
  signinSchema,
  signupSchema,
} from './validation';

describe('normalizeEmail', () => {
  it('trims and lowercases, so one address has exactly one spelling', () => {
    expect(normalizeEmail('  Ada@Example.CO  ')).toBe('ada@example.co');
  });
});

describe('signupSchema', () => {
  const valid = { email: 'ada@example.co', password: 'correct horse', displayName: 'Ada' };

  it('accepts a valid signup and returns the normalized email', () => {
    const parsed = signupSchema.parse({ ...valid, email: '  Ada@Example.CO ' });

    expect(parsed.email).toBe('ada@example.co');
    expect(parsed.displayName).toBe('Ada');
  });

  it('rejects an address that is not an email, naming the field', () => {
    const result = signupSchema.safeParse({ ...valid, email: 'not-an-email' });

    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrorsFrom(result.error).email).toMatch(/valid email/i);
  });

  it('rejects a short password and names the shortfall', () => {
    const result = signupSchema.safeParse({ ...valid, password: 'short' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrorsFrom(result.error).password).toContain('at least 8');
    }
  });

  it(`rejects a password over bcrypt's ${PASSWORD_MAX_BYTES}-byte ceiling`, () => {
    // 40 two-byte characters is 80 bytes: 40 "characters" long, over the byte limit.
    const result = signupSchema.safeParse({ ...valid, password: 'é'.repeat(40) });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrorsFrom(result.error).password).toContain(`${PASSWORD_MAX_BYTES} bytes`);
    }
  });

  it('requires a display name', () => {
    const result = signupSchema.safeParse({ ...valid, displayName: '   ' });

    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrorsFrom(result.error).displayName).toBeDefined();
  });
});

describe('signinSchema', () => {
  it('normalizes the email and accepts any non-empty password', () => {
    const parsed = signinSchema.parse({ email: ' Ada@Example.CO ', password: 'x' });

    expect(parsed.email).toBe('ada@example.co');
  });

  it('rejects an empty password', () => {
    expect(signinSchema.safeParse({ email: 'ada@example.co', password: '' }).success).toBe(false);
  });

  it('rejects a password over the byte ceiling, so bcrypt is never handed one', () => {
    expect(
      signinSchema.safeParse({ email: 'ada@example.co', password: 'é'.repeat(40) }).success,
    ).toBe(false);
  });
});

describe('profileSchema', () => {
  it('normalizes currency case and whitespace', () => {
    expect(normalizeCurrency(' inr ')).toBe('INR');
    expect(profileSchema.parse({ displayName: 'Ada', currency: ' usd ' }).currency).toBe('USD');
  });

  it('accepts every currency it advertises', () => {
    for (const currency of SUPPORTED_CURRENCIES) {
      expect(profileSchema.safeParse({ displayName: 'Ada', currency }).success).toBe(true);
    }
  });

  it('rejects a currency nothing can render yet, and lists what it can', () => {
    const result = profileSchema.safeParse({ displayName: 'Ada', currency: 'BTC' });

    expect(result.success).toBe(false);
    if (!result.success) {
      const message = fieldErrorsFrom(result.error).currency;
      expect(message).toContain('INR');
      expect(message).toContain('USD');
    }
  });

  it('requires a display name', () => {
    expect(profileSchema.safeParse({ displayName: '', currency: 'INR' }).success).toBe(false);
  });
});

describe('profileFormDefaults', () => {
  // The saved props are what the page passes down; a refusal has to beat them or the select
  // reverts to the stored currency and the person's choice disappears (AC-8, PR #44 BUG-1).
  const saved = { displayName: 'Ada', currency: 'USD' };

  it('returns the saved values when the state is idle', () => {
    expect(profileFormDefaults(IDLE_PROFILE_STATE, saved)).toEqual(saved);
  });

  it('returns the submitted values on a refusal that carries them, so a chosen EUR survives an empty-name refusal', () => {
    const state = {
      status: 'error' as const,
      message: PROFILE_REFUSAL_MESSAGE,
      fieldErrors: { displayName: 'Enter a display name' },
      values: { displayName: '', currency: 'EUR' },
    };

    // The empty name comes back empty on purpose: it is the thing that was refused, so
    // substituting the saved one would hide the field the error is about.
    expect(profileFormDefaults(state, saved)).toEqual({ displayName: '', currency: 'EUR' });
  });

  it('falls back to the saved currency when the echoed value is not a supported code', () => {
    const state = {
      status: 'error' as const,
      message: PROFILE_REFUSAL_MESSAGE,
      fieldErrors: { currency: 'Choose one of INR, USD, EUR, GBP' },
      values: { displayName: 'Ada', currency: 'BTC' },
    };

    expect(profileFormDefaults(state, saved)).toEqual({ displayName: 'Ada', currency: 'USD' });
  });

  it('falls back to the saved values on a refusal without values', () => {
    const state = {
      status: 'error' as const,
      message: PROFILE_REFUSAL_MESSAGE,
      fieldErrors: { currency: 'Choose one of INR, USD, EUR, GBP' },
    };

    expect(profileFormDefaults(state, saved)).toEqual(saved);
  });
});

describe('profileNoticeText', () => {
  it('reads saved=1 as the saved sentence, in the success tone', () => {
    expect(profileNoticeText({ saved: '1' })).toEqual({
      tone: 'lent',
      text: PROFILE_SAVED_MESSAGE,
    });
  });

  it('reads error=invalid as the refusal sentence, in the danger tone', () => {
    expect(profileNoticeText({ error: 'invalid' })).toEqual({
      tone: 'danger',
      text: PROFILE_REFUSAL_MESSAGE,
    });
  });

  it('lets the error win when a URL carries both, rather than rendering the pair', () => {
    // A stale success beside a fresh refusal is exactly what AC-3 forbids; one notice slot and one
    // winning value is what makes it structurally impossible.
    expect(profileNoticeText({ error: 'invalid', saved: '1' })).toEqual({
      tone: 'danger',
      text: PROFILE_REFUSAL_MESSAGE,
    });
  });

  it('says nothing for a value outside the closed vocabulary', () => {
    // The page used to test these for truthiness, so each of these rendered a sentence about an
    // outcome that never happened.
    expect(profileNoticeText({ saved: 'yes' })).toBeNull();
    expect(profileNoticeText({ error: 'lol' })).toBeNull();
    expect(profileNoticeText({ saved: '0' })).toBeNull();
    expect(profileNoticeText({ error: '' })).toBeNull();
    expect(profileNoticeText({})).toBeNull();
  });

  it('says nothing for a repeated param, which Next hands over as an array', () => {
    // `?saved=1&saved=1` arrives as `['1', '1']`: a list is not the value it spells, and reading
    // it as one would be the same open-vocabulary bug in a different shape.
    expect(profileNoticeText({ saved: ['1', '1'] })).toBeNull();
    expect(profileNoticeText({ error: ['invalid'] })).toBeNull();
  });
});

describe('the neutral messages', () => {
  it('never says which half of the credentials was wrong', () => {
    expect(NEUTRAL_CREDENTIALS_MESSAGE.toLowerCase()).not.toContain('unknown');
    expect(NEUTRAL_CREDENTIALS_MESSAGE.toLowerCase()).not.toContain('no account');
    expect(NEUTRAL_CREDENTIALS_MESSAGE).toMatch(/email or password/i);
  });

  it('the signup success message says nothing about whether the address was already taken', () => {
    expect(SIGNUP_SUCCESS_MESSAGE.toLowerCase()).not.toMatch(/exist|already|taken|registered/);
  });
});
