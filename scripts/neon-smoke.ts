import { eq } from 'drizzle-orm';
import { connectionString, withDb } from '../lib/db/client';
import { runMigrations } from '../lib/db/migrate';
import { schemaMigrations } from '../lib/db/schema';

/**
 * Manual only, and deliberately so: `npm run neon:smoke` needs a real remote DATABASE_URL, so
 * CI — which runs on the embedded backend alone — can never execute it. What it proves is the
 * one thing the embedded backend cannot: that a transaction against the real remote driver
 * rolls back and leaves nothing behind.
 *
 * Run it by hand after provisioning a database, before trusting a production deploy.
 */
const probe = `neon-smoke-${Date.now()}`;

function fail(message: string): never {
  console.error(`[sdlc] neon:smoke FAILED: ${message}`);
  process.exit(1);
}

if (!connectionString()) {
  fail(
    'no DATABASE_URL is set. This script needs a real remote connection string; it is never run in CI.',
  );
}

await withDb(async (handle) => {
  await runMigrations(handle.db);

  let rolledBack = false;
  try {
    await handle.db.transaction(async (tx) => {
      await tx.insert(schemaMigrations).values({ version: probe });
      throw new Error('neon:smoke: intentional rollback');
    });
  } catch {
    rolledBack = true;
  }

  if (!rolledBack) fail('the probe transaction resolved instead of throwing — nothing was proven');

  const rows = await handle.db.select().from(schemaMigrations).where(eq(schemaMigrations.version, probe));
  if (rows.length !== 0) fail(`the transaction rolled back but ${probe} is still in the ledger`);

  console.log('[sdlc] neon:smoke OK — a failed transaction left no rows behind, against the real driver');
});
