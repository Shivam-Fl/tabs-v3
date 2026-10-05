import { pathToFileURL } from 'node:url';
import { withDb } from '../lib/db/client';
import { runMigrations } from '../lib/db/migrate';
import { isProduction } from '../lib/env';
import {
  SEED_ACCOUNTS,
  SEED_PASSWORD,
  SEED_REQUEST_HEADER,
  SEED_REQUEST_VALUE,
  loadFixtures,
  type SeedSummary,
} from '../lib/seed/fixtures';

/**
 * `npm run sdlc:seed` — the fixtures, written where somebody can see them (TR-12, IAC-3).
 *
 * The seed has two ways in and this script chooses between them, because "the database" is two
 * different things depending on how the product is running.
 *
 * - When an app is serving on the app URL, it posts to that app's dev-only `/api/seed` route and
 *   the app writes the fixtures from inside the process that owns the connection. This is the
 *   local case, and it is the only way the fixture rows can reach a browser: with no connection
 *   string configured the database is in-memory and belongs to one process, so seeding it from
 *   here would fill a database nobody is looking at.
 * - When nothing is listening, the script loads the shared fixture set itself, applying the
 *   migrations first. That is the CI and deployed case, where the script and the app are either
 *   the only thing running or pointed at the same durable database.
 *
 * Only a connection that was **refused** falls back — nothing listening at that address at all.
 * An app that answered and refused, and an app that never answered because it is wedged, are
 * both failures, and loudly: the two paths write different databases in the embedded case, so
 * quietly taking the other one would report a success that no screen would ever show.
 *
 * Production is refused before either path — the loader deletes what is there.
 *
 * Exported side-effect free so a test can import it without booting Next or writing anything.
 */
export const DEFAULT_APP_URL = 'http://localhost:3000';

/** How long a running app gets to answer before it is treated as not there. */
const SEED_TIMEOUT_MS = 10_000;

/** How the fixtures were written. */
export type SeedRoute = 'app' | 'direct';

export interface SeedRun {
  via: SeedRoute;
  appUrl: string;
  summary: SeedSummary;
  /** The migrations this run applied itself. Empty when an app answered — it ran them at boot. */
  migrationsApplied: string[];
}

export interface SeedOptions {
  /** Where a serving app can be reached. Defaults to `http://localhost:3000`. */
  appUrl?: string;
}

const SUMMARY_KEYS = [
  'users',
  'groups',
  'memberships',
  'expenses',
  'payments',
  'activity',
] as const;

const PRODUCTION_REFUSAL =
  'Refusing to seed: this deployment is production, and seeding replaces the data that is there. Run the seed against a development environment instead.';

function normalizeAppUrl(raw: string | undefined): string {
  return (raw ?? DEFAULT_APP_URL).trim().replace(/\/+$/, '');
}

/**
 * The route's answer read back as a summary, or an error naming what was wrong with it.
 *
 * The app is a separate process and can be a separate version of this code, so its answer is
 * checked rather than trusted: a 200 carrying something else is a seed that did not happen, and
 * reporting counts of `undefined` as a success is exactly the silent failure this whole
 * choose-a-path business exists to avoid.
 */
function readSummary(payload: unknown, appUrl: string): SeedSummary {
  const record =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const summary = {} as SeedSummary;

  for (const key of SUMMARY_KEYS) {
    const value = record[key];
    if (typeof value !== 'number') {
      throw new Error(
        `${appUrl} answered the seed request, but its answer had no ${key} count: ${JSON.stringify(payload)}`,
      );
    }
    summary[key] = value;
  }

  return summary;
}

/** The message a refusal carried, when it carried one, for the error below to quote. */
async function refusalDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    return typeof body?.message === 'string' ? ` — ${body.message}` : '';
  } catch {
    return '';
  }
}

/**
 * Asks a serving app to seed itself, or returns null when nothing answered at that address.
 *
 * The timeout is generous because everything it covers is on the same machine and takes under a
 * second; a request that runs past it means the app is wedged, which is a reason to stop rather
 * than to take the other path.
 */
async function seedThroughApp(appUrl: string): Promise<SeedSummary | null> {
  let response: Response;

  try {
    response = await fetch(`${appUrl}/api/seed`, {
      method: 'POST',
      headers: { [SEED_REQUEST_HEADER]: SEED_REQUEST_VALUE },
      signal: AbortSignal.timeout(SEED_TIMEOUT_MS),
    });
  } catch (error) {
    // Nothing is listening on that port, so there is no app whose database this could be — and
    // that is exactly what a refused connection looks like: fetch rejects with a TypeError.
    // Every other rejection is an app that is there but did not answer, the timeout above
    // being the one this function's whole shape is about. Taking the direct path for that would
    // write a database no browser reads and report success, so it propagates and runSeed fails.
    if (error instanceof TypeError) return null;
    throw error;
  }

  if (!response.ok) {
    throw new Error(
      `${appUrl} answered ${response.status} to POST /api/seed${await refusalDetail(response)}. Nothing was seeded.`,
    );
  }

  return readSummary(
    await response.json().catch(() => null),
    appUrl,
  );
}

export async function runSeed(options: SeedOptions = {}): Promise<SeedRun> {
  if (isProduction()) throw new Error(PRODUCTION_REFUSAL);

  const appUrl = normalizeAppUrl(options.appUrl);

  const throughApp = await seedThroughApp(appUrl);
  if (throughApp) return { via: 'app', appUrl, summary: throughApp, migrationsApplied: [] };

  const loaded = await withDb(async (handle) => ({
    migrationsApplied: await runMigrations(handle.db),
    summary: await loadFixtures(handle.db),
  }));

  return { via: 'direct', appUrl, ...loaded };
}

function migrationLine(applied: readonly string[]): string {
  return applied.length === 0
    ? '[sdlc] seed: migrations already up to date'
    : `[sdlc] seed: applied ${applied.join(', ')}`;
}

function summaryLine(summary: SeedSummary): string {
  return [
    `${summary.users} users`,
    `${summary.groups} groups`,
    `${summary.memberships} memberships`,
    `${summary.expenses} expenses`,
    `${summary.payments} payments`,
    `${summary.activity} activity rows`,
  ].join(', ');
}

/** Everything a person needs to sign in and look at what was just written. */
function report(run: SeedRun): void {
  if (run.via === 'app') {
    console.log(`[sdlc] seed: the fixtures were written by the app at ${run.appUrl}`);
  } else {
    console.log(migrationLine(run.migrationsApplied));
    console.log(
      `[sdlc] seed: no app answered at ${run.appUrl}, so this process wrote the fixtures itself`,
    );
    console.log(
      '[sdlc] seed: if you were expecting to see them in a browser, start the app first and run the seed again — a running app keeps its own copy of the fixtures.',
    );
  }

  console.log(`[sdlc] seed: ${summaryLine(run.summary)}`);
  console.log(`[sdlc] seed: sign in as one of ${SEED_ACCOUNTS.map((a) => a.email).join(', ')}`);
  console.log(`[sdlc] seed: password ${SEED_PASSWORD} — every seeded account uses it`);
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  try {
    report(await runSeed());
  } catch (error) {
    // A seed that failed has to say so in the exit status: the deploy and QA both read it.
    console.error(`[sdlc] seed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
