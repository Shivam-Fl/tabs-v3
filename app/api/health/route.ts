import { withDb } from '../../../lib/db/client';
import { schemaMigrations } from '../../../lib/db/schema';

// A health probe answers for the instance serving it, so it is never cached or prerendered.
export const dynamic = 'force-dynamic';

/**
 * Reads the migration ledger rather than running `SELECT 1`. Reachability is already implied
 * by any query succeeding; reading the ledger additionally proves the boot migrations ran on
 * the instance answering this request, which is the thing a deploy actually needs to know.
 *
 * 503 on any failure keeps `sdlc:ready`'s `curl -fsS` red exactly when the database is down.
 * Only Web-standard Request/Response are used, so the handler is unit-testable without Next.
 */
export async function GET(): Promise<Response> {
  const startedAt = Date.now();

  try {
    await withDb(async (handle) => {
      await handle.db.select({ version: schemaMigrations.version }).from(schemaMigrations);
    });

    return Response.json({ status: 'ok', db: 'ok', latencyMs: Date.now() - startedAt });
  } catch (error) {
    console.error('[sdlc] health probe failed:', error);
    return Response.json(
      { status: 'degraded', db: 'down', latencyMs: Date.now() - startedAt },
      { status: 503 },
    );
  }
}
