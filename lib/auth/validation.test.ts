import { describe, expect, it } from 'vitest';
import { PASSWORD_MAX_BYTES } from './password';
import {
  NEUTRAL_CREDENTIALS_MESSAGE,
  SIGNUP_SUCCESS_MESSAGE,
  SUPPORTED_CURRENCIES,
  fieldErrorsFrom,
  normalizeCurrency,
  normalizeEmail,
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
