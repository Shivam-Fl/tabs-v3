import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';
import * as schema from './schema';

/**
 * One invariant, from the architecture brief: no code except the database client may know
 * which backend is running. CI and QA only ever exercise the embedded one, so a branch on
 * the remote backend anywhere else would ship untested.
 *
 * The scan is scoped to product source — app/**, lib/** and scripts/** minus the test files
 * and the manual smoke script — so prose in docs, the work order and build artefacts cannot
 * trip it. That script and this scan are the two places allowed to name the backends besides
 * the client itself.
 */
const SCAN_ROOTS = ['app', 'lib', 'scripts'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.cjs', '.js', '.jsx']);
const ALLOWED = new Set(['lib/db/client.ts', 'scripts/neon-smoke.ts']);
const BACKEND_REFERENCE = /\bDATABASE_URL\b|\bPGlite\b|@neondatabase\/serverless|neon-serverless|\bws\b/;

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const relative = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(relative);
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) return [];
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) return [];
      if (ALLOWED.has(relative)) return [];
      return [relative];
    }),
  );
  return found.flat();
}

describe('only the database client knows which backend is active', () => {
  it('finds product source to scan at all', async () => {
    const files = (await Promise.all(SCAN_ROOTS.map(sourceFiles))).flat();

    expect(files.length).toBeGreaterThan(3);
    expect(files).toContain('lib/env.ts');
  });

  it('finds no backend reference outside lib/db/client.ts', async () => {
    const files = (await Promise.all(SCAN_ROOTS.map(sourceFiles))).flat();
    const offenders: string[] = [];

    for (const file of files) {
      const contents = await readFile(file, 'utf8');
      if (BACKEND_REFERENCE.test(contents)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  // Without this the scan would pass by matching nothing, which is the failure mode a
  // source-scanning test has to rule out about itself.
  it('is not vacuous — the client it exempts does reference both backends', async () => {
    const client = await readFile('lib/db/client.ts', 'utf8');

    expect(BACKEND_REFERENCE.test(client)).toBe(true);
  });
});

describe('a migration that fails part-way', () => {
  const scratch: string[] = [];

  afterAll(async () => {
    await Promise.all(scratch.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('leaves no partial rows and no ledger entry behind', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tabs-migrations-'));
    scratch.push(dir);
    await writeFile(path.join(dir, '0001_ok.sql'), 'CREATE TABLE IF NOT EXISTS probe_ok (id integer);\n');
    // drizzle-kit separates statements in one file with this marker, so a file can create
    // something and then fail — which is the only shape that proves the runner's transaction
    // is what kept the database clean, rather than the failing statement never having run.
    await writeFile(
      path.join(dir, '0002_partial.sql'),
      [
        'CREATE TABLE probe_partial (id integer);',
        '--> statement-breakpoint',
        'SELECT 1 / 0;',
        '',
      ].join('\n'),
    );

    const db = drizzle(new PGlite(), { schema });
    await expect(runMigrations(db, { dir })).rejects.toThrow();

    const ledger = await db.select().from(schema.schemaMigrations);
    expect(ledger.map((row) => row.version)).toEqual(['0001_ok.sql']);

    const tables = await db.execute<{ table_name: string }>(
      sql.raw("select table_name from information_schema.tables where table_schema = 'public'"),
    );
    const names = (tables as unknown as { rows: { table_name: string }[] }).rows.map((row) => row.table_name);
    expect(names).toContain('probe_ok');
    expect(names).not.toContain('probe_partial');
  });
});
