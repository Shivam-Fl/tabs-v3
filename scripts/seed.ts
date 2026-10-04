import { pathToFileURL } from 'node:url';
import { withDb } from '../lib/db/client';
import { runMigrations } from '../lib/db/migrate';

/**
 * `npm run sdlc:seed` — real, and honestly minimal. It applies the migrations and writes no
 * fixture rows: the seed fixtures the product needs (known-password users, groups, every
 * split type, a multi-payer expense, payments and a placeholder) are the seed ticket's, and
 * shipping them here would smuggle that ticket's work into this one.
 *
 * Exported side-effect free so the seed-entry test can import it without booting Next,
 * touching the network or writing anything. Running the file directly calls it.
 */
export async function runSeed(): Promise<string[]> {
  const applied = await withDb((handle) => runMigrations(handle.db));

  console.log(
    applied.length === 0
      ? '[sdlc] seed: migrations already up to date'
      : `[sdlc] seed: applied ${applied.join(', ')}`,
  );
  console.log('[sdlc] seed: 0 fixture rows written — fixtures belong to the seed ticket');

  return applied;
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  await runSeed();
}
