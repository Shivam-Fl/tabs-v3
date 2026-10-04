#!/usr/bin/env node
// Did QA's suite pass again without QA?
//
// A forged pass — an 8-byte PNG, an empty HAR, one invented test — cleared every gate the judge
// had, because each one read a file the agent wrote (audit 2026-10-02, F1). sdlc-qa's replay job
// runs the agent's own suite again with no agent in it, and this reads what that run said
// (lib/replay.js decides). Anything it could not confirm goes to post-qa-report as `refused`,
// which records the run as blocked and stops it for a person: nothing is recorded as a pass.
//
//   judge      REPLAY_DIR holds the replay's results.json and `exit`; QA_EVIDENCE_DIR/spec is the
//              suite QA kept. Always exits 0 — the refusal is an output, not a crash.
//   PREFLIGHT  the agent checking its own report before it finishes: the same rules against its
//              own last run (QA_EVIDENCE_DIR/results.json), and a refusal exits 1, as preflight
//              reads it. Nothing here can be replayed yet, so only the rules a run can show apply.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { setOutput, die } from './lib/actions.js';
import { unconfirmed } from './lib/replay.js';

const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const evidence = process.env.QA_EVIDENCE_DIR ?? 'qa-evidence';
const report = read(process.env.REPORT ?? 'qa-report.json');
const workOrder = read('work-order.json');

if (process.env.PREFLIGHT) {
  const problems = unconfirmed({ report, workOrder, results: read(join(evidence, 'results.json')), exit: null,
    ran: "your suite's last run (results.json)" });
  if (problems.length) {
    die(`a pass is replayed by a job with no agent before it is recorded, and this one would be refused:\n` +
      `${problems.map((p) => `  - ${p}`).join('\n')}\nEvery criterion checked in the browser needs a test('T-<n> …') ` +
      'it cites in qa-run/tests that passes, run whole with the framework config.');
  }
  process.exit(0);
}

const dir = process.env.REPLAY_DIR ?? 'qa-replay';
const exit = existsSync(join(dir, 'exit')) ? readFileSync(join(dir, 'exit'), 'utf8').trim() : null;
const spec = join(evidence, 'spec');
const kept = existsSync(spec) ? readdirSync(spec, { recursive: true }).filter((f) => /\.(spec|test)\.[^/]+$/.test(f)).length : 0;
const problems = unconfirmed({ report, workOrder, results: read(join(dir, 'results.json')), exit, kept,
  job: process.env.REPLAY_JOB || 'unknown' });

if (problems.length) {
  setOutput('refused', problems.join('\n'));
  process.stdout.write(`::warning::the replay did not confirm QA's pass:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
} else {
  process.stdout.write(report?.verdict === 'pass' ? `replay: confirms QA's pass (exit ${exit ?? 'n/a'}, ${kept} spec file(s))\n`
    : `replay: nothing to confirm — the verdict is "${report?.verdict}"\n`);
}
