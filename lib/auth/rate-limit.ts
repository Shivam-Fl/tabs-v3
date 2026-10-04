import { isIP } from 'node:net';
import { normalizeEmail } from './validation';

/**
 * Throttling for failed sign-ins, in one place.
 *
 * The primary key is the **normalized email**, because it is the thing an attacker must guess
 * against and the one value they cannot forge. The client IP is a **hint only**: it is read
 * from a header the caller controls (`x-forwarded-for`'s first entry is whatever the client
 * sent), so it can slow a lazy script down and nothing more.
 *
 * A caller that names an IP but carries none — a missing, blank or unparseable hint — is
 * bucketed under the fixed value `unknown` rather than skipping the IP dimension entirely.
 * Sharing one budget across every headerless client is deliberate: the alternative was no
 * budget at all, and since the header is the caller's to strip or garble, "no budget" meant
 * sign-up's IP-only gate vanished on demand. The literal `unknown` cannot collide with a real
 * bucket, because `clientIp` only ever returns an `isIP`-validated address.
 *
 * It is per-instance memory, which is a recorded v1 limitation, not an oversight: a
 * distributed guesser gets one budget per instance behind a load balancer. A shared
 * attempts table is the fix and it is deliberately not this slice's — the threat it closes is
 * online guessing against one mailbox, which the per-email window already bounds.
 *
 * The window is a timestamp list rather than a counter, so it slides: five failures at 10:00
 * do not block a sixth at 10:16, and the retry delay reflects when the oldest one ages out.
 */

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** Failed sign-ins tolerated for one address inside the window; the next one is throttled. */
export const EMAIL_FAILURE_LIMIT = 5;

/** Failed sign-ins tolerated from one IP hint inside the window — deliberately looser. */
export const IP_FAILURE_LIMIT = 30;

export interface RateLimitKeys {
  email?: string | null;
  ip?: string | null;
}

export interface RateLimitDecision {
  limited: boolean;
  /** How long until the oldest failure in the blocking window ages out; 0 when not limited. */
  retryAfterMs: number;
}

interface Bucket {
  limit: number;
  failures: number[];
}

const buckets = new Map<string, Bucket>();

interface KeySpec {
  kind: 'email' | 'ip';
  value: string;
  limit: number;
}

/** The bucket a caller that named an IP but supplied none of one shares. */
const UNKNOWN_IP = 'unknown';

function keySpecs(keys: RateLimitKeys): KeySpec[] {
  const specs: KeySpec[] = [];
  const email = keys.email ? normalizeEmail(keys.email) : '';
  if (email) specs.push({ kind: 'email', value: email, limit: EMAIL_FAILURE_LIMIT });
  // A caller that named an IP always gets an IP bucket, so a null hint throttles instead of
  // escaping. A caller that named none — `clearRateLimit`, which clears only the address —
  // still gets no IP spec, so its documented "the hint ages out on its own" behaviour holds.
  if ('ip' in keys) {
    specs.push({ kind: 'ip', value: keys.ip?.trim() || UNKNOWN_IP, limit: IP_FAILURE_LIMIT });
  }
  return specs;
}

function bucketKey(spec: KeySpec): string {
  return `${spec.kind}:${spec.value}`;
}

function prune(bucket: Bucket, now: number): void {
  bucket.failures = bucket.failures.filter((recordedAt) => now - recordedAt < RATE_LIMIT_WINDOW_MS);
}

export function checkRateLimit(keys: RateLimitKeys): RateLimitDecision {
  const now = Date.now();
  let retryAfterMs = 0;

  for (const spec of keySpecs(keys)) {
    const bucket = buckets.get(bucketKey(spec));
    if (!bucket) continue;
    prune(bucket, now);
    if (bucket.failures.length < spec.limit) continue;
    const oldest = bucket.failures[0];
    retryAfterMs = Math.max(retryAfterMs, RATE_LIMIT_WINDOW_MS - (now - oldest));
  }

  return { limited: retryAfterMs > 0, retryAfterMs };
}

export function recordFailure(keys: RateLimitKeys): void {
  const now = Date.now();
  for (const spec of keySpecs(keys)) {
    const key = bucketKey(spec);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { limit: spec.limit, failures: [] };
      buckets.set(key, bucket);
    }
    prune(bucket, now);
    bucket.failures.push(now);
  }
}

/** A correct password clears the address's budget; the IP hint is left to age out on its own. */
export function clearRateLimit(keys: RateLimitKeys): void {
  for (const spec of keySpecs({ email: keys.email })) {
    buckets.delete(bucketKey(spec));
  }
}

const MAX_IP_LENGTH = 45; // Longest textual IPv6 address (RFC 4291).

/**
 * The client address, or null. Deliberately paranoid: only the first `x-forwarded-for` entry
 * is considered, the length is bounded, and the value must parse as an IP — so a header full
 * of prose, an empty entry or a megabyte of junk yields null rather than a bucket key an
 * attacker can mine for fresh budgets. Never used for authorization; only to slow guessing.
 */
export function clientIp(headers: Headers): string | null {
  const candidates = [headers.get('x-forwarded-for')?.split(',')[0], headers.get('x-real-ip')];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && value.length <= MAX_IP_LENGTH && isIP(value) !== 0) return value;
  }

  return null;
}
