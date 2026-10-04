import { compare, hash } from 'bcryptjs';

/**
 * Password hashing (ADR-0004): bcryptjs at cost 12. Pure JS, so it behaves identically on
 * Vercel serverless, in CI and on the embedded dev database — a native binding that fails to
 * load in production would be worse than the slightly older algorithm.
 *
 * The algorithm and the cost live inside the hash string itself (`$2b$12$…`), which is what
 * lets a future migration detect an old hash and re-hash on next sign-in without a second
 * column. `hashAlgorithm` and `hashCost` read it back so callers never parse it by hand.
 */
export const BCRYPT_COST = 12;

/** bcrypt truncates past 72 bytes, so anything longer is rejected at the validation boundary. */
export const PASSWORD_MAX_BYTES = 72;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  return compare(plain, stored);
}

/**
 * A real cost-12 hash of a value nobody can present, compared against when the email is not
 * registered. Returning early on an unknown address instead would make the request measurably
 * faster than a wrong password, which is the enumeration oracle TR-6 forbids — this spends the
 * same work either way and always fails.
 */
export const DUMMY_PASSWORD_HASH = '$2b$12$zKPWZ.F1H3CpWuAs/hFdautV5J2.CCOGOTx7gXa4se0AN6HuE/PCG';

/** Verifies against the stored hash, or against the dummy so an unknown email costs the same. */
export async function verifyPasswordOrDummy(
  plain: string,
  stored: string | null,
): Promise<boolean> {
  if (stored === null) {
    await compare(plain, DUMMY_PASSWORD_HASH);
    return false;
  }
  return compare(plain, stored);
}

/** The algorithm identifier stored in the hash, or null when the string is not a bcrypt hash. */
export function hashAlgorithm(stored: string): string | null {
  return /^\$2[abxy]\$/.test(stored) ? 'bcrypt' : null;
}

/** The cost factor stored in the hash, or null when the string is not a bcrypt hash. */
export function hashCost(stored: string): number | null {
  const match = /^\$2[abxy]\$(\d{2})\$/.exec(stored);
  return match ? Number(match[1]) : null;
}
