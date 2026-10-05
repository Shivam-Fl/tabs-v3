#!/usr/bin/env node
// Puts in place the files the agent's sandbox would not let it write, after the agent is done.
//
//   node apply-protected.mjs
//
// Every agent step sets CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, so the provider key never reaches what
// the agent runs. That also runs each of its commands in Claude Code's sandbox, which keeps
// read-only the paths a later tool trusts: the root package.json and lockfiles, package-manager
// config, .env files, and the scripts/ and .github/ folders. An implementer whose work order adds
// a dependency could not add it (tabs-v3 #33 stopped on exactly that), and one that changes a
// seed script could not change it.
//
// So the implementer writes what it wants there under sdlc-protected/, a mirror of the repo, and
// this runs after the session in a step with no agent and no key: it copies the files it accepts
// into the tree, rebuilds the lockfile from the manifest with install scripts off, and stages
// them. What it refuses stays the person's: package-manager config and .env files change where
// the package comes from and what the app is given, .github/ is reserved, and a lockfile is never
// taken from the agent — it is rebuilt from the manifest.
//
// It also removes the empty stand-ins the sandbox leaves where a protected path did not exist, so
// the bundle's `git add -A` never commits a 0-byte `.vscode` or `scripts`.
//
// Self-contained (node builtins only): the workflow copies it out of the default branch before the
// agent runs, so nothing the agent edited is what runs here.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, posix } from 'node:path';

const STAGED = 'sdlc-protected';
const ACCEPTED = (p) => p === 'package.json' || /^scripts\/./.test(p);
// What the sandbox writes over or stands in for at the repository root (Claude Code 2.1.27x).
const STAND_INS = ['.env', '.env.local', '.env.development', '.env.development.local', '.env.test',
  '.env.test.local', '.env.production', '.env.production.local', '.gitmodules', '.npmrc', '.yarnrc',
  '.yarnrc.yml', 'bunfig.toml', 'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  '.github', 'scripts', '.vscode', '.idea', '.claude'];

const git = (...args) => spawnSync('git', args, { encoding: 'utf8' });
const tracked = (p) => git('ls-files', '--error-unmatch', '--', p).status === 0;
const say = (s) => process.stdout.write(`${s}\n`);

// --- the sandbox's empty stand-ins ----------------------------------------------
for (const p of STAND_INS) {
  let st;
  try { st = lstatSync(p); } catch { continue; }
  if (st.isFile() && st.size === 0 && !tracked(p)) { unlinkSync(p); say(`removed the sandbox's empty stand-in ${p}`); }
}

// --- what the agent staged --------------------------------------------------------
const applied = [];
if (existsSync(STAGED) && lstatSync(STAGED).isDirectory()) {
  for (const rel of readdirSync(STAGED, { recursive: true }).map(String).sort()) {
    const from = join(STAGED, rel);
    const p = posix.normalize(rel.split('\\').join('/'));
    const st = lstatSync(from);
    if (st.isDirectory()) continue;
    if (!st.isFile() || p.startsWith('../') || p.split('/').includes('..') || !ACCEPTED(p)) {
      say(`::warning::not applied: ${STAGED}/${rel} — only package.json and scripts/ are taken from the agent`);
      continue;
    }
    if (p === 'package.json') {
      try { JSON.parse(readFileSync(from, 'utf8')); } catch (e) {
        say(`::warning::not applied: ${STAGED}/package.json does not parse (${e.message})`);
        continue;
      }
    }
    mkdirSync(dirname(p), { recursive: true });
    copyFileSync(from, p);
    applied.push(p);
    say(`applied ${p}`);
  }
  rmSync(STAGED, { recursive: true, force: true });
}

// --- the lockfile, from the manifest --------------------------------------------
// Whichever way package.json changed — staged here, or written by a tool the sandbox let through.
// --ignored: a package.json new on this branch is in the sandbox's exclude list.
const manifest = existsSync('package.json') && git('status', '--porcelain', '--ignored', '--', 'package.json').stdout.trim() !== '';
if (manifest) {
  const [cmd, args, lock, env] = existsSync('pnpm-lock.yaml')
    ? ['pnpm', ['install', '--lockfile-only', '--ignore-scripts'], 'pnpm-lock.yaml', {}]
    : existsSync('yarn.lock')
      // ponytail: Yarn 2+ only; classic has no lockfile-only install and fails here, which CI then reports.
      ? ['yarn', ['install', '--mode', 'update-lockfile'], 'yarn.lock', { YARN_ENABLE_SCRIPTS: 'false' }]
      : ['npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], 'package-lock.json', {}];
  if (cmd !== 'npm') spawnSync('corepack', ['enable'], { stdio: 'ignore' });
  const r = spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env } });
  if (r.status === 0) {
    say(`rebuilt ${lock} from package.json`);
    if (existsSync(lock)) applied.push(lock);
  } else {
    say(`::warning::${cmd} could not rebuild ${lock} from package.json: CI's install will say why\n${(r.stderr || r.stdout).trim().split('\n').slice(-10).join('\n')}`);
  }
  applied.push('package.json');
}

// Forced: the sandbox lists its stand-ins in .git/info/exclude, so a package.json a greenfield
// ticket creates is untracked and ignored, and a plain add would leave it out.
const paths = [...new Set(applied)];
if (paths.length) {
  const r = git('add', '-f', '--', ...paths);
  if (r.status !== 0) say(`::warning::git add failed: ${r.stderr.trim()}`);
}
