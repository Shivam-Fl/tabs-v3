import { randomBytes } from 'node:crypto';

/**
 * The one token generator. Session tokens and invite tokens are the same kind of thing — 256
 * bits of CSPRNG output rendered base64url so they survive a URL, a cookie and a form field
 * unmangled — and two identical implementations are two places to notice it if that ever stops
 * being what the product wants.
 *
 * No database, no environment, no clock: this file is what makes a token testable and keeps a
 * caller from reaching for `Math.random`.
 */

/** 32 bytes is 256 bits: far past guessing, and short enough to sit in a URL path. */
export const TOKEN_BYTES = 32;

export function randomToken(bytes: number = TOKEN_BYTES): string {
  return randomBytes(bytes).toString('base64url');
}
