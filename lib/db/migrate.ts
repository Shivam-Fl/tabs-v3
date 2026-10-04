import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { schemaMigrations } from './schema';

/**
 * The migration runner: the same SQL, the same code path, whichever backend is active.
 *
 * Two rules keep re-application safe. An applied filename is immutable — renaming one makes
 * the ledger forget it and the SQL runs a second time — and every schema edit goes through
 * `npm run db:generate` so the SQL files and `lib/db/schema.ts` stay in step.
 *
 * Each file runs in its own transaction together with the ledger row that records it, so a
 * file that fails half-way leaves neither its effects nor a version claiming it applied.
 * Concurrent cold starts racing the same file resolve on the version insert's conflict clause.
 */

/** How drizzle-kit separates statements inside one generated file. */
const STATEMENT_BREAKPOINT = /^\s*-->\s*statement-breakpoint\s*$/m;

const DEFAULT_DIR = path.join(process.cwd(), 'lib', 'db', 'migrations');

/**
 * Written by hand rather than by a migration file: the ledger has to exist before any file
 * can be recorded in it, including the one that creates it.
 */
const BOOTSTRAP_LEDGER = sql`create table if not exists "schema_migrations" ("version" text primary key not null, "applied_at" timestamp with time zone default now() not null)`;

export interface RunMigrationsOptions {
  /** Directory to read the SQL from. Defaults to the shipped migration set. */
  dir?: string;
}

/** The SQL files that ship with the app, in the order they must be applied. */
export async function listMigrationFiles(dir: string = DEFAULT_DIR): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((name) => name.endsWith('.sql')).sort();
}

/** One file is one or more statements, separated by drizzle-kit's breakpoint marker. */
export function splitStatements(contents: string): string[] {
  return contents
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** Applies every pending file and returns their names, oldest first. */
export async function runMigrations(db: Db, options: RunMigrationsOptions = {}): Promise<string[]> {
  const dir = options.dir ?? DEFAULT_DIR;

  await db.execute(BOOTSTRAP_LEDGER);

  const recorded = await db.select({ version: schemaMigrations.version }).from(schemaMigrations);
  const applied = new Set(recorded.map((row) => row.version));

  const ran: string[] = [];
  for (const file of await listMigrationFiles(dir)) {
    if (applied.has(file)) continue;

    // The shipped migration set reaches the server bundle through outputFileTracingIncludes in
    // next.config.ts, so this read deliberately opts out of bundler tracing: traced, its
    // unresolvable directory makes Turbopack pull the entire project — docs, tests, lockfiles —
    // into every deployment.
    const contents = await readFile(path.join(/* turbopackIgnore: true */ dir, file), 'utf8');
    const statements = splitStatements(contents);
    await db.transaction(async (tx) => {
      for (const statement of statements) {
        await tx.execute(sql.raw(statement));
      }
      await tx.insert(schemaMigrations).values({ version: file }).onConflictDoNothing();
    });
    ran.push(file);
  }

  return ran;
}
