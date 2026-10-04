#!/usr/bin/env node
// The default branch went red after a commit landed on it: stop the pipeline, propose taking the
// commit back out, and say so where a person looks. sdlc-main-verify runs it, in a job holding a
// write token that runs no product code and no agent.
//
// Nothing did this. A red default branch was found by the next PR that built on it, and the
// pipeline went on merging onto it. Stopping is `sdlc halt` itself — the same disable-and-cancel
// a person uses, not a second switch — and the revert is a PR, never a merge: whether to take the
// change out or fix forward is a person's call. Each commit is answered once, so a re-run, or the
// same commit verified again, opens no second revert; and a red revert is never reverted, so
// nothing loops.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gh, ghJson, repo as repoOf, die } from './lib/actions.js';
import { fileIssue } from './lib/file-issue.js';

const exec = promisify(execFile);
const say = (s) => process.stdout.write(`${s}\n`);
const bot = { name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com' };
const git = (args) => exec('git', args, {
  maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, GIT_AUTHOR_NAME: bot.name, GIT_AUTHOR_EMAIL: bot.email,
    GIT_COMMITTER_NAME: bot.name, GIT_COMMITTER_EMAIL: bot.email },
}).then((r) => r.stdout.trim());

const repo = repoOf();
const SHA = /^[0-9a-f]{40}$/;
const sha = process.env.SHA ?? '';
if (!SHA.test(sha)) die(`"${sha}" is not a commit sha`);
const base = process.env.DEFAULT_BRANCH || die('DEFAULT_BRANCH is not set');
const short = sha.slice(0, 7);

// Halted already: a person, or the red that came before this one, stopped the pipeline, and
// whoever starts it again decides what happens to the default branch. Unreadable is not halted —
// halting and proposing a revert is the safe side.
const state = await gh(['api', `repos/${repo}/actions/workflows/sdlc-main-verify.yml`, '--jq', '.state']).catch(() => '');
if (state && state !== 'active') {
  say(`the pipeline is halted (sdlc-main-verify is ${state}) — ${short} is left to whoever resumes it`);
  process.exit(0);
}

// Dispatched by sha, so the sha has to be the default branch's: reverting a commit from anywhere
// else would apply its inverse to code that never had it.
await git(['merge-base', '--is-ancestor', sha, 'HEAD'])
  .catch(() => die(`${short} is not on ${base} — nothing to revert`));

// What landed: everything the push added, along the default branch's own line, newest first. A
// dispatched merge, or a push whose before is not an ancestor (a force-push), is its one commit.
const before = process.env.BEFORE ?? '';
const range = SHA.test(before) && !/^0+$/.test(before)
  && await git(['merge-base', '--is-ancestor', before, sha]).then(() => true, () => false);
const commits = range ? (await git(['rev-list', '--first-parent', `${before}..${sha}`])).split('\n').filter(Boolean) : [sha];

const branch = `sdlc/revert-${sha.slice(0, 12)}`;
const answered = await ghJson(['pr', 'list', '--head', branch, '--state', 'all', '--json', 'number,url']);
if (answered.length) {
  say(`${answered[0].url} already reverts ${short} — answered once, not again`);
  process.exit(0);
}

// The merge that brought it, and the issue that merge closed: where the people who care look.
const prs = await ghJson(['api', `repos/${repo}/commits/${sha}/pulls`]).catch(() => []);
const pr = prs.find((p) => p.merge_commit_sha === sha);
const issue = pr && (String(pr.body ?? '').match(/(?:closes|fixes|resolves)\s+#(\d+)/i)?.[1]
  ?? String(pr.head?.ref ?? '').match(/^sdlc\/issue-(\d+)$/)?.[1]);

// A revert that is itself red is not reverted. Taking it out would put back the change that went
// red first, and a red revert of that would loop forever. A merged PR's squash keeps the title.
const messages = await Promise.all(commits.map((c) => git(['log', '-1', '--format=%B', c])));
const isRevert = messages.some((m) => /^Revert "/m.test(m) || /This reverts commit [0-9a-f]{7,}/.test(m));

let revert = null;
let unreverted = isRevert ? 'it is itself a revert, and reverting a revert puts back what went red first' : '';
if (!isRevert) {
  try {
    for (const c of commits) {
      const merge = (await git(['rev-list', '--parents', '-n', '1', c])).split(' ').length > 2;
      await git(['revert', '--no-edit', ...(merge ? ['-m', '1'] : []), c]);
    }
    await git(['push', 'origin', `+HEAD:refs/heads/${branch}`]);
    const title = commits.length === 1 ? `Revert "${messages[0].split('\n')[0]}"` : `Revert ${commits.length} commits ending at ${short}`;
    // `Reverts owner/repo#N` is the line on-merge reads: merging this reopens the issue it undoes.
    const url = await gh(['pr', 'create', '--base', base, '--head', branch, '--title', title, '--body', [
      ...(pr ? [`Reverts ${repo}#${pr.number}`, ''] : []),
      `\`${base}\` went red at ${short}: ${process.env.RUN_URL ?? 'see sdlc-main-verify'}. This takes ` +
      `${commits.map((c) => c.slice(0, 7)).join(', ')} back out. Nothing merges it for you.`,
    ].join('\n')]);
    revert = Number(String(url).trim().split('/').pop());
  } catch (e) {
    unreverted = `the revert onto \`${base}\` failed (${String(e.stderr || e.message).trim().split('\n')[0]})`;
    await git(['revert', '--abort']).catch(() => {});
  }
}

// Last, and never cancelling this run: a halt cancels every pipeline run in flight, and this
// one would have died before it said why.
const halt = await exec('node', ['bin/sdlc', 'halt']).then(() => null,
  (e) => String(e.stdout || e.message).replace(/\x1b\[\d+m/g, '').trim().split('\n').slice(-8).join('\n'));

const failed = process.env.CHECKS_FAILED === 'true' ? 'a check failed' : 'its setup failed — the checks never ran';
// The product's own test output, posted under the pipeline's name — so quoted. A heading, a
// marker or a fenced block in it must not read as one of the pipeline's own.
const summary = String(process.env.SUMMARY ?? '').trim().split('\n').filter(Boolean).map((l) => `> ${l}`).join('\n');
const body = [
  `## \`${base}\` is red`,
  '',
  `${short}${pr ? ` (#${pr.number})` : ''} landed and ${failed}: ${process.env.RUN_URL ?? 'see sdlc-main-verify'}.`,
  ...(summary ? ['', summary] : []),
  '',
  halt
    ? `- **The pipeline could not be halted.** Run \`sdlc halt\` now:\n\n\`\`\`\n${halt}\n\`\`\``
    : '- **The pipeline is halted** (`sdlc halt`): every workflow is disabled and what was running is cancelled.',
  revert
    ? `- **#${revert} reverts it** and is not merged. Its CI has not run while halted: \`sdlc resume\`, ` +
      `\`gh workflow run ci-verify.yml -f pr=${revert}\`, then merge it — or push a fix and close it.`
    : `- **Nothing reverts it**: ${unreverted}. Fix \`${base}\` by hand, then \`sdlc resume\`.`,
].join('\n');

if (issue ?? pr) await gh(['issue', 'comment', String(issue ?? pr.number), '--body', body]);
else {
  const filed = await fileIssue({ title: `${base} is red at ${short}`, body, labels: ['sdlc:needs-human'] });
  if (!filed) die(`could not say it anywhere — ${base} is red at ${short}`);
}
say(`${short} is red: ${revert ? `#${revert} reverts it` : `not reverted — ${unreverted}`}; ${halt ? 'NOT halted' : 'halted'}`);
if (halt) die(`sdlc halt failed:\n${halt}`);
