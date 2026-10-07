import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The summary card's transfer line wraps an 80-character name instead of widening the page
 * (issue #60; QA of PR #56 read scrollWidth 753 vs clientWidth 375 at 375px).
 *
 * The name span is a flex item, so its automatic minimum width is its min-content — the whole
 * unbroken name. `break-words` alone cannot lower that floor; `min-w-0` is what lets it shrink, and
 * `ml-auto` keeps the amount right-aligned when the name takes a line to itself.
 *
 * The page is an async Server Component that starts with a session read, so nothing renders it
 * here — this asserts on the source, as amounts-tabular.test.ts does. It proves the classes are
 * present, not the pixel width: that is proven in the browser at 375px.
 */

const CALL = '{transferWords(';

function pageSource(): string {
  return readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
}

/** The template-literal className of the first `<span` at or after `from`. */
function spanClasses(source: string, from: number): string {
  const tag = source.indexOf('<span', from);
  expect(tag, 'no span found').toBeGreaterThanOrEqual(0);
  const match = source.slice(tag).match(/^<span[^`]*?className=\{`([^`]*)`\}/);
  expect(match, 'the span has no template className').not.toBeNull();
  return match?.[1] ?? '';
}

function nameClasses(source: string): string {
  const call = source.indexOf(CALL);
  expect(call, 'the page no longer renders the transfer words').toBeGreaterThanOrEqual(0);
  return spanClasses(source, source.lastIndexOf('<span', call));
}

function amountClasses(source: string): string {
  const call = source.indexOf(CALL);
  const amount = source.indexOf('data-amount', call);
  expect(amount, 'the transfer row has no amount').toBeGreaterThan(call);
  return spanClasses(source, source.lastIndexOf('<span', amount));
}

describe('the transfer line wraps a long name', () => {
  it('lets the name span shrink and break', () => {
    const classes = nameClasses(pageSource());

    expect(classes).toContain('min-w-0');
    expect(classes).toContain('break-words');
  });

  it('keeps the direction tone and body type on the name', () => {
    const classes = nameClasses(pageSource());

    expect(classes).toContain('text-body');
    expect(classes).toContain('directionTone(transfer, membership.id)');
  });

  it('keeps the amount right-aligned, tabular and toned when the name takes the line', () => {
    const classes = amountClasses(pageSource());

    expect(classes).toContain('ml-auto');
    expect(classes).toContain('font-semibold');
    expect(classes).toContain('tabular-nums');
    expect(classes).toContain('directionTone(transfer, membership.id)');
  });

  it('renders the transfer words at exactly one site', () => {
    expect(pageSource().split(CALL).length - 1).toBe(1);
  });
});
