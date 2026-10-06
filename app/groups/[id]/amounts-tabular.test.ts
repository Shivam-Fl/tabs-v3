import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every amount the group ledger renders is tabular (AC-18, docs/ui.md; repro of BUG-2/T-11).
 *
 * The defect: the v3 rewrite rebuilt the group page's amount markup and dropped the `tabular-nums`
 * utility from every `[data-amount]` class list — the hero balance, the transfer lines, the expense
 * rows and the two member-row sites. origin/main carried `font-semibold tabular-nums text-ink` on
 * its expense rows and `components/settle-panels.tsx` kept the utility on payment rows, so the
 * rewrite was the only place that lost it. QA's T-11 reads the class list of each `[data-amount]`
 * on the Expenses and Balances tabs and failed on the first one it reached, `font-semibold
 * text-ink`.
 *
 * The page is a Server Component whose first act is a session read, so no unit test renders it —
 * the same limit `app/home.test.ts` documents. This asserts on the source instead, which is also
 * the level the defect exists at: a class list written by hand on a JSX tag.
 */

const PAGE = new URL('./page.tsx', import.meta.url);

/** The four section panels, in the order the page renders them: it fixes each panel's end. */
const SECTIONS = ['expenses', 'balances', 'activity', 'members'] as const;

function pageSource(): string {
  return readFileSync(PAGE, 'utf8');
}

/**
 * The class list of the tag that owns the `data-amount` at `at`. `data-amount` is written
 * immediately before the class list on every amount element, and the class list is either a string
 * literal or a template — the hero's template spans lines and holds a `>` of its own, so the value
 * is scanned out rather than sliced to the tag's end.
 */
function classesAt(source: string, at: number): string {
  const rest = source.slice(source.indexOf('className=', at));
  const literal = rest.match(/^className="([^"]*)"/);
  if (literal) return literal[1] ?? '';

  const open = rest.indexOf('`');
  expect(open, `the amount at offset ${at} has no className`).toBeGreaterThanOrEqual(0);

  let interpolation = 0;
  for (let i = open + 1; i < rest.length; i += 1) {
    if (rest[i] === '$' && rest[i + 1] === '{') {
      interpolation += 1;
      i += 1;
    } else if (rest[i] === '}' && interpolation > 0) {
      interpolation -= 1;
    } else if (rest[i] === '`' && interpolation === 0) {
      return rest.slice(open + 1, i);
    }
  }

  throw new Error(`the amount at offset ${at} has an unterminated className`);
}

/** The class list on every JSX tag carrying `data-amount`, in document order. */
function amountTags(source: string): string[] {
  const classes: string[] = [];
  const marker = 'data-amount';
  let at = source.indexOf(marker);

  while (at !== -1) {
    classes.push(classesAt(source, at));
    at = source.indexOf(marker, at + marker.length);
  }

  return classes;
}

/** One section panel's own stretch of the render — from its guard to the next section's. */
function panelSource(source: string, section: (typeof SECTIONS)[number]): string {
  const start = source.indexOf(`section === '${section}' ?`);
  expect(start, `the page renders no ${section} panel`).toBeGreaterThanOrEqual(0);

  const next = SECTIONS.map((name) => source.indexOf(`section === '${name}' ?`, start + 1)).filter(
    (position) => position !== -1,
  );

  return source.slice(start, next.length === 0 ? source.length : Math.min(...next));
}

describe('the group ledger’s amounts are tabular', () => {
  it('carries tabular-nums on every data-amount class list', () => {
    // The exact BUG-2/T-11 repro: hero viewer balance, transfer lines, expense rows, and the
    // balances-tab and members-tab rows. Five sites when this was written; a sixth added later is
    // held to the same rule by the loop, which is the point of checking every one rather than a
    // sample.
    const tags = amountTags(pageSource());

    expect(tags.length, 'the page renders no amounts at all').toBeGreaterThanOrEqual(5);
    for (const classes of tags) {
      expect(classes, `an amount renders as ${JSON.stringify(classes)}`).toContain('tabular-nums');
    }
  });

  it('has amounts on both tabs the acceptance names, so the pin cannot pass vacuously', () => {
    const source = pageSource();

    expect(amountTags(panelSource(source, 'expenses')).length).toBeGreaterThan(0);
    expect(amountTags(panelSource(source, 'balances')).length).toBeGreaterThan(0);
  });

  it('keeps the expense row in ink, with the direction in the payer words beside it', () => {
    // The other half of T-11 and of AC-3: an expense row is a fact about what happened, so its
    // amount is neutral whatever the viewer's net is. Restoring tabular-nums must not be bought by
    // putting a direction colour on it.
    const [row] = amountTags(panelSource(pageSource(), 'expenses'));

    expect(row, 'the expenses panel renders no amount').toBeDefined();
    expect(row).toContain('text-ink');
    for (const tone of ['text-owed', 'text-lent', 'text-danger']) {
      expect(row, `the expense amount turned into a claim with ${tone}`).not.toContain(tone);
    }
  });
});
