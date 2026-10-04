// What a second run of QA's own Playwright suite confirms of QA's pass.
//
// QA's "pass" was a model's claim. The judge checked the evidence's shape — a PNG's magic number,
// a HAR that parses, a file time — and a report built from an 8-byte PNG, an empty HAR and an
// invented test passed every gate (audit 2026-10-02, F1). Playwright ran only inside the agent's
// own job, so even "the suite passed" was the agent's word. sdlc-qa's replay job now runs that
// suite again, with no agent, on a fresh runner, against the commit QA tested; this decides what
// the replay did not confirm, and the judge stops the pass for a person on any of it.
//
// Only a pass is judged, and only what a browser shows needs a replayed test: a criterion the work
// order verifies by `test` (CI) or `api`, and a case a browser cannot reach (a CLI, a cron, curl),
// has no spec to replay and is not refused for having none. A test QA itself reported failing —
// a pre-existing bug, filed — failing again is agreement, not a contradiction.
import { norm } from './qa-consistency.js';

const ID = /\bT-\d+\b/;
const firstLine = (s) => String(s ?? '').replace(/\u001b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';

/** Every test in a Playwright JSON report, flattened, with the T- id its title carries. */
export function replayed(results) {
  const out = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const runs = spec.tests ?? [];
      const last = (t) => (t.results ?? []).at(-1);
      out.push({
        id: String(spec.title ?? '').match(ID)?.[0] ?? null,
        title: spec.title,
        // `expected` alone is not a pass: test.fail() makes a failing test expected, and a skipped
        // test is expected too. Only a run that passed confirms anything.
        passed: runs.length > 0 && runs.every((t) => t.status === 'expected' && last(t)?.status === 'passed'),
        failed: runs.some((t) => t.status === 'unexpected' || t.status === 'flaky'),
        error: firstLine(runs.map((t) => last(t)?.error?.message).find(Boolean)),
      });
    }
    for (const s of suite.suites ?? []) walk(s);
  };
  for (const s of results?.suites ?? []) walk(s);
  return out;
}

/**
 * What a run of the suite did not confirm of a QA pass, as sentences; [] when it confirms it.
 *
 * @param {object}      a
 * @param {object}      a.report     the QA report
 * @param {object|null} a.workOrder  the work order it is judged against; absent, every criterion is a browser one
 * @param {object|null} a.results    that run's results.json; null when there is none
 * @param {string|null} a.exit       Playwright's exit status; null when the replay never ran it
 * @param {number}      a.kept       spec files QA kept with its evidence
 * @param {string}      [a.job]      the replay job's result, for the sentence
 * @param {string}      [a.ran]      what ran the suite, for the sentence
 */
export function unconfirmed({ report, workOrder, results, exit, kept = 0, job = 'unknown', ran = 'the replay' }) {
  // An audit has no PR and no work order, and merges nothing.
  if (report?.verdict !== 'pass' || !report.pr) return [];
  const out = [];
  const tests = results ? replayed(results) : [];
  const said = new Map((report.tests ?? []).map((t) => [t.id, t.status]));

  if (kept && exit == null) out.push(`QA kept ${kept} spec file(s) with its evidence and ${ran} did not run them (replay job: ${job})`);
  if (exit != null && (!results || (exit !== '0' && !tests.some((t) => t.failed)))) {
    const why = firstLine((results?.errors ?? []).map((e) => e.message).find(Boolean));
    out.push(`${ran} did not finish: playwright exited ${exit}${results ? '' : ' and wrote no results.json'}${why ? ` — ${why}` : ''}`);
  }
  for (const t of tests.filter((x) => x.failed && !(said.has(x.id) && said.get(x.id) !== 'pass'))) {
    out.push(`${t.id ?? `"${t.title}"`} failed in ${ran}` +
      `${said.get(t.id) === 'pass' ? ', and QA reported it passed' : ', and QA reported no such test failing'}${t.error ? ` — ${t.error}` : ''}`);
  }

  const passed = new Set(tests.filter((t) => t.passed).map((t) => t.id));
  const state = (id) => {
    const mine = tests.filter((t) => t.id === id);
    return !mine.length ? 'not in the suite' : mine.some((t) => t.failed) ? 'failed' : 'did not pass';
  };
  const rolled = new Map((report.acceptance_rollup ?? []).map((a) => [norm(a.id), a]));
  for (const c of workOrder?.acceptance ?? report.acceptance_rollup ?? []) {
    if ((c.verify ?? 'browser') !== 'browser') continue;
    const a = rolled.get(norm(c.id));
    if (a?.status !== 'pass') continue;
    const ids = (a.test_ids ?? []).filter((id) => id !== 'ci');
    if (ids.some((id) => passed.has(id))) continue;
    out.push(`${c.id} is verified in the browser and QA passed it, but no test it cites passed in ${ran}: ` +
      (ids.length ? ids.map((id) => `${id} (${results ? state(id) : 'no results'})`).join(', ') : 'it cites none'));
  }
  return out;
}
