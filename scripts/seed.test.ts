import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { eq, isNull } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyPassword } from '../lib/auth/password';
import { withDb } from '../lib/db/client';
import { runMigrations } from '../lib/db/migrate';
import {
  activityEvents,
  expensePayers,
  expenses,
  groups,
  memberships,
  payments,
  splitLines,
  users,
} from '../lib/db/schema';
import {
  SEED_ACCOUNTS,
  SEED_PASSWORD,
  SEED_REQUEST_HEADER,
  type SeedSummary,
} from '../lib/seed/fixtures';
import { runSeed } from './seed';

/**
 * The seed verb, on both of its paths.
 *
 * The fixture *set* is asserted here rather than in the route's test because this is the file
 * that owns the contract the verb promises: a QA run signs in with these addresses, sees an
 * expense of every split type, and finds both feeds non-empty the first time it boots. The route
 * test covers the door; this covers what is behind it.
 *
 * The three delivery cases are the ones that make the verb work at all. "An app answered" and
 * "nothing answered" lead to different databases when the embedded one is in use, so the
 * distinction is not a convenience — taking the wrong branch silently is how a seed reports
 * success while a browser shows nothing.
 */

/** A port nothing can be listening on, so the direct path is chosen deliberately. */
const NO_APP = 'http://127.0.0.1:1';

/** The fixture, written out: what the seed promises, in one line a reader can check. */
const EXPECTED: SeedSummary = {
  users: 3,
  groups: 2,
  memberships: 6,
  expenses: 6,
  payments: 2,
  activity: 12,
};

async function seedDirectly(): Promise<SeedSummary> {
  return (await runSeed({ appUrl: NO_APP })).summary;
}

/** Runs `body` against a real HTTP server, and closes it however `body` ends. */
async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  body: (appUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  try {
    await body(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function answering(status: number, payload: unknown): (request: IncomingMessage, response: ServerResponse) => void {
  return (_request, response) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  };
}

beforeAll(async () => {
  await withDb((handle) => runMigrations(handle.db));
});

beforeEach(async () => {
  await withDb(async (handle) => {
    await handle.db.delete(activityEvents);
    await handle.db.delete(splitLines);
    await handle.db.delete(expensePayers);
    await handle.db.delete(expenses);
    await handle.db.delete(payments);
    await handle.db.delete(memberships);
    await handle.db.delete(groups);
    await handle.db.delete(users);
  });
});

afterEach(() => {
  delete process.env.VERCEL_ENV;
});

describe('the fixture set', () => {
  it('writes the whole set, and says so in its summary', async () => {
    const summary = await seedDirectly();

    expect(summary).toEqual(EXPECTED);
  });

  it('writes the three accounts QA signs in as, with a password that verifies', async () => {
    await seedDirectly();

    const accounts = await withDb((handle) =>
      handle.db
        .select({ email: users.email, passwordHash: users.passwordHash })
        .from(users),
    );

    expect(accounts.map((account) => account.email).sort()).toEqual(
      SEED_ACCOUNTS.map((account) => account.email).sort(),
    );

    for (const account of accounts) {
      // The point of the fixture: QA can log in, rather than having to know a hash.
      expect(await verifyPassword(SEED_PASSWORD, account.passwordHash)).toBe(true);
      expect(await verifyPassword('not-the-password', account.passwordHash)).toBe(false);
    }
  });

  it('writes one expense of every split type, with the inputs beside the shares', async () => {
    await seedDirectly();

    const { types, percentage } = await withDb(async (handle) => ({
      types: (await handle.db.select({ splitType: expenses.splitType }).from(expenses)).map(
        (row) => row.splitType,
      ),
      percentage: await handle.db
        .select({
          displayName: splitLines.displayName,
          included: splitLines.included,
          inputValue: splitLines.inputValue,
          shareMinor: splitLines.shareMinor,
        })
        .from(splitLines)
        .innerJoin(expenses, eq(expenses.id, splitLines.expenseId))
        .where(eq(expenses.description, 'Groceries for the week')),
    }));

    expect([...new Set(types)].sort()).toEqual(['equal', 'exact', 'percentage', 'shares']);

    // ADR-0007: the rule the person entered is stored, not just what it came to. 50/25/25 of
    // 1250.00 is 625.00/312.50/312.50, and both halves are on the row.
    const inSplit = percentage
      .filter((line) => line.included)
      .map((line) => ({ displayName: line.displayName, inputValue: line.inputValue, shareMinor: line.shareMinor }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));

    expect(inSplit).toEqual([
      { displayName: 'Ada', inputValue: 5000, shareMinor: 62_500 },
      { displayName: 'Bo', inputValue: 2500, shareMinor: 31_250 },
      { displayName: 'Cy', inputValue: 2500, shareMinor: 31_250 },
    ]);

    // The held seat is offered and left out, which is a row with nothing typed on it and nothing
    // owed — see the shape test below for why the fixture writes the row at all.
    expect(percentage.filter((line) => !line.included)).toEqual([
      { displayName: 'Dee', included: false, inputValue: null, shareMinor: 0 },
    ]);
  });

  it('writes a split line for every seat the group offers, the held one marked out', async () => {
    await seedDirectly();

    const { seats, lines } = await withDb(async (handle) => ({
      seats: await handle.db
        .select({ id: memberships.id })
        .from(memberships)
        .innerJoin(groups, eq(groups.id, memberships.groupId))
        .where(eq(groups.name, 'Goa trip')),
      lines: await handle.db
        .select({
          expenseId: splitLines.expenseId,
          amountMinor: expenses.amountMinor,
          membershipId: splitLines.membershipId,
          included: splitLines.included,
          inputValue: splitLines.inputValue,
          shareMinor: splitLines.shareMinor,
        })
        .from(splitLines)
        .innerJoin(expenses, eq(expenses.id, splitLines.expenseId))
        .innerJoin(groups, eq(groups.id, expenses.groupId))
        .where(eq(groups.name, 'Goa trip')),
    }));

    // The editor renders a row for every member of the group, and the save keeps a line for each
    // one: `splitAmount` stores "the ones left out marked rather than absent". A fixture with the
    // left-out seat simply missing would be a shape no screen produces, and editing it back would
    // put a participants change in the feed that nobody made.
    const byExpense = new Map<string, typeof lines>();
    for (const line of lines) {
      byExpense.set(line.expenseId, [...(byExpense.get(line.expenseId) ?? []), line]);
    }

    expect(byExpense.size).toBe(5);
    for (const rows of byExpense.values()) {
      expect(new Set(rows.map((row) => row.membershipId))).toEqual(
        new Set(seats.map((seat) => seat.id)),
      );
      expect(rows).toHaveLength(seats.length);

      const inSplit = rows.filter((row) => row.included);
      expect(inSplit).toHaveLength(seats.length - 1);

      // A seat left out owes nothing and typed nothing, so the included shares still come to the
      // whole: the extra row is a record of who was offered the expense, not money.
      for (const row of rows.filter((line) => !line.included)) {
        expect(row).toMatchObject({ inputValue: null, shareMinor: 0 });
      }
      expect(inSplit.reduce((sum, row) => sum + row.shareMinor, 0)).toBe(rows[0].amountMinor);
    }
  });

  it('writes a multi-payer expense whose parts sum to the whole', async () => {
    await seedDirectly();

    const payers = await withDb((handle) =>
      handle.db
        .select({
          expenseId: expensePayers.expenseId,
          amountMinor: expensePayers.amountMinor,
          position: expensePayers.position,
        })
        .from(expensePayers)
        .innerJoin(expenses, eq(expenses.id, expensePayers.expenseId))
        .where(eq(expenses.description, 'Boat rental')),
    );

    expect(payers.map((payer) => payer.amountMinor).sort((a, b) => a - b)).toEqual([
      100_000, 200_000,
    ]);
    expect(payers.reduce((sum, payer) => sum + payer.amountMinor, 0)).toBe(300_000);
    // The position column is the order they were entered, which is who absorbs the remainder.
    expect(payers.map((payer) => payer.position).sort()).toEqual([0, 1]);
  });

  it('writes a placeholder seat with no account behind it', async () => {
    await seedDirectly();

    const placeholders = await withDb((handle) =>
      handle.db
        .select({ displayName: memberships.displayName })
        .from(memberships)
        .where(isNull(memberships.userId)),
    );

    expect(placeholders.map((seat) => seat.displayName)).toEqual(['Dee']);
  });

  it('writes both payments', async () => {
    await seedDirectly();

    const rows = await withDb((handle) =>
      handle.db
        .select({
          from: payments.fromDisplayName,
          to: payments.toDisplayName,
          amountMinor: payments.amountMinor,
        })
        .from(payments),
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.from !== row.to)).toBe(true);
  });
});

describe('running it twice', () => {
  it('leaves one fixture set, not two', async () => {
    const first = await seedDirectly();
    const second = await seedDirectly();

    expect(second).toEqual(first);

    const counted = await withDb(async (handle) => ({
      users: (await handle.db.select({ id: users.id }).from(users)).length,
      expenses: (await handle.db.select({ id: expenses.id }).from(expenses)).length,
      activity: (await handle.db.select({ id: activityEvents.id }).from(activityEvents)).length,
    }));

    expect(counted).toEqual({ users: EXPECTED.users, expenses: EXPECTED.expenses, activity: EXPECTED.activity });
  });
});

describe('the feed the fixtures write', () => {
  it('has rows for expenses, payments and joins, all at distinct, rising instants', async () => {
    await seedDirectly();

    const rows = await withDb((handle) =>
      handle.db
        .select({ kind: activityEvents.kind, createdAt: activityEvents.createdAt })
        .from(activityEvents),
    );

    const kinds = new Set(rows.map((row) => row.kind));
    expect(kinds).toContain('expense-created');
    expect(kinds).toContain('payment-created');
    expect(kinds).toContain('join');
    expect(kinds).toContain('member-added');

    // A clock would make these collide and the feed's order would change between reads; a fixed
    // schedule makes "newest first" mean the same thing on every boot and in every test.
    const moments = rows.map((row) => row.createdAt.getTime());
    expect(new Set(moments).size).toBe(moments.length);
  });

  it('reads newest-first as the reverse of the order the fixture wrote them', async () => {
    await seedDirectly();

    const rows = await withDb((handle) =>
      handle.db
        .select({ kind: activityEvents.kind, createdAt: activityEvents.createdAt })
        .from(activityEvents),
    );

    const ascending = [...rows].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

    expect(ascending[0].kind).toBe('join');
    expect(ascending[ascending.length - 1].kind).toBe('payment-created');
  });
});

describe('which way it seeds', () => {
  it('seeds through the app when the app answers, and touches nothing locally', async () => {
    const answer: SeedSummary = { ...EXPECTED };

    await withServer(answering(200, { status: 'ok', ...answer }), async (appUrl) => {
      const run = await runSeed({ appUrl });

      expect(run.via).toBe('app');
      expect(run.summary).toEqual(answer);
      // The direct path would have applied them itself; this one left them to the app's boot.
      expect(run.migrationsApplied).toEqual([]);
    });

    // The local database was left alone: in the embedded case the script's own connection and
    // the app's are different databases, which is the whole reason this path exists.
    expect(await withDb((handle) => handle.db.select({ id: users.id }).from(users))).toEqual([]);
  });

  it('sends the seed header on the request', async () => {
    let header: string | undefined;
    let method: string | undefined;
    let url: string | undefined;

    await withServer(
      (request, response) => {
        header = request.headers[SEED_REQUEST_HEADER] as string | undefined;
        method = request.method;
        url = request.url;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok', ...EXPECTED }));
      },
      async (appUrl) => {
        await runSeed({ appUrl });
      },
    );

    expect(method).toBe('POST');
    expect(url).toBe('/api/seed');
    expect(header).toBe('1');
  });

  it('fails loudly when the app answers and refuses, rather than seeding anyway', async () => {
    await withServer(
      answering(403, { status: 'refused', message: 'The seed route is disabled in production.' }),
      async (appUrl) => {
        await expect(runSeed({ appUrl })).rejects.toThrow(/403.*disabled in production/s);
      },
    );

    expect(await withDb((handle) => handle.db.select({ id: users.id }).from(users))).toEqual([]);
  });

  it('seeds directly when nothing is listening', async () => {
    const run = await runSeed({ appUrl: NO_APP });

    expect(run.via).toBe('direct');
    expect(run.summary).toEqual(EXPECTED);

    // The rows landed in this process's own database, which is the thing the app path above
    // deliberately does not do. (`migrationsApplied` is empty here only because the suite's own
    // `beforeAll` already ran them on this shared instance.)
    expect(
      await withDb((handle) => handle.db.select({ id: users.id }).from(users)),
    ).toHaveLength(EXPECTED.users);
  });

  // The case the timeout exists for, and the one that used to report success: an app that is
  // listening but wedged. Refused connections are a TypeError and fall through to the direct
  // path above; a timeout is not, and must not. Taking the direct path here would write the
  // fixtures into this process's own database, which no browser reads — an exit 0 over a seed
  // nobody can see. The rejection is stubbed rather than waited for, because the real one takes
  // the full ten seconds; the runner is what the runtime actually throws, so it is the real
  // class and not a lookalike.
  it('fails loudly, and writes nothing locally, when the app does not answer', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    expect(timeout).not.toBeInstanceOf(TypeError);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));

    try {
      await expect(runSeed({ appUrl: NO_APP })).rejects.toThrow(/timeout/i);
    } finally {
      vi.unstubAllGlobals();
    }

    // Not seeded directly, and not reported as a success: the whole point of the distinction.
    expect(await withDb((handle) => handle.db.select({ id: users.id }).from(users))).toEqual([]);
  });

  it('refuses in production before it reaches either path', async () => {
    let requests = 0;

    process.env.VERCEL_ENV = 'production';

    await withServer(
      (request, response) => {
        requests += 1;
        response.writeHead(200);
        response.end('{}');
      },
      async (appUrl) => {
        await expect(runSeed({ appUrl })).rejects.toThrow(/Refusing to seed/);
      },
    );

    // Not "it failed" but "it never started": an app was listening, and nothing asked it.
    expect(requests).toBe(0);
  });
});

