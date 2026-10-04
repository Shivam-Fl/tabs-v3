import { PGlite } from '@electric-sql/pglite';
import { Pool, neonConfig } from '@neondatabase/serverless';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import { isProduction } from '../env';
import * as schema from './schema';

/**
 * The only module in the product allowed to know which database backend is active. Everything
 * else — routes, scripts, the Drizzle config — goes through the handle this returns, because
 * CI and QA only ever exercise the embedded backend: a branch on the remote one written
 * anywhere else would ship untested. `lib/db/backend-invariant.test.ts` fails the build if
 * another file names either backend.
 */
export type Backend = 'pglite' | 'neon';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  backend: Backend;
  /** Releases whatever this call opened. Always call it — for the embedded backend it is a no-op. */
  close: () => Promise<void>;
}

const MISSING_DATABASE_URL =
  'Missing required secret: DATABASE_URL. Production refuses to boot on the embedded local database — set the pooled connection string from the Vercel Neon integration.';

function connectionUrl(): string | undefined {
  // Empty and whitespace-only both count as unset, so a blank Vercel env var cannot select
  // the remote backend and then fail to reach it.
  const raw = process.env.DATABASE_URL?.trim();
  return raw ? raw : undefined;
}

/** Which backend this process would select right now. Safe to call before connecting. */
export function selectedBackend(): Backend {
  return connectionUrl() ? 'neon' : 'pglite';
}

/**
 * The raw connection string the backend selection was made from, for the smoke script and the
 * Drizzle config. `undefined` means the embedded backend. Exposed here so nothing else has to
 * read the environment variable itself.
 */
export function connectionString(): string | undefined {
  return connectionUrl();
}

/**
 * The embedded database is process-scoped, not request-scoped: it lives in memory, so
 * creating one per request would wipe everything the previous request wrote. One instance
 * serves every request in the process, and the migration ledger inside it is what remembers
 * that boot migrations already ran. Production durability comes from the remote backend
 * only — nothing here outlives the process, which is what the deploy story assumes.
 *
 * It hangs off `globalThis` rather than a module binding because a production build gives
 * `instrumentation.ts` and each route entry a module registry apiece. Two module-level
 * bindings would be two PGlite instances, two empty databases, and a boot migration the
 * health route then could not see. `globalThis` is the process, so there is exactly one.
 */
interface EmbeddedSingleton {
  client: PGlite;
  db: Db;
}

const globalForDb = globalThis as typeof globalThis & { tabsEmbeddedDb?: EmbeddedSingleton };

const EMBEDDED_CLOSE = async (): Promise<void> => {
  // Deliberately nothing: see above — tearing this down per request would be data loss.
};

function embeddedHandle(): DbHandle {
  const existing = globalForDb.tabsEmbeddedDb;
  if (existing) {
    return { db: existing.db, backend: 'pglite', close: EMBEDDED_CLOSE };
  }

  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  globalForDb.tabsEmbeddedDb = { client, db };

  return { db, backend: 'pglite', close: EMBEDDED_CLOSE };
}

function remoteHandle(url: string): DbHandle {
  // The Node serverless runtime is not guaranteed a global WebSocket, so the driver is handed
  // the ws implementation explicitly rather than relying on one being present.
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: url });
  return {
    db: drizzleNeon(pool, { schema }),
    backend: 'neon',
    close: async () => {
      await pool.end();
    },
  };
}

/**
 * Opens a handle to the active backend. With a connection string set this opens a pool for
 * the caller; with it unset the shared embedded instance is returned. Callers should prefer
 * `withDb`, which closes what it opened even when the work throws.
 */
export async function getDb(): Promise<DbHandle> {
  const url = connectionUrl();

  if (!url) {
    if (isProduction()) throw new Error(MISSING_DATABASE_URL);
    return embeddedHandle();
  }

  return remoteHandle(url);
}

/** Runs `fn` against a handle, releasing the connection afterwards however `fn` ends. */
export async function withDb<T>(fn: (handle: DbHandle) => Promise<T>): Promise<T> {
  const handle = await getDb();
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}
