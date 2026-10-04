import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withDb } from '../lib/db/client';
import { schemaMigrations } from '../lib/db/schema';
import { runSeed } from './seed';

async function publicTables(): Promise<string[]> {
  return withDb(async ({ db }) => {
    const result = await db.execute<{ table_name: string }>(
      sql.raw("select table_name from information_schema.tables where table_schema = 'public' order by table_name"),
    );
    return (result as unknown as { rows: { table_name: string }[] }).rows.map((row) => row.table_name);
  });
}

describe('runSeed', () => {
  it('applies the migrations to a fresh database and ships no fixture rows', async () => {
    await runSeed();

    const ledger = await withDb(({ db }) => db.select().from(schemaMigrations));
    expect(ledger.map((row) => row.version)).toContain('0001_schema_ledger.sql');
    // The whole point of this slice's seed verb: it is real, and it writes nothing but the
    // ledger. Fixtures belong to the seed ticket, and this is what keeps the two honest.
    expect(await publicTables()).toEqual(['schema_migrations']);
  });

  it('is a no-op on a second run', async () => {
    await runSeed();
    await runSeed();

    const ledger = await withDb(({ db }) => db.select().from(schemaMigrations));
    expect(ledger.filter((row) => row.version === '0001_schema_ledger.sql')).toHaveLength(1);
    expect(await publicTables()).toEqual(['schema_migrations']);
  });
});
