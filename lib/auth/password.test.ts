import { beforeAll, describe, expect, it } from 'vitest';
import {
  BCRYPT_COST,
  DUMMY_PASSWORD_HASH,
  hashAlgorithm,
  hashCost,
  hashPassword,
  verifyPassword,
  verifyPasswordOrDummy,
} from './password';

const PASSWORD = 'correct horse battery staple';

/**
 * Cost-12 bcrypt is deliberately slow, so the suite hashes once where the assertion does not
 * need a second hash — a test that spends a quarter of a second proving something it already
 * proved one line up is a tax on every other test in the run.
 */
let stored: string;

beforeAll(async () => {
  stored = await hashPassword(PASSWORD);
});

describe('hashPassword', () => {
  it('hashes at cost 12 and stores the algorithm inside the hash', () => {
    expect(hashAlgorithm(stored)).toBe('bcrypt');
    expect(hashCost(stored)).toBe(BCRYPT_COST);
    expect(stored).not.toContain(PASSWORD);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const second = await hashPassword(PASSWORD);

    expect(second).not.toBe(stored);
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and rejects the wrong one', async () => {
    await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(true);
    await expect(verifyPassword('Correct Horse Battery Staple', stored)).resolves.toBe(false);
  });
});

describe('verifyPasswordOrDummy', () => {
  it('answers false for an unknown address, having done a real comparison', async () => {
    const startedAt = Date.now();
    await expect(verifyPasswordOrDummy('anything at all', null)).resolves.toBe(false);

    // Cost-12 bcrypt is the slowest thing in this file; returning in under a few milliseconds
    // would mean the unknown-email path skipped the work and became a timing oracle.
    expect(Date.now() - startedAt).toBeGreaterThan(10);
  });

  it('compares against a dummy at the same cost as a real hash', () => {
    expect(hashAlgorithm(DUMMY_PASSWORD_HASH)).toBe('bcrypt');
    expect(hashCost(DUMMY_PASSWORD_HASH)).toBe(BCRYPT_COST);
  });

  it('answers false against a real hash for the wrong password', async () => {
    await expect(verifyPasswordOrDummy('not it', stored)).resolves.toBe(false);
  });
});

describe('hashAlgorithm / hashCost', () => {
  it('returns null for a string that is not a bcrypt hash', () => {
    expect(hashAlgorithm('plain text')).toBeNull();
    expect(hashCost('plain text')).toBeNull();
  });
});
