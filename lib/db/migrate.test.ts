import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { listMigrationFiles, runMigrations } from './migrate';
import * as schema from './schema';

async function freshDb() {
  return drizzle(new PGlite(), { schema });
}

describe('runMigrations', () => {
  it('applies the shipped migration set to a fresh database and records each version', async () => {
    const db = await freshDb();
    const shipped = await listMigrationFiles();
    expect(shipped.length).toBeGreaterThan(0);

    const applied = await runMigrations(db);

    expect(applied).toEqual(shipped);
    const ledger = await db.select().from(schema.schemaMigrations);
    expect(ledger.map((row) => row.version).sort()).toEqual([...shipped].sort());
  });

  it('is a no-op on a second run, recording each version exactly once', async () => {
    const db = await freshDb();
    const shipped = await listMigrationFiles();

    await runMigrations(db);
    const second = await runMigrations(db);

    expect(second).toEqual([]);
    const ledger = await db.select().from(schema.schemaMigrations);
    expect(ledger).toHaveLength(shipped.length);
  });

  it('applies the same SQL on a database that already has the ledger bootstrapped', async () => {
    const db = await freshDb();
    // The runner bootstraps the ledger itself, so a database that already carries it — the
    // shape a second boot finds — must not trip the first migration file.
    await db.execute(
      'create table if not exists "schema_migrations" ("version" text primary key not null, "applied_at" timestamp with time zone default now() not null)',
    );

    await expect(runMigrations(db)).resolves.toEqual(await listMigrationFiles());
  });
});
