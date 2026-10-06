/**
 * Home's own pieces, in the shapes ui.md draws for that screen (TR-11): the balance summary
 * card, the People rows, the group list, and the four states the screen can be in — empty,
 * loading, partial and failed.
 *
 * Purely presentational on purpose. Nothing here fetches, holds state or reaches for a
 * server-only module, so the same module renders on the server inside app/page.tsx and under
 * `renderToStaticMarkup` in app/home.test.ts, which is what lets a unit case pin the markup
 * rules this screen is judged on — a hero that carries its direction in words, a zero that is
 * never debt red, an amount that always says which currency it is in.
 *
 * The one decision that is not markup is `homeSections`: which of the four states a set of
 * group reads adds up to. It is exported and pure so the page calls it rather than re-deriving
 * it, and so each branch has a case that fails if the rule changes.
 */

import { ChevronRight, Users } from 'lucide-react';
import Link from 'next/link';
import { Avatar, Card, EmptyState, ListRow, Skeleton, buttonClasses } from './ui';
import { formatMinorUnits } from '../lib/money/format';
import type { ExcludedGroup, PersonRow } from '../lib/settle/summary';

/* ---------------------------------------------------------------------------------------------
 * Which of the four states the section is in.
 * ------------------------------------------------------------------------------------------- */

export type HomeSection = 'empty' | 'failure' | 'partial' | 'loaded';

/**
 * What a set of group reads adds up to (AC-9).
 *
 * Zero groups is the empty state and *only* that one: a brand-new account has nothing to load,
 * which is not the same thing as everything having failed, and rendering the failure card to
 * somebody who has simply not started is how a first screen reads as broken. With groups
 * present, every one of them failing is the failure card, some of them is a partial load — the
 * groups that answered render and the ones that did not say so — and none of them is the
 * loaded screen.
 */
export function homeSections({
  groupCount,
  failedCount,
}: {
  groupCount: number;
  failedCount: number;
}): HomeSection {
  if (groupCount === 0) return 'empty';
  if (failedCount === groupCount) return 'failure';
  if (failedCount > 0) return 'partial';
  return 'loaded';
}

/* ---------------------------------------------------------------------------------------------
 * The balance summary card.
 * ------------------------------------------------------------------------------------------- */

/** Which side of zero a figure is on, which decides both its words and its colour. */
type Direction = 'lent' | 'owed' | 'neutral';

const FIGURE_TONE: Record<Direction, string> = {
  lent: 'text-lent',
  owed: 'text-owed',
  neutral: 'text-ink',
};

const WORDS_TONE: Record<Direction, string> = {
  lent: 'text-lent',
  owed: 'text-owed',
  neutral: 'text-ink-muted',
};

/**
 * What the hero number means, in words.
 *
 * The figure itself is rendered signed by the one formatter (`-$50.00`), so a hero carrying
 * only that would put its direction in a minus sign and a colour — which is the combination
 * ui.md forbids at every size. The sentence beside it says it outright.
 *
 * The settled sentence is only for the case where nothing is outstanding: owing 100 somewhere
 * and being owed 100 somewhere else nets to zero without anybody being square, and claiming
 * "All settled up" there would say the opposite of what the two totals below it show.
 */
function heroSentence(owedMinor: number, oweMinor: number): { text: string; direction: Direction } {
  const net = owedMinor - oweMinor;
  if (net > 0) return { text: 'You are owed', direction: 'lent' };
  if (net < 0) return { text: 'You owe', direction: 'owed' };
  if (owedMinor === 0 && oweMinor === 0) return { text: 'All settled up', direction: 'neutral' };
  return { text: 'You owe and are owed the same amount', direction: 'neutral' };
}

/** The groups in another currency, named so the totals above are not quietly incomplete. */
function excludedNote(excluded: readonly ExcludedGroup[]): string {
  const names = excluded.map((group) => `${group.groupName} (${group.currency})`).join(', ');
  return `Left out of your totals because ${excluded.length === 1 ? 'it is' : 'they are'} in another currency: ${names}.`;
}

/** The groups whose balances did not come back, named for the same reason the note above names. */
function incompleteNote(names: readonly string[]): string {
  const subject = names.length === 1 ? 'One group did not load' : `${names.length} groups did not load`;
  return `${subject}, so your totals are incomplete: ${names.join(', ')}.`;
}

/**
 * The screen's key balance: the viewer's net across every group in their own currency, as the
 * largest text on the page, with the number's meaning beside it in the same tone, and the two
 * gross totals under it.
 *
 * It carries no `Card` title on purpose — the page above it owns the one h1, and a card that
 * titled itself here would put an h2 between the reader and the thing they came to read.
 */
export function BalanceSummaryCard({
  currency,
  owedMinor,
  oweMinor,
  excluded,
  failedNames,
}: {
  /** The viewer's own currency: the only one these three figures are in. */
  currency: string;
  owedMinor: number;
  oweMinor: number;
  excluded: readonly ExcludedGroup[];
  /** Groups whose balance read failed, so the hero is not read as the whole picture. */
  failedNames: readonly string[];
}) {
  const netMinor = owedMinor - oweMinor;
  const sentence = heroSentence(owedMinor, oweMinor);
  const settled = owedMinor === 0 && oweMinor === 0;
  // A total of nothing is not a debt. The two columns are coloured by side, but a zero in either
  // reads neutral — the same rule the hero and every row below follow (AC-3), and the reason a
  // brand-new account does not open onto a red ₹0.00 it does not owe.
  const owedTone = owedMinor === 0 ? FIGURE_TONE.neutral : FIGURE_TONE.lent;
  const oweTone = oweMinor === 0 ? FIGURE_TONE.neutral : FIGURE_TONE.owed;

  return (
    <Card>
      <div className="flex flex-col gap-2">
        <p className="text-caption font-medium tracking-wide text-ink-muted uppercase">
          Net across your groups
        </p>
        <p
          data-amount
          className={`text-hero font-semibold tabular-nums ${FIGURE_TONE[sentence.direction]}`}
        >
          {formatMinorUnits(netMinor, currency)}
        </p>
        <p className={`text-lead font-medium ${WORDS_TONE[sentence.direction]}`}>{sentence.text}</p>
        {settled ? (
          <p className="text-secondary text-ink-muted">
            Nobody owes anybody across the groups you are in.
          </p>
        ) : null}
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-token border border-border bg-surface-sunken p-3">
          <dt className="text-secondary text-ink-muted">You are owed</dt>
          <dd data-amount className={`text-section font-semibold tabular-nums ${owedTone}`}>
            {formatMinorUnits(owedMinor, currency)}
          </dd>
        </div>
        <div className="flex flex-col gap-1 rounded-token border border-border bg-surface-sunken p-3">
          <dt className="text-secondary text-ink-muted">You owe</dt>
          <dd data-amount className={`text-section font-semibold tabular-nums ${oweTone}`}>
            {formatMinorUnits(oweMinor, currency)}
          </dd>
        </div>
      </dl>

      {excluded.length === 0 ? null : (
        <p className="text-secondary text-ink-muted">{excludedNote(excluded)}</p>
      )}
      {failedNames.length === 0 ? null : (
        <p className="text-secondary text-ink-muted">{incompleteNote(failedNames)}</p>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Who owes whom, person by person.
 * ------------------------------------------------------------------------------------------- */

/** One person's direction: words first, colour second, and no amount where there is no debt. */
function PersonAmount({ person, currency }: { person: PersonRow; currency: string }) {
  if (person.netMinor === 0) {
    // Netted to nothing across their groups: settled is a statement, not a zero to render, and
    // a zero here would be the only row on the screen with a number nobody has to pay.
    return <span className="text-secondary text-ink-muted">settled up</span>;
  }

  const direction: Direction = person.netMinor > 0 ? 'lent' : 'owed';

  return (
    <span className="flex flex-col items-end">
      <span className={`text-secondary ${WORDS_TONE[direction]}`}>
        {person.netMinor > 0 ? 'owes you' : 'you owe'}
      </span>
      <span data-amount className={`font-semibold tabular-nums ${FIGURE_TONE[direction]}`}>
        {formatMinorUnits(Math.abs(person.netMinor), currency)}
      </span>
    </span>
  );
}

/**
 * Everybody the viewer owes or is owed by, across every group in their own currency — one row
 * per person, netted, with the avatar tinted by the person rather than by the row number so the
 * same friend is the same colour in every group they share.
 *
 * The title is the name as a string, which is what puts the full value in the row's `title`
 * attribute: a long name truncates to one line and shows itself on hover instead of wrapping
 * the row into three.
 */
export function PeopleList({
  people,
  currency,
}: {
  people: readonly PersonRow[];
  currency: string;
}) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="people-heading">
      <h2 id="people-heading" className="text-section font-semibold text-ink">
        People
      </h2>

      {people.length === 0 ? (
        <p className="text-secondary text-ink-muted">
          Everyone is settled up. Balances appear here once your groups record expenses.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {people.map((person) => (
            <li key={person.key}>
              <ListRow
                leading={<Avatar name={person.displayName} memberId={person.key} />}
                title={person.displayName}
                trailing={<PersonAmount person={person} currency={currency} />}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------
 * The group list.
 * ------------------------------------------------------------------------------------------- */

/** A group whose balance read answered — the only shape that carries a number. */
export interface LoadedGroupRow {
  id: string;
  name: string;
  currency: string;
  memberCount: number;
  balanceMinor: number;
  failed: false;
}

/** A group whose read did not answer. It has no member count and no balance, and renders none. */
export interface FailedGroupRow {
  id: string;
  name: string;
  failed: true;
}

export type HomeGroupRow = LoadedGroupRow | FailedGroupRow;

/**
 * The viewer's balance in one group. The group's own number, in the group's own currency —
 * five dollars and five euros do not add up, which is the same reason the totals above leave
 * foreign groups out of themselves and name them instead.
 */
function GroupBalance({ balanceMinor, currency }: { balanceMinor: number; currency: string }) {
  const settled = balanceMinor === 0;
  const direction: Direction = settled ? 'neutral' : balanceMinor > 0 ? 'lent' : 'owed';

  return (
    <span className="flex items-center gap-2">
      <span className="flex flex-col items-end">
        {/* The words carry the direction for a screen reader too, where the colour does not
            reach: without the label the row reads as an unlabelled figure, and without the
            words it reads as a figure with no direction. */}
        <span className="sr-only">Balance </span>
        <span className={`text-secondary ${WORDS_TONE[direction]}`}>
          {settled ? 'Settled' : balanceMinor > 0 ? 'You are owed' : 'You owe'}
        </span>
        <span data-amount className={`font-semibold tabular-nums ${FIGURE_TONE[direction]}`}>
          {formatMinorUnits(Math.abs(balanceMinor), currency)}
        </span>
      </span>
      <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-ink-subtle" />
    </span>
  );
}

/** A group that did not answer: named, honest about what is missing, and one way to try again. */
function GroupRetryRow({ name }: { name: string }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-token border border-danger/40 bg-surface p-3">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-ink" title={name}>
          {name}
        </span>
        <span className="text-secondary text-ink-muted">
          This group&rsquo;s balance did not load.
        </span>
      </span>
      <Link className={buttonClasses('secondary', 'md')} href="/">
        Retry
      </Link>
    </div>
  );
}

/**
 * Every group the viewer is in, as one link per row: the mark, the name, how many people are in
 * it, and what the viewer's balance is there.
 *
 * The Create action is rendered twice and only ever once at a time: the section header carries
 * it from `sm` up, and phones get a fixed bar along the bottom where a thumb can reach it.
 * `max-sm:hidden` and `sm:hidden` are what make it exactly one tab stop rather than two — a
 * hidden control is not focusable, so there is no breakpoint at which both are in the walk. The
 * spacer under the list pays for the bar, or the last group ends up behind it.
 */
export function GroupList({ rows }: { rows: readonly HomeGroupRow[] }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="groups-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="groups-heading" className="text-section font-semibold text-ink">
          Your groups
        </h2>
        <Link className={buttonClasses('primary', 'md', 'max-sm:hidden')} href="/groups/new">
          Create group
        </Link>
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.id}>
            {row.failed ? (
              <GroupRetryRow name={row.name} />
            ) : (
              <ListRow
                href={`/groups/${row.id}`}
                leading={<Avatar name={row.name} memberId={row.id} />}
                title={row.name}
                meta={`${row.memberCount} ${row.memberCount === 1 ? 'member' : 'members'}`}
                trailing={
                  <GroupBalance balanceMinor={row.balanceMinor} currency={row.currency} />
                }
              />
            )}
          </li>
        ))}
      </ul>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface p-4 sm:hidden">
        <Link className={buttonClasses('primary', 'md', 'w-full')} href="/groups/new">
          Create group
        </Link>
      </div>
      <div aria-hidden="true" className="h-24 sm:hidden" />
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------
 * The states between a session and a loaded screen.
 * ------------------------------------------------------------------------------------------- */

/**
 * What a brand-new account sees: what Tabs is for, and the one action that starts it.
 *
 * It owns the Create action because it is the only thing on the screen that could — with no
 * groups there is no group-list header to hang one off, and a fixed bar beside a single button
 * would be the same action twice.
 */
export function HomeEmpty() {
  return (
    <EmptyState
      icon={<Users aria-hidden="true" className="size-6" />}
      title="No groups yet"
      body="Tabs keeps a group&rsquo;s shared expenses straight — create one and add the people you split with."
      action={
        <Link className={buttonClasses('primary', 'md')} href="/groups/new">
          Create your first group
        </Link>
      }
    />
  );
}

/**
 * What the screen shows when the groups themselves did not come back, with the session intact.
 *
 * It renders no figures at all. The last numbers this screen knew are not on it any more, and a
 * balance left over from a successful read an hour ago is worse than a blank one: it is wrong
 * and it looks current.
 */
export function HomeFailure() {
  return (
    <section
      className="flex flex-col items-start gap-3 rounded-token border border-danger/40 bg-surface p-4 shadow-sm"
      aria-labelledby="home-error"
    >
      <h2 id="home-error" className="text-section font-semibold text-ink">
        We could not load your balances
      </h2>
      <p className="text-body text-ink-muted">
        Nothing has been lost — your groups did not come back this time. Try again.
      </p>
      <Link className={buttonClasses('primary', 'md')} href="/">
        Retry
      </Link>
    </section>
  );
}

/**
 * What paints while the groups are read: the shape of the loaded screen, one block per region,
 * so nothing moves when the data arrives.
 *
 * The waiting text carries no live role. The leave notice above this boundary is already a
 * `role="status"` and the two can be on screen at once — a status fallback here would be a
 * second live region announcing into the same moment, so the container says `aria-busy` and
 * nothing else.
 */
export function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <span className="sr-only">Loading your balances</span>

      <div
        data-skeleton="summary"
        className="flex flex-col gap-3 rounded-token border border-border bg-surface p-4 shadow-sm"
      >
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-6 w-32" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>

      <div data-skeleton="people" className="flex flex-col gap-2">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>

      <div data-skeleton="group-rows" className="flex flex-col gap-2">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * The two things the page renders above the boundary.
 * ------------------------------------------------------------------------------------------- */

/**
 * The confirmation a leaver lands on (AC-11). It sits above the loading boundary because it
 * needs nothing loaded: the group they left is gone from the list by the time this renders, so
 * no row below could carry the sentence.
 *
 * It is also the page's one status slot. Everything that loads below it stays quiet about
 * arriving, which is what keeps this the only live region on the screen.
 *
 * The sentence names the group, and a group name can be 80 characters with no space in it. The
 * notice wraps rather than truncates — it confirms *which* group was left, so hiding characters
 * would weaken the one thing it says — and `break-words` (overflow-wrap) is what lets that
 * unbroken value wrap inside the phone viewport instead of setting the page's width past it
 * (AC-11).
 */
export function LeftGroupNotice({ message }: { message: string }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="rounded-token border border-border bg-surface p-3 text-body break-words text-lent"
    >
      {message}
    </p>
  );
}

/**
 * The way to the cross-group feed (TR-10).
 *
 * Home lists every group, so it is the screen from which "what has been happening everywhere"
 * is the obvious next question, and the account menu links only Profile — drop this and the
 * feed has no path to it from anywhere in the product.
 */
export function AllActivityLink() {
  return (
    <p className="text-body">
      <Link
        className="font-medium text-accent underline underline-offset-4"
        href="/activity"
      >
        All activity
      </Link>
    </p>
  );
}
