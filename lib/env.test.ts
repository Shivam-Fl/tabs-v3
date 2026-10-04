import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEnv } from './env';

// The environment is process-global, so every case restores it. Cases that need a variable
// absent delete it rather than setting it to '' — the two are different code paths.
const MANAGED = ['SESSION_SECRET', 'VERCEL_ENV', 'NODE_ENV'] as const;
// NODE_ENV is declared readonly, which a test that needs to set it has to step around.
const mutableEnv = process.env as Record<string, string | undefined>;
let saved: Record<string, string | undefined>;

function setVar(key: (typeof MANAGED)[number], value: string | undefined): void {
  if (value === undefined) delete mutableEnv[key];
  else mutableEnv[key] = value;
}

beforeEach(() => {
  saved = Object.fromEntries(MANAGED.map((key) => [key, process.env[key]]));
  for (const key of MANAGED) setVar(key, undefined);
});

afterEach(() => {
  for (const key of MANAGED) setVar(key, saved[key]);
  vi.restoreAllMocks();
});

describe('getEnv', () => {
  it('falls back to a dev-only secret with a logged warning when VERCEL_ENV is unset', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const env = getEnv();

    expect(env.SESSION_SECRET).toBeTruthy();
    expect(env.usedDevDefault).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/safe local defaults/i);
  });

  it('throws naming SESSION_SECRET under VERCEL_ENV=production', () => {
    setVar('VERCEL_ENV', 'production');

    expect(() => getEnv()).toThrow(/SESSION_SECRET/);
  });

  it('treats a blank SESSION_SECRET as unset under VERCEL_ENV=production', () => {
    setVar('VERCEL_ENV', 'production');
    setVar('SESSION_SECRET', '   ');

    expect(() => getEnv()).toThrow(/SESSION_SECRET/);
  });

  // Next sets NODE_ENV=production for every build and every `next start`, so keying the
  // production guard on it would make the sdlc:serve boot impossible.
  it('still boots on safe defaults when NODE_ENV=production alone is set', () => {
    setVar('NODE_ENV', 'production');
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => getEnv()).not.toThrow();
  });

  it('boots silently under VERCEL_ENV=production once the secret is set', () => {
    setVar('VERCEL_ENV', 'production');
    setVar('SESSION_SECRET', 'a-real-secret');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const env = getEnv();

    expect(env.SESSION_SECRET).toBe('a-real-secret');
    expect(env.usedDevDefault).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});
