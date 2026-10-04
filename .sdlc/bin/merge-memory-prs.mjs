#!/usr/bin/env node
// Merges the Librarian's own memory pull requests on a repository where nobody else will.
//
// open-memory-pr opens one a night for a person to read. With `gates.merge_approval: false` no
// person reads memory, so none was merged: memory never updated, and every night added another
// memory/<date> PR cut from the same main, each conflicting with the last on index.md. This runs
// first each night, before the Librarian reads memory again, and merges what it opened — on the
// terms a repository that lets the pipeline merge its own work already set, and no looser:
//
// - merge approval is off (with it on, a person merges these, as before);
// - the PR is this repository's, the pipeline's, from a memory/<date> branch;
// - every file it changes is under .sdlc/memory/, and none is one the guard keeps a person's
//   there (project.md, the brief, the spec index, the ADRs);
// - its CI is green by the rule the gate and the merge use, and it does not conflict.
//
// - it changes neither conventions.md nor anything under qa/, and adds no URL, shell command or
//   instruction addressed to an agent (FOR_A_PERSON below) — those wait for a person, who is told
//   why on the PR.
//
// Anything else is left open and the reason logged — unless a later night's PR of the same kind
// exists, which supersedes it: each night's is cut from the default branch, so an older one left
// open only conflicts with every later one on index.md and piles up. Those are closed, with a
// comment naming the PR that superseded them, and their branches kept so a person can reopen one.
// Not one waiting for a person: closing it would be deciding for them.
import { gh, ghJson, loadConfig, isPipelineAuthor, trustedComments, repo as repoOf } from './lib/actions.js';
import { reservedChanges, PR_FILES_CAP } from './lib/guards.js';
import { checkName, classifyRollup } from './lib/checks.js';

const cfg = await loadConfig();
const repo = repoOf();
if (cfg.gates?.merge_approval !== false) {
  process.stdout.write('gates.merge_approval is on — a person merges the memory pull requests\n');
  process.exit(0);
}

// What memory may not say without a person reading it first.
//
// Every agent reads the index's "Always" files before deciding anything, and with merge approval
// off a memory PR merged on identity, paths and CI alone: what the Librarian wrote from the day's
// PRs and issues became a standing instruction to every agent, unread. tabs-app's memory PR #16
// told QA to treat a run as covering the unauthenticated surface only "rather than reporting a
// pass". So these stop the auto-merge, and a person decides:
// - conventions.md, which reviewers enforce, and qa/, which steers what QA tests and passes;
// - an added line with a URL: a fetch target for an agent with a shell or the web;
// - a shell command — a fenced block, a `$ ` prompt, an inline command with a flag, curl, wget,
//   npm, npx, a pipe into a shell: an agent with Bash runs what memory tells it to;
// - an order to the agent reading it: "ignore …" (the opening of every injection), "you must …",
//   and telling it not to report, flag, file, escalate, block or fail what it finds.
// ponytail: patterns over added lines, not a reading of them; they hold for a person, they never merge.
const HELD_PATHS = /^\.sdlc\/memory\/(?:conventions\.md$|qa\/)/;
const FOR_A_PERSON = [
  ['a URL', /\b[a-z][a-z0-9+.-]*:\/\/|\bwww\./i],
  ['a shell command', /```|`\s*\$\s|`[^`\n]*\s--?[a-z][^`\n]*`|\b(?:curl|wget|npm|npx)\b|\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/i],
  ['an instruction addressed to an agent', /\bignor(?:e|ing)\b|\byou (?:must|should|need to|have to|are to)\b|\b(?:do not|don't|never|rather than|instead of) (?:report|flag|fil(?:e|ing)|escalat|block|fail)/i],
];

/** Why this memory change waits for a person, or null. `files` as the pulls/files API returns them. */
function forAPerson(files) {
  const why = [];
  for (const f of files) {
    for (const p of [f.previous_filename, f.filename]) if (p && HELD_PATHS.test(p)) why.push(`it changes ${p}`);
    if (f.patch === undefined && f.status !== 'removed' && !(f.status === 'renamed' && f.changes === 0)) {
      why.push(`GitHub returned no diff for ${f.filename}, so what it adds could not be read`);
      continue;
    }
    const added = String(f.patch ?? '').split('\n').filter((l) => l.startsWith('+')).map((l) => l.slice(1));
    for (const [what, re] of FOR_A_PERSON) {
      const line = added.find((l) => re.test(l));
      if (line) why.push(`${f.filename} adds ${what}: \`${line.trim().slice(0, 120).replace(/`/g, "'")}\``);
    }
  }
  return why.length ? why.join('; ') : null;
}

// A memory PR this pipeline opened in this repository: the only kind merged, or closed as superseded.
const identity = (pr) => (!/^memory\/\d{4}-\d{2}-\d{2}$/.test(pr.headRefName) ? 'not a memory/<date> branch'
  : pr.isCrossRepository !== false ? 'it comes from a fork'
    : !isPipelineAuthor(pr.author?.login) ? `@${pr.author?.login} opened it, not the pipeline` : null);

async function refusal(pr) {
  const who = identity(pr);
  if (who) return who;
  if (pr.mergeable === 'CONFLICTING') return 'it conflicts with the base branch';
  const files = (await gh(['api', `repos/${repo}/pulls/${pr.number}/files`, '--paginate', '--jq', '.[]']))
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  if (files.length >= PR_FILES_CAP) return `GitHub lists no more than ${PR_FILES_CAP} of its files, so the rest cannot be checked`;
  // Both sides of a rename: moving a lesson out of .sdlc/memory/ changes what is outside it too.
  const changes = files.map((f) => ({ path: f.filename, from: f.previous_filename,
    status: f.status === 'removed' ? 'D' : f.status === 'renamed' ? 'R' : f.status === 'added' ? 'A' : 'M' }));
  const outside = changes.flatMap((c) => [c.from, c.path]).filter((p) => p && !p.startsWith('.sdlc/memory/'));
  if (outside.length) return `it changes ${outside.join(', ')}, outside .sdlc/memory/`;
  const hits = reservedChanges({ changes, cfg, headRef: pr.headRefName });
  if (hits.length) return `it changes what a person owns: ${hits.map((h) => h.path).join(', ')}`;
  const held = forAPerson(files);
  if (held) return { why: held, person: true };
  const { missing, failing, pending } = classifyRollup(pr.statusCheckRollup, cfg);
  if (failing.length) return `${failing.map(checkName).join(', ')} failed`;
  if (missing.length || pending.length) return `${[...missing, ...pending.map(checkName)].join(', ')} has not passed`;
  return null;
}

// Said on the PR once per head, so the person it waits for knows why; the log is read by nobody.
async function askAPerson(pr, why) {
  const mark = `<!-- sdlc:memory-held ${pr.headRefOid} -->`;
  const said = await trustedComments('pr', pr.number, cfg, { pipelineOnly: true }).catch(() => []);
  if (said.some((c) => c.body.includes(mark))) return;
  await gh(['pr', 'comment', String(pr.number), '--body',
    `Not merged automatically: ${why}.\n\nEvery agent reads memory before it decides anything, so a change like ` +
    'this waits for a person. Merge it if it is right; close it if not. Write lessons as what was learned, ' +
    `not as orders to an agent.\n\n${mark}`])
    .catch((e) => process.stdout.write(`::warning::#${pr.number}: could not say why it waits: ${String(e.message).split('\n')[0]}\n`));
}

const open = await ghJson(['pr', 'list', '--state', 'open', '--limit', '200', '--json',
  'number,headRefName,headRefOid,isCrossRepository,author,mergeable,statusCheckRollup']);
// Oldest first: the order they were written in.
const memory = open.filter((p) => String(p.headRefName).startsWith('memory/')).sort((a, b) => a.number - b.number);
const left = [];
for (const pr of memory) {
  const refused = await refusal(pr);
  const { why, person = false } = typeof refused === 'string' ? { why: refused } : refused ?? {};
  if (why) {
    process.stdout.write(`#${pr.number} (${pr.headRefName}): left open — ${why}\n`);
    left.push({ pr, why, person });
    if (person) await askAPerson(pr, why);
    continue;
  }
  // Bound to the head whose checks were just read: a push since then is refused, not merged.
  await gh(['pr', 'merge', String(pr.number), '--squash', '--delete-branch', '--match-head-commit', pr.headRefOid])
    .then(() => process.stdout.write(`#${pr.number} (${pr.headRefName}): merged\n`))
    .catch((e) => {
      process.stdout.write(`::warning::#${pr.number} (${pr.headRefName}) could not be merged: ${String(e.message).split('\n')[0]}\n`);
      left.push({ pr, why: 'the merge itself failed' });
    });
}

// The newest of the pipeline's own, merged just now or still open, supersedes every older one left
// — except one waiting for a person.
const newest = memory.filter((p) => !identity(p)).at(-1);
for (const { pr, why } of left.filter(({ pr: p, person }) => !person && newest && !identity(p) && p.number < newest.number)) {
  await gh(['pr', 'close', String(pr.number), '--comment',
    `Superseded by #${newest.number}, a later night's memory pull request. This one was not merged (${why}), ` +
    'and every night\'s is cut from the default branch, so left open it only conflicts with each one after it. ' +
    'Closed rather than left to pile up; the branch is kept, so reopening this carries forward anything only it says.'])
    .then(() => process.stdout.write(`#${pr.number} (${pr.headRefName}): closed — superseded by #${newest.number}\n`))
    .catch((e) => process.stdout.write(`::warning::#${pr.number} (${pr.headRefName}) could not be closed: ${String(e.message).split('\n')[0]}\n`));
}
