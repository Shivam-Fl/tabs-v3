import { describe, expect, it } from 'vitest';
import { DUPLICATE_KEY_MESSAGE, MAX_ERROR_CAUSES, UNIQUE_VIOLATION, isUniqueViolation } from './errors';

/**
 * The one question both auth and group writes ask of a thrown driver error. The shapes below are
 * the ones Postgres actually produces through Drizzle — the code on the error, sometimes on a
 * `.cause` link below it, and the message alone when the driver has dropped the code.
 *
 * The failures that matter are the two the walker must not get wrong: calling an unrelated error a
 * unique violation would swallow a real failure, and missing a wrapped one would turn a lost race
 * into a 500.
 */

describe('isUniqueViolation', () => {
  it('recognises a top-level error carrying the unique-violation code', () => {
    expect(isUniqueViolation({ code: UNIQUE_VIOLATION })).toBe(true);
    expect(isUniqueViolation(Object.assign(new Error('duplicate key'), { code: '23505' }))).toBe(
      true,
    );
  });

  it('recognises the code two cause links down, the way Drizzle wraps it', () => {
    const driver = { code: UNIQUE_VIOLATION, message: 'duplicate key value violates unique constraint' };
    const wrappedByDrizzle = { message: 'Failed query', cause: driver };
    const wrappedAgain = { cause: wrappedByDrizzle };

    expect(isUniqueViolation(wrappedAgain)).toBe(true);
  });

  it('recognises the message alone when the driver dropped the code', () => {
    expect(isUniqueViolation({ message: 'duplicate key value violates unique constraint "users_email_unique"' })).toBe(
      true,
    );
    expect(isUniqueViolation({ cause: { message: 'unique constraint violated' } })).toBe(true);
  });

  it('rejects an unrelated driver error', () => {
    expect(isUniqueViolation({ code: '23503', message: 'violates foreign key constraint' })).toBe(
      false,
    );
    expect(isUniqueViolation(Object.assign(new Error('connection terminated'), { code: '08006' }))).toBe(
      false,
    );
  });

  it('answers false, without throwing, for anything that is not an error object', () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('duplicate key value')).toBe(false);
    expect(isUniqueViolation(42)).toBe(false);
    expect(isUniqueViolation({})).toBe(false);
    expect(isUniqueViolation({ message: undefined, code: undefined })).toBe(false);
  });

  it('stops at the depth cap, so a code buried deeper than the walk is not found', () => {
    let chain: unknown = { code: UNIQUE_VIOLATION };
    for (let depth = 0; depth < MAX_ERROR_CAUSES; depth += 1) chain = { cause: chain };

    expect(isUniqueViolation(chain)).toBe(false);
  });

  it('terminates on a cyclic cause chain', () => {
    const loop: { cause?: unknown } = {};
    loop.cause = loop;

    expect(isUniqueViolation(loop)).toBe(false);
  });
});

describe('DUPLICATE_KEY_MESSAGE', () => {
  it('matches the two spellings the walker relies on', () => {
    expect(DUPLICATE_KEY_MESSAGE.test('duplicate key value violates unique constraint')).toBe(true);
    expect(DUPLICATE_KEY_MESSAGE.test('UNIQUE CONSTRAINT violated')).toBe(true);
    expect(DUPLICATE_KEY_MESSAGE.test('deadlock detected')).toBe(false);
  });
});
