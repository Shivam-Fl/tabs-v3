import { withDb } from '../../../lib/db/client';
import { isProduction } from '../../../lib/env';
import {
  SEED_REQUEST_HEADER,
  SEED_REQUEST_VALUE,
  loadFixtures,
} from '../../../lib/seed/fixtures';

// Seeding is a write, and this route must answer for the instance serving it: caching or
// prerendering a seed would be a seed that never ran.
export const dynamic = 'force-dynamic';

/**
 * The dev-only seed endpoint.
 *
 * It exists for one reason: with no connection string configured, the database is an embedded
 * in-memory one living inside a single server process, so a script that seeds "the database" from
 * its own process seeds a database nobody is looking at. The fixtures reach the browser only if
 * the *serving* process writes them, and a request to this route is how `scripts/seed.ts` asks it
 * to.
 *
 * Three guards, in the order they matter:
 *
 * 1. **Production is refused before anything else happens** — before the loader, before a
 *    connection is opened. A deployment that answers this route is a deployment whose data can be
 *    replaced from outside, so the refusal is on `isProduction()` (VERCEL_ENV, per `lib/env.ts`)
 *    rather than on NODE_ENV, which is `production` for every `next start` including the local
 *    one the seed is meant to work against.
 * 2. **The request has to carry `x-tabs-seed`.** This is a same-origin guard, not authentication:
 *    a custom header is enough to make a cross-site `POST` a preflighted request, and a dev
 *    server answers no preflight, so another page in the developer's browser cannot reset their
 *    fixtures behind their back. `scripts/seed.ts` is the caller and sets it.
 * 3. **Failures are reported, never swallowed.** A seed that half-wrote and answered 200 would
 *    leave the caller believing a fixture set exists that does not.
 *
 * POST only: a GET could be triggered by an image or a prefetch, and this route has effects.
 */
export async function POST(request: Request): Promise<Response> {
  if (isProduction()) {
    console.warn('[tabs] seed: refused — this deployment is production');
    return Response.json(
      {
        status: 'refused',
        message: 'The seed route is disabled in production.',
      },
      { status: 403 },
    );
  }

  if (request.headers.get(SEED_REQUEST_HEADER) !== SEED_REQUEST_VALUE) {
    return Response.json(
      {
        status: 'refused',
        message: `A seed request must carry the ${SEED_REQUEST_HEADER}: ${SEED_REQUEST_VALUE} header.`,
      },
      { status: 403 },
    );
  }

  try {
    const summary = await withDb((handle) => loadFixtures(handle.db));
    return Response.json({ status: 'ok', ...summary });
  } catch (error) {
    // The detail goes to the server log, where the person who started the server can read it;
    // the caller gets the one fact it can act on.
    console.error('[tabs] seed: the fixture loader failed', error);
    return Response.json(
      { status: 'failed', message: 'The seed did not complete. See the server log.' },
      { status: 500 },
    );
  }
}
