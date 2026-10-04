import { describe, expect, it } from 'vitest';
import { withDb } from '../lib/db/client';
import { schemaMigrations, sessions, users } from '../lib/db/schema';
import { runSeed } from './seed';

/**
 * The seed writes no fixture *rows* — fixtures belong to the seed ticket, and this is what
 * keeps the two honest. It asserts emptiness of the tables rather than a list of them: the
 * migration set grows with every ticket that adds one, and a hard-coded table list fails on
 * each of those without saying whether the seed ever wrote a row.
 */
async function seededRows(): Promise<{ users: number; sessions: number }> {
  return withDb(async ({ db }) => ({
    users: (await db.select().from(users)).length,
    sessions: (await db.select().from(sessions)).length,
  }));
}

describe('runSeed', () => {
  it('applies the migrations to a fresh database and ships no fixture rows', async () => {
    await runSeed();

    const ledger = await withDb(({ db }) => db.select().from(schemaMigrations));
    expect(ledger.map((row) => row.version)).toContain('0001_schema_ledger.sql');
    expect(ledger.map((row) => row.version)).toContain('0002_auth_users_sessions.sql');
    expect(await seededRows()).toEqual({ users: 0, sessions: 0 });
  });

  it('is a no-op on a second run', async () => {
    await runSeed();
    await runSeed();

    const ledger = await withDb(({ db }) => db.select().from(schemaMigrations));
    expect(ledger.filter((row) => row.version === '0001_schema_ledger.sql')).toHaveLength(1);
    expect(await seededRows()).toEqual({ users: 0, sessions: 0 });
  });
});
