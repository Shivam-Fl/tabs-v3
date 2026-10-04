#!/usr/bin/env node
// The issue an agent works on, written to a file before the agent runs:
//
//   node .sdlc/bin/issue-text.mjs --out "$RUNNER_TEMP/issue.md"     (ISSUE in the environment)
//
// Every agent read the issue with `gh issue view`, raw: HTML comments a person approving the
// rendered issue never saw, and any edit made after they approved it. This writes what was
// admitted instead (lib/issue-text.js), and the prompt names the file. Read-only: the ledger and
// the issue, with the agent job's own token.
import { writeFileSync } from 'node:fs';
import { loadConfig, flags, die, repo as repoOf } from './lib/actions.js';
import { admittedIssue, forAgent } from './lib/issue-text.js';

const { out } = flags();
const issue = process.env.ISSUE;
if (!out || !issue) die('usage: ISSUE=<n> issue-text.mjs --out <file>');

const a = await admittedIssue(repoOf(), issue, await loadConfig());
writeFileSync(out, forAgent(issue, a, (a.raw.labels ?? []).map((l) => l.name ?? l)));
if (a.edited) {
  process.stdout.write(`::warning::#${issue} was edited after @${a.snapshot.by ?? 'a maintainer'} admitted it. Its reporter is ` +
    `not trusted here, so agents read the admitted text (sha256 ${a.snapshot.admitted_sha256}); ` +
    '`/sdlc replan "<why>"` admits the issue again as it now stands.\n');
}
if (a.unapproved) {
  process.stdout.write(`::warning::#${issue} has no admitted copy on its ledger (it was admitted before one was kept), ` +
    'so agents read its text as it stands now, with hidden content removed.\n');
}
process.stdout.write(`#${issue}: ${out} (sha256 ${a.snapshot.sha256})\n`);
