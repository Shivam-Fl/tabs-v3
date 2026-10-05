import type { Metadata } from 'next';
import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import type { SessionUser } from '../lib/auth/session';
import { getSessionUser } from '../lib/auth/session';
import { withDb } from '../lib/db/client';
import { listGroupsForUser, type GroupSummary } from '../lib/groups/queries';
import {
  GROUP_TYPE_LABELS,
  LEFT_NOTICE_PARAM,
  leftNoticeText,
  parseNoticeName,
  type GroupType,
} from '../lib/groups/validation';
import { formatMinorUnits } from '../lib/money/format';
import { computeNetBalances } from '../lib/settle/balances';
import { simplifyDebts } from '../lib/settle/simplify';
import { summarizeHome, type GroupBalanceInput, type HomeSummary } from '../lib/settle/summary';

export const metadata: Metadata = { title: 'Tabs' };

/**
 * What the screen has to render, in the two states it can be in: a session with its groups and
 * totals, or none at all. The summary is only ever null with the user, so the card below can
 * read a number without a fallback that would render an empty one as if it were real.
 */
type HomeData =
  | { user: SessionUser; groups: GroupSummary[]; summary: HomeSummary }
  | { user: null; groups: GroupSummary[]; summary: null };

/**
 * The Home screen (TR-11, TR-9): what you owe or are owed, who you owe it to, and which group
 * needs attention.
 *
 * Everything it shows comes from the request's own session in one handle — the signed-in user,
 * the groups their memberships reach, and then each group's balances and simplified transfers,
 * one group at a time (the embedded backend serves a single connection, so concurrent queries
 * would be a queue pretending to be a race). The arithmetic is not done here: the per-group nets
 * and the transfer list are the group page's own two calls, and `summarizeHome` is the one place
 * that decides how they add up across groups, which currency counts, and how one person's rows
 * net together.
 *
 * Leaving a group already landed here; it now carries the group's name in the query, because
 * the members page the confirming form lived on is not a page the leaver can still see (AC-11).
 * The note is additive: a signed-out or failed home renders exactly as it did before.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ left?: string }>;
}) {
  const query = await searchParams;
  const leftName = parseNoticeName(query[LEFT_NOTICE_PARAM]);

  let data: HomeData;
  let failed = false;

  try {
    data = await withDb(async (handle) => {
      const user = await getSessionUser(handle.db);
      if (!user) return { user: null, groups: [], summary: null };

      const groups = await listGroupsForUser(handle.db, user.id);
      const inputs: GroupBalanceInput[] = [];

      for (const group of groups) {
        const balances = await computeNetBalances(handle.db, group.id);
        inputs.push({
          groupId: group.id,
          groupName: group.name,
          currency: group.currency,
          viewerMembershipId: group.membershipId,
          balances,
          transfers: simplifyDebts(balances),
        });
      }

      return { user, groups, summary: summarizeHome(inputs, user.currency) };
    });
  } catch (error) {
    // Next marks a route dynamic by throwing through it — reading the session's cookie means
    // this page is one, and that throw is control flow rather than a failure to report. Let it
    // through, or the build renders the error card instead of a dynamic route.
    unstable_rethrow(error);

    // The technical detail goes to the server log; the screen gets a message and one way out.
    console.error('[tabs] home: could not load groups', error);
    data = { user: null, groups: [], summary: null };
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
        <SignedInHome user={data.user} groups={data.groups} summary={data.summary} leftName={leftName} />
      )}

      <p>
        <a className="text-accent underline" href="/api/health">
          /api/health
        </a>
      </p>
    </main>
  );
}

function SignedInHome({
  user,
  groups,
  summary,
  leftName,
}: {
  user: SessionUser;
  groups: GroupSummary[];
  summary: HomeSummary;
  leftName: string | null;
}) {
  // The viewer's own net in each group, by group, so the list below renders a number it was
  // given rather than looking one up per row.
  const perGroup = new Map(
    summary.perGroup.map((row) => [row.groupId, row.balanceMinor]),
  );

  return (
    <>
      {/* Page level, above the list the group just left: the row that used to name it is the
          thing that is gone, so nothing inside the list can carry this. */}
      {leftName === null ? null : (
        <p
          role="status"
          aria-live="polite"
          className="rounded-token border border-muted/40 bg-surface p-3 text-sm text-lent"
        >
          {leftNoticeText(leftName)}
        </p>
      )}

      {/* The one way to the cross-group feed: home lists every group, so it is the screen from
          which "what has been happening everywhere" is the obvious next question. */}
      <p>
        <Link className="text-accent underline" href="/activity">
          All activity
        </Link>
      </p>

      <section className="flex flex-col gap-3" aria-labelledby="balances-heading">
        <h2 id="balances-heading" className="text-lg font-semibold">
          Your balances
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-token border border-muted/20 bg-surface p-4">
            <p className="text-sm text-muted">You are owed</p>
            <p data-amount className="text-xl font-semibold text-lent">
              {formatMinorUnits(summary.owedMinor, user.currency)}
            </p>
          </div>
          <div className="rounded-token border border-muted/20 bg-surface p-4">
            <p className="text-sm text-muted">You owe</p>
            <p data-amount className="text-xl font-semibold text-owed">
              {formatMinorUnits(summary.oweMinor, user.currency)}
            </p>
          </div>
        </div>

        {/* Groups in another currency are left out of the two numbers above rather than summed
            into them: 5 dollars and 5 euros do not make 10 of anything, and this version has no
            exchange rates. They are named here so the totals are not quietly incomplete, and
            they still appear in the list below with their own balance in their own currency. */}
        {summary.excluded.length === 0 ? null : (
          <p className="text-sm text-muted">
            {`Left out of your totals because ${summary.excluded.length === 1 ? 'it is' : 'they are'} in another currency: `}
            {summary.excluded
              .map((group) => `${group.groupName} (${group.currency})`)
              .join(', ')}
            .
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="people-heading">
        <h2 id="people-heading" className="text-lg font-semibold">
          People
        </h2>

        {summary.people.length === 0 ? (
          <p className="text-sm text-muted">
            Everyone is settled up. Balances appear here once your groups record expenses.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {summary.people.map((person) => (
              <li
                key={person.key}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-token border border-muted/20 bg-surface p-3"
              >
                <span className="font-medium">{person.displayName}</span>
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm text-muted">
                    {person.netMinor > 0 ? 'owes you' : 'you owe'}
                  </span>
                  <span
                    data-amount
                    className={`font-semibold ${person.netMinor > 0 ? 'text-lent' : 'text-owed'}`}
                  >
                    {formatMinorUnits(Math.abs(person.netMinor), user.currency)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
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
            {groups.map((group) => {
              const balanceMinor = perGroup.get(group.id) ?? 0;

              return (
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
                      <span className="sr-only">Balance </span>
                      {balanceMinor === 0
                        ? 'Settled'
                        : balanceMinor > 0
                          ? 'You are owed'
                          : 'You owe'}
                    </p>
                    <p
                      data-amount
                      className={`font-semibold ${balanceMinor > 0 ? 'text-lent' : balanceMinor < 0 ? 'text-owed' : ''}`}
                    >
                      {formatMinorUnits(Math.abs(balanceMinor), group.currency)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
