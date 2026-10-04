/**
 * Runs once per server instance, before the first request is served.
 *
 * Two things belong here and nowhere else: the secret check that refuses a misconfigured
 * production boot, and the migrations, so a fresh database is ready on the instance that
 * serves traffic rather than only on the one that happened to run a script.
 *
 * Imports are dynamic and behind the runtime guard so the edge bundle never pulls in the
 * Node-only database code.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const [env, client, migrate] = await Promise.all([
    import('./lib/env'),
    import('./lib/db/client'),
    import('./lib/db/migrate'),
  ]);

  // Throws in production when a secret is missing, before anything is served.
  const parsed = env.getEnv();

  const backend = client.selectedBackend();
  const defaults = [
    backend === 'pglite' ? 'db backend PGlite (DATABASE_URL is unset)' : undefined,
    parsed.usedDevDefault ? 'a dev-only session secret (SESSION_SECRET is unset)' : undefined,
  ].filter((entry): entry is string => entry !== undefined);

  if (defaults.length > 0) {
    console.log(
      `[sdlc] safe local defaults in use: ${defaults.join(' and ')}. ` +
        `Set ${defaults.length === 1 ? 'it' : 'both'} before deploying.`,
    );
  } else {
    console.log('[sdlc] booting with configured secrets.');
  }

  const applied = await client.withDb((handle) => migrate.runMigrations(handle.db));
  console.log(
    applied.length === 0
      ? '[sdlc] migrations: already up to date'
      : `[sdlc] migrations: applied ${applied.join(', ')}`,
  );
}
