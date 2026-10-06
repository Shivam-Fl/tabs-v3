#!/usr/bin/env node
// Where an implementer's stop goes, once its note is posted on the issue.
//
//   ISSUE=<n> node .sdlc/bin/implementer-stopped.mjs [note, default _out/implementer-note.md]
//
// The implementer stops when a plan's premise does not hold — the diagnosis is wrong, or the
// approach cannot reach the criteria — and says so with its evidence (implementer.md, "When the
// plan is wrong"). Every stop parked the issue for a person, though the pack promises "a stage
// whose entire job is re-deciding that": tabs-v3 #49's implementer measured the planned fix
// leaving the page 1136px wide, named the two headings that did it, and the issue waited for
// someone to type `/sdlc replan`.
//
// Under gates.on_doubt: agents, the first stop on an issue goes back to the stage that wrote the
// plan — the planner, or root-cause for a revision of its — with the plan kept as rejected and
// the implementer's note as the reason, which is how a rejected plan is handed back
// (apply-plan-review). A second stop is a person's: two plans the implementer could not build
// is a question about the ticket, not about one plan. Under on_doubt: human, every stop is.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { gh, loadConfig, repo as repoOf, die } from './lib/actions.js';
import { readLedger, updateLedger } from './lib/state-io.js';
import { advance } from './lib/advance.js';
import { rememberRejected } from './lib/artifact.js';
import { resolveStage } from './lib/flow-graph.js';
import { dispatchStage, markResume } from './lib/route-io.js';
import { readWorkOrder } from './lib/work-order.js';

const issue = process.env.ISSUE ?? die('ISSUE is required');
const note = readFileSync(process.argv[2] ?? '_out/implementer-note.md', 'utf8').trim();
const repo = repoOf();
const cfg = await loadConfig();
const HINT = '`/sdlc approve` runs the implementer again once the work order is right; `/sdlc replan "<why>"` revises it.';

// The stop is recorded either way: the issue's history shows the implementer stopped.
await advance(issue, 'needs-human', { agent: 'implementer' });
const { ledger } = await readLedger(repo, Number(issue));
const sentBack = ledger?.implementer_stops_replanned ?? 0;

const toPerson = async (why) => {
  await markResume(repo, issue, 'implement', 'retry');
  await gh(['issue', 'comment', issue, '--body', `${why}${why ? '\n\n' : ''}${HINT}`]);
};

if (cfg.gates?.on_doubt !== 'agents') {
  await toPerson('');
} else if (sentBack >= 1) {
  await toPerson('The implementer stopped on a plan that had already been sent back once for the same reason. ' +
    'Two plans it could not build is a question about the ticket, so this one is a person\'s.');
} else {
  const author = ledger?.validated_from === 'root-cause' ? 'root-cause' : 'plan';
  const workOrder = await readWorkOrder(repo, issue, cfg).catch(() => null);
  await rememberRejected(repo, issue, 'work-order', JSON.stringify(workOrder ?? {}, null, 2),
    [`the implementer could not build this plan and stopped, with this evidence: ${note.slice(0, 6000)}`]);
  await updateLedger(repo, Number(issue), (l) => (l ? { ...l, implementer_stops_replanned: sentBack + 1 } : null));
  // This run still holds the implementer's lock until its cleanup job, and a lock held by a
  // running run refuses the planner's claim. Released here; cleanup's release is then a no-op.
  try { execFileSync('node', ['.sdlc/bin/sdlc-ctl.mjs', 'unlock', '--issue', String(issue), '--agent', 'implementer'], { stdio: 'inherit' }); } catch {}
  const done = await dispatchStage({ repo, issue, target: resolveStage(author, { issue, ledger }),
    agent: 'implementer', why: 'the implementer showed the plan cannot be built as written' });
  if (done.dispatched) {
    await gh(['issue', 'comment', issue, '--body',
      `Sent back to the ${author === 'plan' ? 'planner' : 'root-cause stage'} with the evidence above, ` +
      'as `gates.on_doubt: agents` asks. A second stop on this issue goes to a person.']);
  } else if (!done.halted) {
    await toPerson('The plan could not be sent back to be revised.');
  }
}
