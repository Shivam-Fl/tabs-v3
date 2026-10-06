#!/usr/bin/env node
// Puts what the demo job recorded on the PR, as a "Before / after" comment.
//
//   PR=<n> SHA=<head> node .sdlc/bin/pr-demo-post.mjs [dir]
//
// Runs in a job with a write token and no agent, from the default branch's framework, and runs
// nothing from the branch: what it handles is media files, each checked by lib/pr-demo.js.
//
// `gh pr comment --attach` uploads each file as a GitHub attachment and rewrites the comment's
// references to it, so the recordings play inline. GitHub takes those uploads only from a person's
// token — the Actions token gets "unsupported authentication type" (tabs-v3 PR #42) — so this tries
// only when the repo gives one (MEDIA_TOKEN, from the SDLC_MEDIA_TOKEN secret). Otherwise, or when
// it fails, the files go on an orphan `sdlc-media` branch, which nothing checks out and no
// workflow runs on, and the comment shows the screenshots from there and links the recordings,
// which GitHub plays only as attachments.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gh, repo as repoOf, die } from './lib/actions.js';
import { scenarios, demoComment, title } from './lib/pr-demo.js';

const pr = process.env.PR;
const sha = String(process.env.SHA ?? '');
if (!/^\d+$/.test(String(pr))) die('PR is not a pull request number');
if (!/^[0-9a-f]{7,40}$/.test(sha)) die('SHA is not a commit');
const dir = resolve(process.argv[2] ?? '_demo');

const list = scenarios(dir);
if (!list.length) {
  process.stdout.write('nothing recorded after the change that is a PNG or MP4 of a bounded size: no comment\n');
  process.exit(0);
}

// --- attached ----------------------------------------------------------------
const local = (side, f) => `./${relative('.', join(dir, side, f))}`;
const files = list.flatMap((s) => ['before', 'after'].flatMap((side) =>
  Object.values(s[side]).map((f) => ({ path: local(side, f), alt: `${side === 'before' ? 'Before' : 'After'}: ${title(s.name)}` }))));
const body = demoComment({ sha, list, link: local, videos: true });
writeFileSync('demo-comment.md', `${body}\n`);
const media = process.env.MEDIA_TOKEN;
const attached = !media ? { status: 1, stderr: 'no SDLC_MEDIA_TOKEN: the Actions token cannot upload attachments' } :
  spawnSync('gh', ['pr', 'comment', String(pr), '--body-file', 'demo-comment.md',
  // A video plays and has no alt text: gh refuses one ("cannot set alt text on video", PR #40).
  ...files.flatMap((f) => ['--attach', f.path.endsWith('.mp4') ? f.path : `${f.path}#${f.alt}`])],
  { encoding: 'utf8', env: { ...process.env, GH_TOKEN: media } });
if (attached.status === 0) {
  process.stdout.write(`PR #${pr}: before and after for ${list.length} scenario(s), attached\n`);
  process.exit(0);
}
process.stdout.write(`${media ? '::warning::' : ''}gh could not attach the recordings (${(attached.stderr || attached.stdout).trim().split('\n')[0]}); ` +
  'putting them on the sdlc-media branch instead\n');

// --- the media branch ----------------------------------------------------------
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const BRANCH = 'sdlc-media';
const tree = resolve('_media');
const sub = `pr-${pr}/${sha.slice(0, 12)}`;
// Into a ref, not FETCH_HEAD: that is per worktree, and the one below never sees this one's
// (tabs-v3 PR #42, the first post after the branch existed).
let exists = true;
try { git('.', 'fetch', '--quiet', 'origin', `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`); } catch { exists = false; }
git('.', 'worktree', 'add', '--quiet', '--detach', tree);
if (exists) {
  git(tree, 'checkout', '--quiet', '-B', BRANCH, `origin/${BRANCH}`);
} else {
  git(tree, 'checkout', '--quiet', '--orphan', BRANCH);
  git(tree, 'rm', '-rfq', '--ignore-unmatch', '.');
  git(tree, 'clean', '-fdq');
}
for (const s of list) {
  for (const side of ['before', 'after']) {
    for (const f of Object.values(s[side])) {
      mkdirSync(join(tree, sub, side), { recursive: true });
      cpSync(join(dir, side, f), join(tree, sub, side, f));
    }
  }
}
git(tree, 'add', '--', sub);
git(tree, '-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
  'commit', '--quiet', '-m', `media: before and after for #${pr} at ${sha.slice(0, 12)}`);
// Tickets run in parallel, so another PR's demo may have pushed since the fetch. Each PR's files
// sit under their own directory, so a rebase onto it never conflicts.
for (let i = 1; ; i++) {
  try { git(tree, 'push', '--quiet', 'origin', `HEAD:refs/heads/${BRANCH}`); break; } catch (e) {
    if (i === 3) throw e;
    git('.', 'fetch', '--quiet', 'origin', `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`);
    git(tree, 'rebase', '--quiet', `origin/${BRANCH}`);
  }
}

const base = `https://github.com/${repoOf()}/blob/${BRANCH}/${sub}`;
await gh(['pr', 'comment', String(pr), '--body-file', '-'],
  { input: `${demoComment({ sha, list, link: (side, f) => `${base}/${side}/${f}?raw=true`, videos: false })}\n` });
process.stdout.write(`PR #${pr}: before and after for ${list.length} scenario(s), from ${BRANCH}:${sub}\n`);
