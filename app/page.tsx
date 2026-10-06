import { HandCoins, ReceiptText, Split } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { AppShell, TabsMark } from '../components/app-shell';
import {
  AllActivityLink,
  BalanceSummaryCard,
  GroupList,
  HomeEmpty,
  HomeFailure,
  HomeSkeleton,
  LeftGroupNotice,
  PeopleList,
  homeSections,
  type HomeGroupRow,
} from '../components/home-panels';
import { buttonClasses } from '../components/ui';
import type { SessionUser } from '../lib/auth/session';
import { getSessionUser } from '../lib/auth/session';
import { withDb } from '../lib/db/client';
import { listGroupsForUser, listMembers, type GroupSummary } from '../lib/groups/queries';
import { LEFT_NOTICE_PARAM, leftNoticeText, parseNoticeName } from '../lib/groups/validation';
import { computeNetBalances } from '../lib/settle/balances';
import { simplifyDebts } from '../lib/settle/simplify';
import { summarizeHome, type GroupBalanceInput } from '../lib/settle/summary';

export const metadata: Metadata = { title: 'Tabs' };

/**
 * The Home route: the landing page to a visitor, the overview to somebody signed in (TR-11,
 * TR-9). Which of the two it is decided by the session and nothing else — the same URL, the one
 * screen a person can always reach, whether or not they have an account.
 *
 * The session is read eagerly and on its own, inside its own `try`, because it decides *which*
 * screen this is rather than what is on it: a failure here is the boot failure the visitor's
 * page shows too, and it has to be reachable before anything signed-in exists to wrap it in.
 *
 * Everything the overview shows is behind the loading boundary below — the viewer's groups, and
 * then each group's balances, transfers and member count, one group at a time (the embedded
 * backend serves a single connection, so concurrent queries would be a queue pretending to be a
 * race). That child is what suspends, so the shell, the h1 and the leave notice paint while the
 * reads are in flight instead of after them. The arithmetic is not done here either: the
 * per-group nets and the transfer list are the group page's own two calls, and `summarizeHome`
 * is the one place that decides how they add up across groups, which currency counts, and how
 * one person's rows net together.
 *
 * The notice and the feed link sit above the boundary on purpose. Neither needs data — the
 * group the leaver left is already out of the list by the time this renders, so no row inside
 * could carry the sentence — and the feed is the only path to /activity in the product.
 *
 * Leaving a group already landed here; it carries the group's name in the query, because the
 * members page the confirming form lived on is not a page the leaver can still see (AC-11). The
 * note is additive: a visitor's landing page renders exactly as it does without it.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ left?: string }>;
}) {
  const query = await searchParams;
  const leftName = parseNoticeName(query[LEFT_NOTICE_PARAM]);

  let user: SessionUser | null;

  try {
    user = await withDb((handle) => getSessionUser(handle.db));
  } catch (error) {
    // Next marks a route dynamic by throwing through it — reading the session's cookie means
    // this page is one, and that throw is control flow rather than a failure to report. Let it
    // through, or the build renders the error card instead of a dynamic route.
    unstable_rethrow(error);

    // The technical detail goes to the server log; the screen gets a message and one way out.
    console.error('[tabs] home: could not read the session', error);
    return (
      <MarketingFrame>
        <BootFailure />
      </MarketingFrame>
    );
  }

  if (user === null) return <MarketingFrame><Landing /></MarketingFrame>;

  return (
    <AppShell place="Home" viewer={{ displayName: user.displayName }}>
      <main className="mx-auto flex w-full max-w-[1024px] flex-1 flex-col gap-5 px-4 py-5">
        {leftName === null ? null : <LeftGroupNotice message={leftNoticeText(leftName)} />}
        <AllActivityLink />

        {/* The page's one h1, above the cards it labels: the shell emits no heading, and the
            summary card deliberately has no title of its own, so the screen has exactly one. */}
        <h1 className="text-page font-semibold text-ink">Your balances</h1>

        <Suspense fallback={<HomeSkeleton />}>
          <SignedInGroups user={user} />
        </Suspense>
      </main>
    </AppShell>
  );
}

/* ---------------------------------------------------------------------------------------------
 * The visitor-facing half.
 * ------------------------------------------------------------------------------------------- */

/** The three steps, in the order a group actually does them (ui.md's Landing regions). */
const HOW_IT_WORKS = [
  {
    icon: ReceiptText,
    title: 'Record',
    body: 'Add what somebody paid, and who was in on it. One expense, or several payers at once.',
  },
  {
    icon: Split,
    title: 'Split',
    body: 'Equally, by exact amounts, percentages or shares. The parts always add up to the whole.',
  },
  {
    icon: HandCoins,
    title: 'Settle',
    body: 'See the fewest payments that clear everyone, and record each one as it happens.',
  },
] as const;

/**
 * The marketing header and footer a visitor's page wears: the mark, one way in, and the two
 * product links, and nothing else. Deliberately not the app shell — there is no account to hang
 * an account menu from yet, and ui.md asks the landing for a minimal header rather than the
 * signed-in chrome.
 *
 * The footer carries only links that go somewhere in this product. A Privacy or About link here
 * would be a link to a page nobody has built, and a 404 in the footer of the first screen a
 * visitor sees is worse than no link at all (AC-1).
 */
function MarketingFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-[1024px] items-center justify-between gap-3 px-4 py-3">
        <Link
          href="/"
          aria-label="Tabs"
          className="inline-flex items-center gap-2 rounded-token p-1"
        >
          <TabsMark />
          <span className="text-lead font-semibold text-ink">Tabs</span>
        </Link>
        <Link className={buttonClasses('secondary', 'md')} href="/signin">
          Sign in
        </Link>
      </header>

      {children}

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-[1024px] flex-wrap items-center gap-x-5 gap-y-3 px-4 py-5">
          <Link className="text-body font-medium text-accent underline-offset-4 hover:underline" href="/signin">
            Sign in
          </Link>
          <Link className="text-body font-medium text-accent underline-offset-4 hover:underline" href="/signup">
            Create account
          </Link>
        </div>
      </footer>
    </div>
  );
}

/**
 * The landing page: what Tabs is, in one screen, with the way in at the top, in the middle and
 * at the bottom of it. The hero headline is the page's h1 — the marketing frame around it emits
 * no heading, so the visitor's page has exactly one.
 */
function Landing() {
  return (
    <main className="mx-auto flex w-full max-w-[1024px] flex-1 flex-col gap-7 px-4 py-8 sm:py-12">
      <section className="flex flex-col items-start gap-4">
        <h1 className="text-hero font-semibold text-ink">Split the bill. Settle up in a tap.</h1>
        <p className="max-w-[65ch] text-lead text-ink-muted">
          Tabs keeps a group&rsquo;s shared expenses straight — who paid for what, what everyone
          owes, and the fewest payments that clear it.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link className={buttonClasses('primary', 'md')} href="/signup">
            Create account
          </Link>
          <Link className={buttonClasses('secondary', 'md')} href="/signin">
            Sign in
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="how-heading">
        <h2 id="how-heading" className="text-section font-semibold text-ink">
          How Tabs works
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {HOW_IT_WORKS.map((step, index) => {
            const Icon = step.icon;
            return (
              <li
                key={step.title}
                className="flex flex-col gap-2 rounded-token border border-border bg-surface p-4 shadow-sm"
              >
                <span className="inline-flex size-9 items-center justify-center rounded-full bg-accent-tint text-accent">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <p className="text-caption font-medium tracking-wide text-ink-muted uppercase">
                  {`Step ${index + 1}`}
                </p>
                <p className="text-body font-medium text-ink">{step.title}</p>
                <p className="text-secondary text-ink-muted">{step.body}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <p className="max-w-[65ch] text-body text-ink-muted">
        Money is counted in exact minor units, so the parts of a split always add up to the whole.
        A group is private to the people in it.
      </p>
    </main>
  );
}

/**
 * What a visitor sees when the boot itself failed: the failure named, one recovery action, and
 * no attempt to guess whether there is an account behind it. Same card the signed-in screens
 * use, with the page's h1 standing in as its title because the landing it replaces is not there
 * to carry one.
 */
function BootFailure() {
  return (
    <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col justify-center gap-5 px-4 py-8">
      <section
        className="flex flex-col items-start gap-3 rounded-token border border-danger/40 bg-surface p-4 shadow-sm"
        aria-labelledby="home-error"
      >
        <h1 id="home-error" className="text-hero font-semibold text-ink">
          We could not load your groups
        </h1>
        <p className="text-body text-ink-muted">
          Nothing has been lost — the data did not come back this time. Try again.
        </p>
        <Link className={buttonClasses('primary', 'md')} href="/">
          Retry
        </Link>
      </section>
    </main>
  );
}

/* ---------------------------------------------------------------------------------------------
 * The signed-in half.
 * ------------------------------------------------------------------------------------------- */

/** One group that answered, with the member count its row prints. */
interface LoadedGroup {
  group: GroupSummary;
  memberCount: number;
}

/**
 * The overview itself, and the child that actually suspends.
 *
 * The group list and the per-group reads come back inside one handle, one group at a time, and
 * each group's three reads sit in their own `try`. That is the partial case AC-9 is about: a
 * group whose balance or roster did not come back renders as a retry row and is left out of the
 * summary inputs, so the hero is short by a number the screen does not have and says so, rather
 * than guessing a zero and printing it as fact.
 *
 * A failure of the list read itself is the other case, and it is decided before `homeSections`
 * is asked: with no list there is no group count to count failures against, and an account that
 * has groups must never be shown the empty state because its groups did not come back.
 */
async function SignedInGroups({ user }: { user: SessionUser }) {
  let groups: GroupSummary[] = [];
  let loaded: LoadedGroup[] = [];
  let inputs: GroupBalanceInput[] = [];
  let failedNames: string[] = [];
  let listFailed = false;

  try {
    const result = await withDb(async (handle) => {
      const groupList = await listGroupsForUser(handle.db, user.id);
      const loadedGroups: LoadedGroup[] = [];
      const failed: string[] = [];
      const balanceInputs: GroupBalanceInput[] = [];

      for (const group of groupList) {
        try {
          const balances = await computeNetBalances(handle.db, group.id);
          // The count is the group's own roster rather than the length of the balance list:
          // computeNetBalances appends departed ledger participants behind the current members,
          // so its length would count people who are no longer in the group.
          const members = await listMembers(handle.db, group.id);

          loadedGroups.push({ group, memberCount: members.length });
          balanceInputs.push({
            groupId: group.id,
            groupName: group.name,
            currency: group.currency,
            viewerMembershipId: group.membershipId,
            balances,
            transfers: simplifyDebts(balances),
          });
        } catch (error) {
          // One group's reads failing is that group's problem, not the screen's.
          console.error(`[tabs] home: could not load the group ${group.name}`, error);
          failed.push(group.name);
        }
      }

      return { groupList, loadedGroups, failed, balanceInputs };
    });

    groups = result.groupList;
    loaded = result.loadedGroups;
    inputs = result.balanceInputs;
    failedNames = result.failed;
  } catch (error) {
    // The same control-flow throw the session read has to let past.
    unstable_rethrow(error);

    console.error('[tabs] home: could not load your groups', error);
    listFailed = true;
  }

  if (listFailed) return <HomeFailure />;

  const section = homeSections({
    groupCount: groups.length,
    failedCount: failedNames.length,
  });

  if (section === 'empty') return <HomeEmpty />;
  if (section === 'failure') return <HomeFailure />;

  const summary = summarizeHome(inputs, user.currency);
  // The viewer's own net in each group, by group, so the list renders a number it was given
  // rather than looking one up per row.
  const perGroup = new Map(summary.perGroup.map((row) => [row.groupId, row.balanceMinor]));
  const loadedById = new Map(loaded.map((entry) => [entry.group.id, entry]));

  const rows: HomeGroupRow[] = groups.map((group) => {
    const entry = loadedById.get(group.id);
    if (entry === undefined) return { id: group.id, name: group.name, failed: true };

    return {
      id: group.id,
      name: group.name,
      currency: group.currency,
      memberCount: entry.memberCount,
      balanceMinor: perGroup.get(group.id) ?? 0,
      failed: false,
    };
  });

  return (
    <>
      <BalanceSummaryCard
        currency={user.currency}
        owedMinor={summary.owedMinor}
        oweMinor={summary.oweMinor}
        excluded={summary.excluded}
        failedNames={failedNames}
      />
      <PeopleList people={summary.people} currency={user.currency} />
      <GroupList rows={rows} />
    </>
  );
}
