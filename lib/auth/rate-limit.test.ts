import { describe, expect, it } from 'vitest';
import {
  EMAIL_FAILURE_LIMIT,
  IP_FAILURE_LIMIT,
  checkRateLimit,
  clearRateLimit,
  clientIp,
  recordFailure,
} from './rate-limit';

/**
 * The buckets are module-level and deliberately outlive a test, so every case below works on
 * keys no other case touches rather than reaching for a reset hook the product would never
 * need.
 */
let unique = 0;
function freshEmail(): string {
  unique += 1;
  return `attempt-${unique}-${Date.now()}@example.co`;
}

describe('the per-email window', () => {
  it('allows guesses up to the limit and throttles the next one', () => {
    const email = freshEmail();

    for (let attempt = 0; attempt < EMAIL_FAILURE_LIMIT; attempt += 1) {
      expect(checkRateLimit({ email }).limited).toBe(false);
      recordFailure({ email });
    }

    const decision = checkRateLimit({ email });
    expect(decision.limited).toBe(true);
    expect(decision.retryAfterMs).toBeGreaterThan(0);
  });

  it('is cleared by a successful sign-in', () => {
    const email = freshEmail();
    for (let attempt = 0; attempt < EMAIL_FAILURE_LIMIT; attempt += 1) recordFailure({ email });
    expect(checkRateLimit({ email }).limited).toBe(true);

    clearRateLimit({ email });

    expect(checkRateLimit({ email }).limited).toBe(false);
  });

  it('does not spend one address on another address', () => {
    const hammered = freshEmail();
    const untouched = freshEmail();
    for (let attempt = 0; attempt < EMAIL_FAILURE_LIMIT; attempt += 1) recordFailure({ email: hammered });

    expect(checkRateLimit({ email: hammered }).limited).toBe(true);
    expect(checkRateLimit({ email: untouched }).limited).toBe(false);
  });

  it('counts the address the same way however it is spelled', () => {
    const email = freshEmail();
    for (let attempt = 0; attempt < EMAIL_FAILURE_LIMIT; attempt += 1) recordFailure({ email });

    expect(checkRateLimit({ email: `  ${email.toUpperCase()}  ` }).limited).toBe(true);
  });
});

describe('the per-IP hint', () => {
  it('is looser than the per-email window and does not gate an untouched address', () => {
    const ip = `198.51.100.${(unique += 1) % 250}`;
    const email = freshEmail();
    for (let attempt = 0; attempt < EMAIL_FAILURE_LIMIT; attempt += 1) recordFailure({ email, ip });

    // The address is out of budget; the IP has barely spent any of its much larger one.
    expect(checkRateLimit({ email, ip }).limited).toBe(true);
    expect(checkRateLimit({ ip }).limited).toBe(false);
  });

  it('gates sign-up once one address has burned through it', () => {
    const ip = `203.0.113.${(unique += 1) % 250}`;

    for (let attempt = 0; attempt < IP_FAILURE_LIMIT; attempt += 1) {
      expect(checkRateLimit({ ip }).limited).toBe(false);
      recordFailure({ ip });
    }

    // Sign-up keys on the IP hint alone, so this is exactly the gate it hits.
    expect(checkRateLimit({ ip }).limited).toBe(true);
  });

  it('ignores a missing or empty hint instead of bucketing everything together', () => {
    expect(checkRateLimit({ ip: null }).limited).toBe(false);
    expect(checkRateLimit({ ip: '   ' }).limited).toBe(false);
  });
});

describe('clientIp', () => {
  it("takes the first forwarded entry and ignores the proxies behind it", () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' });

    expect(clientIp(headers)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip, and to null when neither is an address', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(new Headers())).toBeNull();
    expect(clientIp(new Headers({ 'x-forwarded-for': 'not-an-address' }))).toBeNull();
  });

  it('refuses a header an attacker could mine for fresh budgets', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': ' '.repeat(200) }))).toBeNull();
    expect(clientIp(new Headers({ 'x-forwarded-for': `${'9'.repeat(60)}` }))).toBeNull();
  });

  it('accepts an IPv6 address', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
  });
});
