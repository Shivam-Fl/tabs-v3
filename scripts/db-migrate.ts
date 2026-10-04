import { withDb } from '../lib/db/client';
import { runMigrations } from '../lib/db/migrate';

/**
 * Applies the migrations without booting the app — for a deploy step, a CI job, or a manual
 * run against a real database. The connection comes from the database client like everywhere
 * else; this file never decides which backend is active.
 */
const applied = await withDb((handle) => runMigrations(handle.db));

console.log(
  applied.length === 0
    ? '[sdlc] db:migrate: already up to date'
    : `[sdlc] db:migrate: applied ${applied.join(', ')}`,
);
