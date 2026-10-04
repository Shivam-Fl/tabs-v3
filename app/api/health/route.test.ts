import { afterEach, describe, expect, it, vi } from 'vitest';

// The route imports withDb from this exact specifier, so replacing it here is what lets the
// "database is unreachable" case be exercised without a broken server underneath.
vi.mock('../../../lib/db/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/db/client')>();
  return { ...actual, withDb: vi.fn(actual.withDb) };
});

const { GET } = await import('./route');
const { withDb } = await import('../../../lib/db/client');
const { runMigrations } = await import('../../../lib/db/migrate');

afterEach(() => {
  vi.mocked(withDb).mockClear();
});

describe('GET /api/health', () => {
  // No migrations have run on this process's database yet, so the ledger the probe reads is
  // missing — the same shape as a database that is reachable but not migrated.
  it('reports 503 degraded while the migration ledger is missing', async () => {
    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: 'degraded', db: 'down' });
  });

  it('reports 200 ok once boot migrations have applied', async () => {
    await withDb((handle) => runMigrations(handle.db));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
    expect(typeof body.latencyMs).toBe('number');
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports the same 503 shape when the database throws outright', async () => {
    vi.mocked(withDb).mockRejectedValueOnce(new Error('connection terminated'));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: 'degraded', db: 'down' });
  });
});
