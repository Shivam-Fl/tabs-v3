import { z } from 'zod';

/**
 * Application secrets, parsed in one place.
 *
 * Which database backend is active is deliberately absent from this file: the architecture
 * brief allows exactly one module to know that, and this is not it.
 *
 * "Production" means VERCEL_ENV=production and never NODE_ENV. Next sets
 * NODE_ENV=production for every build and every `next start`, so keying the production guard
 * on it would make `npm run sdlc:serve` unable to boot and the safe local defaults
 * unreachable — the two would be mutually exclusive.
 */
export const DEV_SESSION_SECRET = 'tabs-dev-only-session-secret';

const envSchema = z.object({
  SESSION_SECRET: z.string().min(1),
});

export interface Env {
  SESSION_SECRET: string;
  /** True when the secret above is the dev-only fallback rather than a configured value. */
  usedDevDefault: boolean;
}

export function isProduction(): boolean {
  return process.env.VERCEL_ENV === 'production';
}

export function getEnv(): Env {
  const parsed = envSchema.safeParse({
    SESSION_SECRET: process.env.SESSION_SECRET?.trim() ?? '',
  });

  if (parsed.success) return { ...parsed.data, usedDevDefault: false };

  if (isProduction()) {
    throw new Error(
      'Missing required secret: SESSION_SECRET. Production refuses to boot without it — set SESSION_SECRET in the deployment environment.',
    );
  }

  console.warn(
    '[sdlc] safe local defaults: SESSION_SECRET is unset — using a dev-only secret. Set SESSION_SECRET before deploying.',
  );
  return { SESSION_SECRET: DEV_SESSION_SECRET, usedDevDefault: true };
}
