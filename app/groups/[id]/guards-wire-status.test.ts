import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The guard, the boundary, and who decides the wire status (AC-17, TR-3; repro of BUG-1/T-14).
 *
 * The defect: each guarded group segment carried a route-level `loading.tsx`. Next wraps a
 * segment's *page* in that file's boundary, so the fallback streams — and the response's status is
 * committed — before the page's own guard has run. Anonymous, stranger, malformed and missing
 * requests all came back HTTP 200 with a skeleton or a not-available body, and only a router-driven
 * browser corrected itself from the Flight payload; curl, unfurlers, caches and scanners saw the
 * 200. The control on the same server was `/join/[token]`, which holds only a `page.tsx` and 404s
 * correctly: the boundary was the difference, not the guard.
 *
 * A fallback handed to a `<Suspense>` *below* the guard keeps both: nothing streams before the
 * guard has thrown, and a viewer who may see the page still watches the skeleton. That ordering is
 * what this file pins — a file's absence and the order of two statements in a page — because both
 * are facts only a source-level test can hold: the embedded database resolves in the microtask
 * queue, so no unit test can watch a status be committed (see memory/qa/environment.md).
 *
 * The third pin the work order names — that both refusal links still resolve to the live Balances
 * settle target — lives in the sibling `groups-panels.test.ts`, which already holds it and is
 * unchanged by this work; it is not duplicated here.
 */

/** The boundary itself, not the word: these files talk about `<Suspense>` in prose as well. */
const BOUNDARY = '<Suspense fallback=';

/** The guard's own call, spelled with its argument so no sentence about it can be mistaken for it. */
const GUARD = 'guardGroup(handle.db';

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

/** Where a statement sits in a file, or -1 when the file does not contain it at all. */
function at(file: string, needle: string): number {
  return source(file).indexOf(needle);
}

/** Builds the message for an ordering assertion so a failure names both positions. */
function before(file: string, first: string, second: string): void {
  const firstAt = at(file, first);
  const secondAt = at(file, second);

  expect(firstAt, `${file} does not contain ${first}`).toBeGreaterThanOrEqual(0);
  expect(secondAt, `${file} does not contain ${second}`).toBeGreaterThanOrEqual(0);
  expect(
    firstAt,
    `${first} must come before ${second} in ${file} (at ${firstAt} and ${secondAt})`,
  ).toBeLessThan(secondAt);
}

describe('no route-level boundary sits above a guarded group segment', () => {
  it('has no loading.tsx at the group page or either expense editor segment', () => {
    // The file itself is the bug: Next uses the nearest loading.tsx above a segment, so its mere
    // existence is what committed 200 before guardGroup could throw. The skeleton states it used to
    // carry now ride in `Suspense` fallbacks below the guards instead (components/group-skeletons).
    expect(existsSync(new URL('./loading.tsx', import.meta.url))).toBe(false);
    expect(existsSync(new URL('./expenses/loading.tsx', import.meta.url))).toBe(false);
  });

  it('leaves the merged members segment alone, which is another piece’s contract', () => {
    // Named in the work order's out_of_scope: that file carries the same hazard, but it belongs to
    // the members piece and is not this ticket's to change. Asserted so a later sweep here cannot
    // quietly delete a boundary this work never claimed.
    expect(existsSync(new URL('./members/loading.tsx', import.meta.url))).toBe(true);
  });
});

describe('the guard runs before anything can stream', () => {
  it('awaits guardGroup on the group page before its first Suspense boundary and before its first read', () => {
    const page = './page.tsx';

    before(page, GUARD, BOUNDARY);
    before(page, GUARD, 'listExpenses(');
    before(page, GUARD, 'listGroupActivity(');
    // The refusals themselves, not just the guard call: a redirect or a notFound written after the
    // boundary would resolve inside a 200 for exactly the reason the old loading.tsx did.
    before(page, 'redirect(', BOUNDARY);
    before(page, 'notFound()', BOUNDARY);
  });

  it('awaits guardGroup on the new-expense page before its boundary and before its read', () => {
    const page = './expenses/new/page.tsx';

    before(page, GUARD, BOUNDARY);
    before(page, GUARD, 'getExpenseEditorData(');
    before(page, 'notFound()', BOUNDARY);
  });

  it('awaits guardGroup on the edit-expense page before its boundary and before its read', () => {
    const page = './expenses/[expenseId]/edit/page.tsx';

    before(page, GUARD, BOUNDARY);
    before(page, GUARD, 'getExpenseEditorData(');
    before(page, 'expenseScope.safeParse(', BOUNDARY);
  });

  it('hands each page’s data to a boundary rather than reading it above one', () => {
    // The other half of the ordering: a read left above the boundary would not be a bug, but it
    // would mean the fallback never suspends and the skeleton state IAC-6 asks for never exists.
    for (const page of [
      './page.tsx',
      './expenses/new/page.tsx',
      './expenses/[expenseId]/edit/page.tsx',
    ]) {
      const body = source(page);
      const boundary = body.indexOf(BOUNDARY);
      const read = Math.min(
        ...[body.indexOf('listExpenses('), body.indexOf('getExpenseEditorData(')]
          .map((position) => (position === -1 ? Number.POSITIVE_INFINITY : position)),
      );

      expect(boundary, `${page} has no Suspense boundary`).toBeGreaterThanOrEqual(0);
      expect(read, `${page} reads its data above the boundary`).toBeGreaterThan(boundary);
    }
  });
});
