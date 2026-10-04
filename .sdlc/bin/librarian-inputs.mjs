#!/usr/bin/env node
// What the Librarian reads, fetched before it runs, into librarian/ — and only what this
// repository's own people and the pipeline wrote.
//
// The Librarian was told to `gh pr list` the day's merged PRs, and its pack to read the closed
// issues, with Bash and a read token: on a public repository, anyone's words. What it distils
// becomes .sdlc/memory/, which every agent is told to read before it decides anything, and with
// merge approval off it merged the next night unread. One outsider's issue was a standing
// instruction to every future agent. So this reads GitHub instead, in the same read-only job, as
// maintainer-inputs does for the maintainer, and the Librarian has no shell (claude-args).
//
//   merged.json   PRs merged in the last day: {number, title, body, files, comments} by a trusted
//                 author, its trusted comments only; {number, untrusted: true} otherwise
//   closed.json   issues closed in the last day by a trusted author: {number, title, body, reason}
import { mkdirSync, writeFileSync } from 'node:fs';
import { gh, ghJson, loadConfig, isTrustedAuthor, trustedComments, repo as repoOf } from './lib/actions.js';
import { sanitise } from './lib/issue-text.js';

const cfg = await loadConfig();
const repo = repoOf();
const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const trusted = (i) => isTrustedAuthor({ login: i.user?.login, association: i.author_association }, cfg);
mkdirSync('librarian', { recursive: true });
const write = (file, data) => writeFileSync(`librarian/${file}`, `${JSON.stringify(data, null, 2)}\n`);

// One page, most recently updated first: a day's merges are well inside it.
const pulls = (await ghJson(['api', `repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`]))
  .filter((p) => p.merged_at && p.merged_at >= since);
const merged = [];
for (const p of pulls) {
  if (!trusted(p)) { merged.push({ number: p.number, untrusted: true }); continue; }
  const files = (await gh(['api', `repos/${repo}/pulls/${p.number}/files`, '--paginate', '--jq', '.[].filename']))
    .split('\n').filter(Boolean);
  const comments = (await trustedComments('pr', p.number, cfg)).map(({ login, createdAt, body }) => ({ author: login, createdAt, body }));
  merged.push({ number: p.number, title: sanitise(p.title), body: sanitise(p.body), mergedAt: p.merged_at, files, comments });
}
write('merged.json', merged);

const closed = (await ghJson(['api', `repos/${repo}/issues?state=closed&since=${since}&per_page=100`]))
  .filter((i) => !i.pull_request && i.closed_at >= since && trusted(i))
  .map((i) => ({ number: i.number, title: sanitise(i.title), body: sanitise(i.body), reason: i.state_reason ?? null }));
write('closed.json', closed);
process.stdout.write(`librarian/: ${merged.length} merged PR(s), ${merged.filter((p) => p.untrusted).length} by someone else; ` +
  `${closed.length} closed issue(s) by a trusted author\n`);
