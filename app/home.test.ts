import { Fragment, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
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
import { Badge, Card, EmptyState, ListRow } from '../components/ui';
import { GROUP_NAME_MAX, leftNoticeText, parseNoticeName } from '../lib/groups/validation';
import { formatMinorUnits } from '../lib/money/format';
import type { ExcludedGroup, PersonRow } from '../lib/settle/summary';

/**
 * Home's presentational pieces, and the one decision behind them (AC-1 to AC-9).
 *
 * Rendered the way the server renders them — `renderToStaticMarkup` rather than a DOM, because
 * vitest here runs in a node environment with no jsdom. What that cannot show is anything the
 * page arranges rather than the panels contain: app/page.tsx is a Server Component whose first
 * act is a session read, so no case here renders it. The boundary placement the acceptance names
 * (the notice and the feed link above the Suspense fallback) is therefore asserted on the
 * composition the page builds, and the section decision — the part the page must not re-derive —
 * is asserted on the exported function it calls.
 *
 * Every amount in these cases is expected through `formatMinorUnits`, the same formatter the
 * panels use, so nothing here depends on which locale the runner's ICU resolves.
 */

const USD = 'USD';
const EUR = 'EUR';

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element);
}

/** The opening tag of the element that holds `text`, so a case can assert the classes on it. */
function tagFor(html: string, text: string): string {
  const at = html.indexOf(text);
  expect(at, `expected the markup to contain ${JSON.stringify(text)}`).toBeGreaterThanOrEqual(0);

  const open = html.lastIndexOf('<', at);
  return html.slice(open, html.indexOf('>', open) + 1);
}

/** The hero figure's own tag — the one amount rendered at the hero size. */
function heroTag(html: string): string {
  const match = html.match(/<p[^>]*text-hero[^>]*>/);
  expect(match, 'expected a hero-sized element').not.toBeNull();
  return match![0];
}

/** How many times `text` appears in the markup. */
function countOf(html: string, text: string): number {
  return html.split(text).length - 1;
}

/** Every element whose own text carries a currency figure but no `data-amount` hook. */
function unhookedFigures(html: string, symbol: string): string[] {
  const out: string[] = [];
  const tags = /<([a-z]+)([^>]*)>([^<]*)/g;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(html)) !== null) {
    const attributes = match[2] ?? '';
    const text = match[3] ?? '';
    if (text.includes(symbol) && !attributes.includes('data-amount')) out.push(match[0]);
  }
  return out;
}

function summary(overrides: Partial<Parameters<typeof BalanceSummaryCard>[0]> = {}) {
  return {
    currency: USD,
    owedMinor: 0,
    oweMinor: 0,
    excluded: [] as ExcludedGroup[],
    failedNames: [] as string[],
    ...overrides,
  };
}

function people(rows: PersonRow[]) {
  return createElement(PeopleList, { people: rows, currency: USD });
}

function groups(rows: HomeGroupRow[]) {
  return createElement(GroupList, { rows });
}

function loadedGroup(overrides: Partial<Extract<HomeGroupRow, { failed: false }>> = {}) {
  return {
    id: 'g-1',
    name: 'Goa Trip',
    currency: USD,
    memberCount: 3,
    balanceMinor: 0,
    failed: false as const,
    ...overrides,
  };
}

/* ---------------------------------------------------------------------------------------------
 * AC-1, AC-3: the hero number and what it means.
 * ------------------------------------------------------------------------------------------- */

describe('balance summary hero', () => {
  it('reads the net as owed minus owe, in words as well as colour', () => {
    const html = render(createElement(BalanceSummaryCard, summary({ owedMinor: 12500, oweMinor: 3500 })));
    const net = formatMinorUnits(12500 - 3500, USD);

    // Owed minus owe, in the viewer's own currency, as the largest text on the screen.
    expect(html).toContain(net);
    expect(heroTag(html)).toContain('data-amount');
    expect(heroTag(html)).toContain('text-lent');

    // Direction is words plus colour: the sentence is the half that survives a monochrome or
    // colour-blind render, and it carries the same tone as the figure.
    expect(tagFor(html, 'You are owed')).toContain('text-lent');
    expect(tagFor(html, 'You are owed')).toContain('text-lead');
  });

  it('reads a negative net as you-owe in the owed tone', () => {
    const html = render(createElement(BalanceSummaryCard, summary({ owedMinor: 3500, oweMinor: 12500 })));
    const net = formatMinorUnits(3500 - 12500, USD);

    expect(html).toContain(net);
    expect(heroTag(html)).toContain('text-owed');
    expect(tagFor(html, 'You owe')).toContain('text-owed');
  });

  it('renders the two gross totals beside the hero, in the viewer currency', () => {
    const html = render(createElement(BalanceSummaryCard, summary({ owedMinor: 12500, oweMinor: 3500 })));

    expect(countOf(html, formatMinorUnits(12500, USD))).toBe(1);
    expect(countOf(html, formatMinorUnits(3500, USD))).toBe(1);
    expect(tagFor(html, formatMinorUnits(12500, USD))).toContain('text-lent');
    expect(tagFor(html, formatMinorUnits(3500, USD))).toContain('text-owed');
  });

  it('does not claim settled when a zero net still has live rows in both directions', () => {
    // Owed 100 by one person and owing 100 to another nets to zero without anybody being square:
    // the settled sentence there would say the opposite of what the two totals below it show.
    const html = render(createElement(BalanceSummaryCard, summary({ owedMinor: 10000, oweMinor: 10000 })));

    expect(html).toContain('You owe and are owed the same amount');
    expect(html).not.toContain('All settled up');

    // A neutral figure, both totals visible, and no debt colour anywhere on the hero.
    expect(heroTag(html)).not.toContain('text-owed');
    expect(heroTag(html)).not.toContain('text-lent');
    expect(countOf(html, formatMinorUnits(10000, USD))).toBe(2);
  });

  it('renders the settled treatment only when nothing is outstanding', () => {
    const html = render(createElement(BalanceSummaryCard, summary()));

    expect(html).toContain('All settled up');
    expect(tagFor(html, 'All settled up')).toContain('text-ink-muted');
    expect(heroTag(html)).not.toContain('text-owed');
    expect(heroTag(html)).not.toContain('text-lent');
  });

  it('prints a total of zero in the neutral tone, never the debt colour', () => {
    // The account a QA walk opens on: owed 50 by somebody, owing nobody anything. The "You owe"
    // column holds a zero, and zero is neutral — a red ₹0.00 states a debt nobody has (AC-3).
    const html = render(createElement(BalanceSummaryCard, summary({ owedMinor: 5000 })));

    expect(countOf(html, formatMinorUnits(0, USD))).toBe(1);
    expect(tagFor(html, formatMinorUnits(0, USD))).not.toContain('text-owed');
    expect(tagFor(html, formatMinorUnits(0, USD))).toContain('text-ink');
    // The column that does hold something keeps its own tone, so the rule above is not a blanket
    // that greys the whole card out.
    expect(tagFor(html, formatMinorUnits(5000, USD))).toContain('text-lent');
  });

  it('names every foreign-currency group beside the totals, zero balance included', () => {
    const excluded: ExcludedGroup[] = [
      { groupId: 'g-2', groupName: 'Lisbon', currency: EUR },
      { groupId: 'g-3', groupName: 'Berlin', currency: EUR },
    ];
    const html = render(createElement(BalanceSummaryCard, summary({ owedMinor: 5000, excluded })));

    expect(html).toContain('Lisbon (EUR)');
    expect(html).toContain('Berlin (EUR)');
    expect(html).toContain('they are in another currency');

    // And the foreign row still shows its own balance in its own currency, zero included.
    const list = render(
      groups([
        loadedGroup({ id: 'g-2', name: 'Lisbon', currency: EUR, memberCount: 1, balanceMinor: 0 }),
      ]),
    );
    expect(list).toContain(formatMinorUnits(0, EUR));
    expect(list).toContain('Settled');
  });

  it('names a single excluded group in the singular', () => {
    const excluded: ExcludedGroup[] = [{ groupId: 'g-2', groupName: 'Lisbon', currency: EUR }];
    const html = render(createElement(BalanceSummaryCard, summary({ excluded })));

    expect(html).toContain('it is in another currency');
  });

  it('gives an incomplete hero a note naming the groups that did not load', () => {
    const html = render(
      createElement(BalanceSummaryCard, summary({ owedMinor: 5000, failedNames: ['Goa Trip'] })),
    );

    expect(html).toContain('One group did not load, so your totals are incomplete');
    expect(html).toContain('Goa Trip');
  });

  it('counts the failed groups in the plural', () => {
    const html = render(
      createElement(BalanceSummaryCard, summary({ failedNames: ['Goa Trip', 'Berlin'] })),
    );

    expect(html).toContain('2 groups did not load, so your totals are incomplete');
  });

  it('renders no note when every group answered and every group is in the viewer currency', () => {
    const html = render(createElement(BalanceSummaryCard, summary({ owedMinor: 5000 })));

    expect(html).not.toContain('in another currency');
    expect(html).not.toContain('totals are incomplete');
  });

  it('hooks every rendered figure with data-amount', () => {
    const html = render(
      createElement(
        Fragment,
        null,
        createElement(BalanceSummaryCard, summary({ owedMinor: 12500, oweMinor: 3500 })),
        people([{ key: 'u-1', displayName: 'Bo', netMinor: 9000 }]),
        groups([loadedGroup({ balanceMinor: -2500 })]),
      ),
    );

    expect(unhookedFigures(html, '$')).toEqual([]);
    // hero, two totals, one person figure, one group figure.
    expect(countOf(html, 'data-amount')).toBe(5);
  });
});

/* ---------------------------------------------------------------------------------------------
 * AC-2: who owes whom, and which groups need attention.
 * ------------------------------------------------------------------------------------------- */

describe('people rows', () => {
  it('gives each person their avatar, their name, and their direction in words plus colour', () => {
    const html = render(
      people([
        { key: 'u-1', displayName: 'Bo Raman', netMinor: 9000 },
        { key: 'u-2', displayName: 'Cy Diaz', netMinor: -4000 },
      ]),
    );

    expect(countOf(html, '<li')).toBe(2);
    // The avatar is decorative and tinted by the person, so the same friend is the same colour
    // wherever they appear.
    expect(tagFor(html, 'BR')).toContain('aria-hidden="true"');
    expect(html).toContain('Bo Raman');
    expect(html).toContain('Cy Diaz');

    expect(tagFor(html, 'owes you')).toContain('text-lent');
    expect(tagFor(html, 'you owe')).toContain('text-owed');
    expect(tagFor(html, formatMinorUnits(9000, USD))).toContain('text-lent');
    expect(tagFor(html, formatMinorUnits(4000, USD))).toContain('text-owed');
    expect(tagFor(html, formatMinorUnits(4000, USD))).toContain('data-amount');
  });

  it('renders a person who nets to zero as settled, with no amount and no debt tone', () => {
    const html = render(people([{ key: 'u-1', displayName: 'Bo Raman', netMinor: 0 }]));

    expect(html).toContain('settled up');
    // Neutral words, and no debt colour on them: the avatar's tint is its own affair, which is
    // why this asserts the direction rather than the whole render.
    expect(tagFor(html, 'settled up')).toContain('text-ink-muted');
    expect(tagFor(html, 'settled up')).not.toContain('text-owed');
    expect(tagFor(html, 'settled up')).not.toContain('text-lent');
    // No amount at all: a zero on this row would be a number nobody has to pay.
    expect(html).not.toContain('data-amount');
  });

  it('renders a departed or placeholder counterpart as an ordinary row, with no badge', () => {
    // ADR-0007 seats and placeholder seats keep their own key (they belong to nobody else), and
    // in this slice they are rows like any other — no departed mark, no group context.
    const html = render(people([{ key: 'm-9', displayName: 'Sam (placeholder)', netMinor: -2500 }]));

    expect(html).toContain('Sam (placeholder)');
    expect(html).toContain('you owe');
    expect(html).not.toContain('No longer in the group');
  });

  it('renders every counterpart with no cap', () => {
    const rows: PersonRow[] = Array.from({ length: 30 }, (_, index) => ({
      key: `u-${index}`,
      displayName: `Person ${index}`,
      netMinor: (index + 1) * 100,
    }));

    const html = render(people(rows));

    expect(countOf(html, '<li')).toBe(30);
    expect(html).toContain('Person 29');
  });

  it('truncates a long name and keeps the full value in the tooltip', () => {
    const name = 'Bartholomew Featherstonehaugh-Wallington III';
    const html = render(people([{ key: 'u-1', displayName: name, netMinor: 9000 }]));

    // The string title is what puts the value in the attribute — a ReactNode title would render
    // the ellipsis with nothing to hover.
    expect(tagFor(html, name)).toContain('truncate');
    expect(html).toContain(`title="${name}"`);
    // The amount sits in a column that does not shrink and is right-aligned, so the name is
    // what gives way when the row runs out of width.
    expect(html).toContain('class="shrink-0 text-right"');
    expect(html).toContain('items-end');
  });

  it('says what the place is for when there is nobody to show', () => {
    const html = render(people([]));

    expect(html).toContain('Everyone is settled up.');
    expect(html).not.toContain('<li');
  });
});

describe('group rows', () => {
  it('renders a loaded group as one link carrying its name, count, balance and chevron', () => {
    const html = render(
      groups([loadedGroup({ name: 'Goa Trip', memberCount: 3, balanceMinor: 12500 })]),
    );

    // One link target for the row itself, and the Create action twice — once for the section
    // header, once for the fixed bar — of which only one is a tab stop at any width.
    expect(countOf(html, 'href="/groups/g-1"')).toBe(1);
    expect(countOf(html, 'href="/groups/new"')).toBe(2);
    expect(countOf(html, 'max-sm:hidden')).toBe(1);
    expect(html).toContain('p-4 sm:hidden'); // the fixed bar, phones only
    expect(html).toContain('title="Goa Trip"');
    expect(html).toContain('3 members');
    expect(html).toContain('You are owed');
    expect(tagFor(html, formatMinorUnits(12500, USD))).toContain('data-amount');
    expect(html).toContain('<svg'); // the chevron that says the row goes somewhere

    // The words carry the direction for a reader the colour does not reach.
    expect(html).toContain('<span class="sr-only">Balance </span>');
  });

  it('pluralizes one member', () => {
    const html = render(groups([loadedGroup({ memberCount: 1, balanceMinor: 0 })]));

    expect(html).toContain('1 member');
    expect(html).not.toContain('1 members');
  });

  it('renders a settled group as neutral words and its own zero, in its own currency', () => {
    const html = render(
      groups([loadedGroup({ name: 'One group', memberCount: 1, currency: EUR, balanceMinor: 0 })]),
    );

    expect(html).toContain('Settled');
    expect(tagFor(html, 'Settled')).toContain('text-ink-muted');
    expect(html).toContain(formatMinorUnits(0, EUR));
    expect(html).not.toContain('text-owed');
    expect(html).not.toContain('text-lent');
  });

  it('renders a failed group as a retry row with no number at all', () => {
    const html = render(
      groups([loadedGroup({ id: 'g-1', name: 'Goa Trip' }), { id: 'g-2', name: 'Berlin', failed: true }]),
    );

    // The loaded one still renders; the failed one says so and offers the one way back.
    expect(html).toContain('href="/groups/g-1"');
    expect(html).toContain('Berlin');
    expect(html).toContain('did not load');
    expect(countOf(html, 'href="/groups/g-1"')).toBe(1);
    // A tap target a thumb can hit, and not a row that goes nowhere: the failed group has no
    // page to link to with a balance the screen could not read.
    expect(html).toContain('min-h-11');
    expect(html).not.toContain('href="/groups/g-2"');
    // A number the screen could not compute is never rendered as a number: the loaded row
    // carries the only figure on the list.
    expect(countOf(html, 'data-amount')).toBe(1);
  });

  it('renders every group with no cap', () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      loadedGroup({ id: `g-${index}`, name: `Group ${index}`, balanceMinor: index * 100 }),
    );

    expect(countOf(render(groups(rows)), '<li>')).toBe(12);
  });
});

/* ---------------------------------------------------------------------------------------------
 * AC-4, AC-5, AC-9: the states, and the decision behind them.
 * ------------------------------------------------------------------------------------------- */

describe('homeSections', () => {
  it('maps no groups to the empty state, never to the failure treatment', () => {
    // A brand-new account has nothing to load, which is not the same as everything failing.
    expect(homeSections({ groupCount: 0, failedCount: 0 })).toBe('empty');
  });

  it('maps every group failing, with groups present, to the failure treatment', () => {
    expect(homeSections({ groupCount: 3, failedCount: 3 })).toBe('failure');
  });

  it('maps some groups failing to a partial load', () => {
    expect(homeSections({ groupCount: 3, failedCount: 1 })).toBe('partial');
    expect(homeSections({ groupCount: 3, failedCount: 2 })).toBe('partial');
  });

  it('maps no group failing to the loaded screen', () => {
    expect(homeSections({ groupCount: 3, failedCount: 0 })).toBe('loaded');
  });
});

describe('the section states', () => {
  it('renders the empty state as the only thing on the screen', () => {
    const html = render(createElement(HomeEmpty));

    // Illustration, one sentence about the product, and the one action that starts it.
    expect(html).toContain('<svg');
    expect(countOf(html, 'href="/groups/new"')).toBe(1);
    expect(html).toContain('Create your first group');
    expect(html).toContain('No groups yet');

    // Nothing that needs data is mounted, so no zero hero and no empty People section either.
    expect(html).not.toContain('data-amount');
    expect(html).not.toContain('You are owed');
    expect(html).not.toContain('People');
  });

  it('renders the failure card with a retry and no figures', () => {
    const html = render(createElement(HomeFailure));

    expect(html).toContain('href="/"');
    expect(html).toContain('Retry');
    expect(html).not.toContain('data-amount');
    expect(html).not.toContain('$');
    // The page above owns the h1; this is a section heading inside it.
    expect(html).toContain('<h2');
    expect(html).not.toContain('<h1');
  });

  it('shows the loaded groups beside the retry rows when only some failed', () => {
    const html = render(
      createElement(
        Fragment,
        null,
        createElement(
          BalanceSummaryCard,
          summary({ owedMinor: 12500, failedNames: ['Berlin'] }),
        ),
        groups([
          loadedGroup({ id: 'g-1', name: 'Goa Trip', balanceMinor: 12500 }),
          { id: 'g-2', name: 'Berlin', failed: true },
        ]),
      ),
    );

    expect(html).toContain('Goa Trip');
    expect(html).toContain('Berlin');
    expect(html).toContain('did not load');
    expect(html).toContain('totals are incomplete');
  });
});

describe('skeleton fallback', () => {
  it('paints one block per region, from the shared Skeleton', () => {
    const html = render(createElement(HomeSkeleton));

    expect(countOf(html, 'data-skeleton="summary"')).toBe(1);
    expect(countOf(html, 'data-skeleton="people"')).toBe(1);
    expect(countOf(html, 'data-skeleton="group-rows"')).toBe(1);

    // Built from the shared component rather than a copied class string, so the fallback cannot
    // drift out of shape from the thing it stands in for.
    const blocks = html.match(/<div[^>]*bg-muted\/20[^>]*>/g) ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(8);
    for (const block of blocks) {
      expect(block).toContain('motion-safe:animate-pulse');
      expect(block).toContain('aria-hidden="true"');
    }
  });

  it('announces the wait without mounting a second live region', () => {
    const html = render(createElement(HomeSkeleton));

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Loading your balances');
    expect(html).toContain('sr-only');
    // The leave notice above the boundary is already this page's status slot and the two are
    // on screen together while the groups load.
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('aria-live');
  });
});

/* ---------------------------------------------------------------------------------------------
 * AC-2: the two things above the boundary.
 * ------------------------------------------------------------------------------------------- */

describe('the notice and the feed link', () => {
  it('renders the leave notice as the page’s one status slot', () => {
    const html = render(createElement(LeftGroupNotice, { message: 'You left Goa Trip.' }));

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('You left Goa Trip.');
  });

  it('wraps a max-length unbroken group name instead of letting it widen the page', () => {
    // The longest name the product allows, with nothing in it to break on — the value a leaver
    // arrives with when the group they left is called this.
    const name = 'x'.repeat(GROUP_NAME_MAX);
    const html = render(createElement(LeftGroupNotice, { message: leftNoticeText(name) }));

    // The name is still said in full — the notice confirms *which* group was left, so it wraps
    // rather than truncating — and `break-words` is what lets an 80-character run wrap inside
    // the phone viewport rather than setting the document width past it (AC-11).
    expect(html).toContain(name);
    expect(tagFor(html, name)).toContain('break-words');
  });

  it('reflects a hostile ?left= value as escaped text, never as markup or a hole', () => {
    const html = render(
      createElement(LeftGroupNotice, {
        message: leftNoticeText('<img src=x onerror=alert(1)>'),
      }),
    );

    expect(countOf(html, 'role="status"')).toBe(1);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');

    // The name the page reflects is only ever a sentence's object, so a blank one has nothing
    // to say: the page's reader answers null and its `leftName === null ? null : …` line is
    // what keeps the notice off the screen entirely.
    expect(parseNoticeName('   ')).toBeNull();
    expect(parseNoticeName(undefined)).toBeNull();
  });

  it('mounts exactly one live region when the notice and the fallback share the screen', () => {
    const html = render(
      createElement(
        Fragment,
        null,
        createElement(LeftGroupNotice, { message: 'You left Goa Trip.' }),
        createElement(HomeSkeleton),
      ),
    );

    expect(countOf(html, 'role="status"')).toBe(1);
  });

  it('reaches the feed, and both render before the fallback the page suspends on', () => {
    const html = render(
      createElement(
        Fragment,
        null,
        createElement(LeftGroupNotice, { message: 'You left Goa Trip.' }),
        createElement(AllActivityLink),
        createElement(HomeSkeleton),
      ),
    );

    expect(html).toContain('href="/activity"');
    expect(html).toContain('All activity');

    // The order the page builds: neither of these needs data, so both paint while the groups
    // are still being read.
    const notice = html.indexOf('You left Goa Trip.');
    const link = html.indexOf('All activity');
    const fallback = html.indexOf('data-skeleton="summary"');
    expect(notice).toBeGreaterThanOrEqual(0);
    expect(link).toBeGreaterThan(notice);
    expect(fallback).toBeGreaterThan(link);
  });
});

/* ---------------------------------------------------------------------------------------------
 * AC-7: the shared set Home builds on, pinned as the contracts this screen reads.
 * ------------------------------------------------------------------------------------------- */

describe('the shared set', () => {
  it('renders a Card title as an h2 with its action slot', () => {
    const html = render(
      createElement(Card, {
        title: 'Your groups',
        action: createElement('a', { href: '/groups/new' }, 'Create group'),
        children: createElement('p', null, 'body'),
      }),
    );

    // An h2 and never an h1: a card that titled itself at page level is how a screen loses its
    // own heading.
    expect(html).toContain('<h2');
    expect(html).not.toContain('<h1');
    expect(html).toContain('href="/groups/new"');
    expect(html).toContain('body');
  });

  it('renders a linked ListRow as one target with a truncating, titled title', () => {
    const html = render(createElement(ListRow, { href: '/groups/g-1', title: 'Goa Trip' }));

    expect(countOf(html, '<a ')).toBe(1);
    expect(html).toContain('href="/groups/g-1"');
    expect(tagFor(html, 'Goa Trip')).toContain('truncate');
    expect(html).toContain('title="Goa Trip"');
  });

  it('renders a ListRow without an href as a plain row rather than a dead link', () => {
    const html = render(createElement(ListRow, { title: 'Goa Trip' }));

    expect(html).not.toContain('<a ');
  });

  it('renders Badge tone classes', () => {
    expect(render(createElement(Badge, { tone: 'lent', children: 'Settled' }))).toContain(
      'bg-lent-tint',
    );
    expect(render(createElement(Badge, { tone: 'owed', children: 'Owed' }))).toContain(
      'bg-owed-tint',
    );
    expect(render(createElement(Badge, { children: 'You' }))).toContain('bg-surface-sunken');
  });

  it('renders every EmptyState slot', () => {
    const html = render(
      createElement(EmptyState, {
        icon: createElement('svg', { 'aria-hidden': 'true' }),
        title: 'No groups yet',
        body: 'One sentence.',
        action: createElement('a', { href: '/groups/new' }, 'Create your first group'),
      }),
    );

    expect(html).toContain('<svg');
    expect(html).toContain('No groups yet');
    expect(html).toContain('One sentence.');
    expect(html).toContain('Create your first group');
  });
});
