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
 * The order of the two reads around `groupsLoaded = true` is the other source-level fact held here.
 */

const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

function groupsLoadedWiring(src: string): string[] {
  const start = src.indexOf('async function ActivityContent');
  if (start < 0) return ['ActivityContent was not found in page.tsx'];

  const body = src
    .slice(start)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  const at = (pattern: RegExp) => body.search(pattern);
  const count = (pattern: RegExp) => (body.match(pattern) ?? []).length;

  const tryAt = at(/\btry\s*\{/);
  const groupsReadAt = at(
    /groups\s*=\s*await\s+withDb\(\s*\(handle\)\s*=>\s*listActivityGroups\(handle\.db/,
  );
  const flagAt = at(/(?<!let\s)\bgroupsLoaded\s*=\s*true\s*;/);
  const feedReadAt = at(
    /rows\s*=\s*await\s+withDb\(\s*\(handle\)\s*=>\s*listUserActivity\(handle\.db/,
  );
  const catchAt = at(/\}\s*catch\b/);
  const scopeAt = at(/failedFeedScope\(\s*groupsLoaded/);

  const violations: string[] = [];
  if (tryAt < 0) violations.push('the reads must sit inside a try block');
  if (groupsReadAt < 0) violations.push('the groups read must be `groups = await withDb(... listActivityGroups(...))`');
  if (flagAt < 0) violations.push('`groupsLoaded = true;` must be assigned');
  if (feedReadAt < 0) violations.push('the feed read must be `rows = await withDb(... listUserActivity(...))`');
  if (catchAt < 0) violations.push('the try block must have a catch');
  if (scopeAt < 0) violations.push('the failed branch must call failedFeedScope(groupsLoaded, ...)');
  if (count(/\btry\s*\{/g) > 1 || count(/\}\s*catch\b/g) > 1) {
    violations.push('ActivityContent must have exactly one try/catch');
  }

  const order = [tryAt, groupsReadAt, flagAt, feedReadAt, catchAt, scopeAt];
  if (order.every((index) => index >= 0) && order.some((index, i) => i > 0 && index <= order[i - 1])) {
    violations.push(
      'order must be try < awaited groups read < groupsLoaded = true < awaited feed read < catch < failedFeedScope(groupsLoaded',
    );
  }

  if (count(/let\s+groupsLoaded\s*=\s*false\s*;/g) !== 1) {
    violations.push('groupsLoaded must be declared exactly once as `let groupsLoaded = false;`');
  }
  if (count(/\bgroupsLoaded\s*=(?![=>])/g) !== 2) {
    violations.push('groupsLoaded may be written only by its declaration and the one assignment after the groups read');
  }

  return violations;
}

type Mutant = { source: string; expects: RegExp };

function buildMutants(src: string): Record<string, Mutant> {
  const start = src.indexOf('async function ActivityContent');
  const head = start < 0 ? '' : src.slice(0, start);
  const tail = start < 0 ? src : src.slice(start);
  const build = (edit: (body: string) => string, expects: RegExp): Mutant => ({
    source: head + edit(tail),
    expects,
  });

  const withoutFlag = (body: string) =>
    body.replace(/[ \t]*\bgroupsLoaded\s*=\s*true\s*;[^\S\n]*\r?\n?/, '');

  return {
    'flag above the groups read': build(
      (body) => withoutFlag(body).replace(/\bgroups\s*=\s*await\b/, 'groupsLoaded = true; $&'),
      /order must be/,
    ),
    'flag below the feed read': build(
      (body) => withoutFlag(body).replace(/\}\s*catch\b/, 'groupsLoaded = true; $&'),
      /order must be/,
    ),
    'await dropped from the groups read': build(
      (body) => body.replace(/(\bgroups\s*=\s*)await\s+(withDb)/, '$1$2'),
      /groups read must be/,
    ),
    'second assignment in the catch': build(
      (body) => body.replace(/(\bfailed\s*=\s*true\s*;)/, '$1 groupsLoaded = false;'),
      /written only/,
    ),
  };
}

function expectMutantsCaught(src: string, label: string) {
  for (const [name, mutant] of Object.entries(buildMutants(src))) {
    expect(mutant.source, `${label}: mutant "${name}" changed nothing`).not.toBe(src);
    expect(groupsLoadedWiring(mutant.source).join('\n'), `${label}: mutant "${name}"`).toMatch(
      mutant.expects,
    );
  }
}

const syntheticActivityContent = [
  'export default function Page() {}',
  '',
  'async function ActivityContent() {',
  '\tlet groupsLoaded = false;',
  '\tlet failed  =  false;',
  '\ttry {',
  '\t\tgroups = await withDb((handle) => listActivityGroups(handle.db, viewerId));',
  '\t\tgroupsLoaded   =   true;',
  '\t\trows = await withDb((handle) => listUserActivity(handle.db, viewerId, filter));',
  '\t} catch (cause) {',
  '\t\tconsole.error(cause);',
  '\t\tfailed  =  true;',
  '\t}',
  '\treturn failedFeedScope(groupsLoaded, groups, rawGroup);',
  '}',
  '',
].join('\n');

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

  it('carries the raw group id on the failed branch only when the groups read could not confirm it', () => {
    expect(page).toContain('<ActivityFailed');
    expect(page).toContain('failedFeedScope(groupsLoaded, groups, rawGroup)');
    expect(page).not.toContain('scoped?.id ?? rawGroupScope(');
  });

  it('sets groupsLoaded only after the groups read and before the feed read', () => {
    expect(page.indexOf('async function ActivityContent')).toBeGreaterThanOrEqual(0);
    expect(groupsLoadedWiring(page), 'the real page').toEqual([]);

    expectMutantsCaught(page, 'the real page');
  });

  it('applies and catches every mutant on a reformatted ActivityContent', () => {
    const variants: Record<string, string> = {
      'tab indent, spaced "=", catch (cause)': syntheticActivityContent,
      CRLF: syntheticActivityContent.replace(/\n/g, '\r\n'),
      'bare one-line catch': syntheticActivityContent
        .replace('catch (cause) {\n\t\tconsole.error(cause);\n\t\tfailed  =  true;\n\t}', 'catch { failed  =  true; }'),
    };

    for (const [label, src] of Object.entries(variants)) {
      expect(groupsLoadedWiring(src), `the ${label} fixture`).toEqual([]);
      expectMutantsCaught(src, label);
    }
    expect(variants['bare one-line catch']).toContain('catch { failed');
  });
});
