/**
 * Postgres's unique violation, however the driver in front of it chose to wrap it.
 *
 * Drizzle wraps a failed statement in its own error and hangs the driver's on `.cause`, so the
 * code and the constraint name are one or two links down the chain rather than on the error that
 * reaches us — checking only the top-level error would make a lost race throw a 500 instead of
 * answering. Two callers ask this one question: `lib/auth/actions.ts` for a duplicate sign-up
 * address, and `lib/groups/actions.ts` for the join and claim races. It lives here so the next
 * driver error-shape fix lands once and the two mappings cannot diverge.
 */

export const UNIQUE_VIOLATION = '23505';
export const DUPLICATE_KEY_MESSAGE = /duplicate key value|unique constraint/i;
export const MAX_ERROR_CAUSES = 5;

export function isUniqueViolation(error: unknown): boolean {
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
