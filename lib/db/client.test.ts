import { Pool } from '@neondatabase/serverless';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, selectedBackend, withDb } from './client';
import { runMigrations } from './migrate';
import { schemaMigrations } from './schema';

const MANAGED = ['DATABASE_URL', 'VERCEL_ENV'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(MANAGED.map((key) => [key, process.env[key]]));
  for (const key of MANAGED) delete process.env[key];
});

afterEach(() => {
  for (const key of MANAGED) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

describe('getDb with DATABASE_URL unset', () => {
  it('returns a working embedded database and reports the pglite backend', async () => {
    const handle = await getDb();

    expect(handle.backend).toBe('pglite');
    expect(selectedBackend()).toBe('pglite');
    await handle.db.execute('select 1');
    await handle.close();
  });

  it('counts a blank or whitespace DATABASE_URL as unset', async () => {
    process.env.DATABASE_URL = '   ';

    expect(selectedBackend()).toBe('pglite');
    expect((await getDb()).backend).toBe('pglite');
  });

  // The embedded database is process-scoped on purpose: per-request creation would drop
  // everything written by the request before it.
  it('keeps data written through one withDb call visible to the next', async () => {
    await withDb(async ({ db }) => {
      await runMigrations(db);
      await db.insert(schemaMigrations).values({ version: 'probe-keep' }).onConflictDoNothing();
    });

    const versions = await withDb(async ({ db }) => db.select().from(schemaMigrations));

    expect(versions.map((row) => row.version)).toContain('probe-keep');
  });

  // A production build gives `instrumentation.ts` and each route entry a module registry
  // apiece, so a module-scoped singleton is two PGlite instances, two empty databases, and a
  // health route that cannot see the migrations boot applied. Re-importing is that second
  // registry; the instance has to come from the process, not the module.
  it('shares one embedded instance with a second module registry', async () => {
    await withDb(async ({ db }) => {
      await runMigrations(db);
      await db.insert(schemaMigrations).values({ version: 'probe-across-bundles' }).onConflictDoNothing();
    });

    vi.resetModules();
    const reloaded = await import('./client');

    const versions = await reloaded.withDb(async ({ db }) => db.select().from(schemaMigrations));

    expect(versions.map((row) => row.version)).toContain('probe-across-bundles');
  });

  it('rolls a failed transaction back, leaving no rows behind', async () => {
    await withDb(async ({ db }) => {
      await runMigrations(db);

      await expect(
        db.transaction(async (tx) => {
          await tx.insert(schemaMigrations).values({ version: 'probe-rolled-back' });
          throw new Error('probe failure');
        }),
      ).rejects.toThrow('probe failure');

      const versions = await db.select().from(schemaMigrations);
      expect(versions.map((row) => row.version)).not.toContain('probe-rolled-back');
    });
  });
});

describe('getDb under VERCEL_ENV=production', () => {
  it('refuses to boot on the embedded database, naming DATABASE_URL', async () => {
    process.env.VERCEL_ENV = 'production';

    await expect(getDb()).rejects.toThrow(/DATABASE_URL/);
  });

  it('refuses a blank DATABASE_URL too', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.DATABASE_URL = '  ';

    await expect(getDb()).rejects.toThrow(/DATABASE_URL/);
  });
});

describe('getDb with DATABASE_URL set', () => {
  // Construction is lazy — no connection is opened until the first query — so this reaches
  // no network. The lifecycle claim under test is that the pool is closed either way.
  it('opens a per-call pool and closes it on success and on failure', async () => {
    process.env.DATABASE_URL = 'postgresql://user:secret@example.invalid:5432/tabs';
    const close = vi.spyOn(Pool.prototype, 'end').mockResolvedValue(undefined);

    const backends: string[] = [];
    await withDb(async ({ backend }) => {
      backends.push(backend);
    });
    expect(backends).toEqual(['neon']);
    expect(close).toHaveBeenCalledTimes(1);

    close.mockClear();
    await expect(
      withDb(async () => {
        throw new Error('handler failed');
      }),
    ).rejects.toThrow('handler failed');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('trims the connection string it was given', () => {
    process.env.DATABASE_URL = '  postgresql://user:secret@example.invalid:5432/tabs  ';

    expect(selectedBackend()).toBe('neon');
  });
});
