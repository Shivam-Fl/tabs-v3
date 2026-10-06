import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Who decides the wire status of /activity (AC-10, AC-4).
 *
 * A route-level `loading.tsx` wraps the page, so its skeleton streams — and a 200 is committed —
 * before the page's session guard has run: an anonymous raw GET got 200 and a skeleton instead of
 * a redirect. The skeleton now rides in a `<Suspense>` below the guard. Absence of a file and the
 * order of two statements are facts only a source-level test can hold, because the embedded
 * database resolves in the microtask queue and no unit test can watch a status be committed.
 */

const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

describe('the activity route', () => {
  it('has no route-level loading boundary above its guard', () => {
    expect(existsSync(new URL('./loading.tsx', import.meta.url))).toBe(false);
  });

  it('redirects a signed-out reader before its Suspense boundary', () => {
    const redirectAt = page.indexOf('redirect(`/signin');
    const boundaryAt = page.indexOf('<Suspense fallback=');

    expect(redirectAt).toBeGreaterThanOrEqual(0);
    expect(boundaryAt).toBeGreaterThanOrEqual(0);
    expect(redirectAt).toBeLessThan(boundaryAt);
  });

  it('keeps the raw group scope on the failed branch when the groups read is what failed', () => {
    expect(page).toContain('<ActivityFailed');
    expect(page).toMatch(/groupId=\{scoped\?\.id \?\? rawGroupScope\(/);
  });
});
