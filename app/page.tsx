import type { Metadata } from 'next';
import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import type { SessionUser } from '../lib/auth/session';
import { getSessionUser } from '../lib/auth/session';
import { withDb } from '../lib/db/client';
import { listGroupsForUser, type GroupSummary } from '../lib/groups/queries';
import { GROUP_TYPE_LABELS, type GroupType } from '../lib/groups/validation';
import { formatMinorUnits } from '../lib/money/format';

export const metadata: Metadata = { title: 'Tabs' };

interface HomeData {
  user: SessionUser | null;
  groups: GroupSummary[];
}

/**
 * The Home screen (TR-11): what you owe or are owed, and which group needs attention.
 *
 * Everything it shows comes from the request's own session in one handle — the signed-in user
 * and, if there is one, the groups their memberships reach. The list is `listGroupsForUser`'s,
 * so "groups I belong to" is one query rather than a filter re-decided here.
 *
 * The balances are zero because the ledger that moves them (TR-8, TR-9) is not built yet, and
 * zero is the true answer rather than a placeholder: with no expenses recorded, nobody owes
 * anybody. The slot each group renders is the one TR-9 starts filling.
 */
export default async function HomePage() {
  let data: HomeData;
  let failed = false;

  try {
    data = await withDb(async (handle) => {
      const user = await getSessionUser(handle.db);
      if (!user) return { user: null, groups: [] };
      return { user, groups: await listGroupsForUser(handle.db, user.id) };
    });
  } catch (error) {
    // Next marks a route dynamic by throwing through it — reading the session's cookie means
    // this page is one, and that throw is control flow rather than a failure to report. Let it
    // through, or the build renders the error card instead of a dynamic route.
    unstable_rethrow(error);

    // The technical detail goes to the server log; the screen gets a message and one way out.
    console.error('[tabs] home: could not load groups', error);
    data = { user: null, groups: [] };
    failed = true;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1024px] flex-col gap-5 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Tabs</h1>
        {data.user ? (
          <Link className="text-accent underline" href="/profile">
            {data.user.displayName}
          </Link>
        ) : null}
      </header>

      {failed ? (
        <section
          className="flex flex-col gap-3 rounded-token border border-danger/40 bg-surface p-4"
          aria-labelledby="home-error"
        >
          <h2 id="home-error" className="text-lg font-semibold">
            We could not load your groups
          </h2>
          <p className="text-muted">
            Nothing has been lost — the data did not come back this time. Try again.
          </p>
          <Link className="text-accent underline" href="/">
            Retry
          </Link>
        </section>
      ) : data.user === null ? (
        <>
          <p className="max-w-[72ch] text-muted">
            Tabs keeps a group&rsquo;s shared expenses straight: who paid for what, what everyone
            owes, and the fewest payments that settle it up.
          </p>
          <p className="max-w-[72ch] text-muted">
            <Link className="text-accent underline" href="/signin">
              Sign in
            </Link>{' '}
            or{' '}
            <Link className="text-accent underline" href="/signup">
              create an account
            </Link>{' '}
            to start a group.
          </p>
        </>
      ) : (
        <SignedInHome user={data.user} groups={data.groups} />
      )}

      <p>
        <a className="text-accent underline" href="/api/health">
          /api/health
        </a>
      </p>
    </main>
  );
}

function SignedInHome({ user, groups }: { user: SessionUser; groups: GroupSummary[] }) {
  return (
    <>
      <section className="flex flex-col gap-3" aria-labelledby="balances-heading">
        <h2 id="balances-heading" className="text-lg font-semibold">
          Your balances
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-token border border-muted/20 bg-surface p-4">
            <p className="text-sm text-muted">You are owed</p>
            <p data-amount className="text-xl font-semibold text-lent">
              {formatMinorUnits(0, user.currency)}
            </p>
          </div>
          <div className="rounded-token border border-muted/20 bg-surface p-4">
            <p className="text-sm text-muted">You owe</p>
            <p data-amount className="text-xl font-semibold text-owed">
              {formatMinorUnits(0, user.currency)}
            </p>
          </div>
        </div>
        <p className="text-sm text-muted">
          Everyone is settled up. Balances appear here once your groups record expenses.
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="groups-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="groups-heading" className="text-lg font-semibold">
            Your groups
          </h2>
          <Link
            className="min-h-11 rounded-token bg-accent px-4 font-medium leading-[2.75rem] text-surface"
            href="/groups/new"
          >
            New group
          </Link>
        </div>

        {groups.length === 0 ? (
          <div className="flex flex-col gap-3 rounded-token border border-muted/20 bg-surface p-4">
            <p className="font-medium">No groups yet</p>
            <p className="text-muted">
              A group is the people you split with — a trip, a flat, a couple. Create one and add
              everyone to it.
            </p>
            <Link className="text-accent underline" href="/groups/new">
              Create your first group
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {groups.map((group) => (
              <li
                key={group.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-token border border-muted/20 bg-surface p-4"
              >
                <div className="flex flex-col">
                  <Link className="font-medium text-accent underline" href={`/groups/${group.id}`}>
                    {group.name}
                  </Link>
                  <span className="text-sm text-muted">
                    {group.currency} · {GROUP_TYPE_LABELS[group.type as GroupType] ?? group.type}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted">
                    <span className="sr-only">Balance </span>Settled
                  </p>
                  <p data-amount className="font-semibold">
                    {formatMinorUnits(0, group.currency)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
