// What a PR shows a person before anyone reads its diff: the change, recorded. The implementer
// writes a short Playwright script that walks what it changed; a job with no agent and no write
// token runs it against the base branch and against the PR's head, and these turn what that job
// recorded into a "Before / after" comment on the PR: the videos as players and the last frames as
// images, uploaded with `gh pr comment --attach`.
//
// The files come from a job that ran the branch's code and an agent's script, so each one is held
// to what it claims to be — an image by its own bytes, of a bounded size — before anything with a
// write token touches it.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_SCENARIOS = 3;
// The bytes each kind starts with, at the offset they start at: an MP4's `ftyp` box is 4 bytes in.
const MAGIC = {
  '.png': [0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  '.mp4': [4, [0x66, 0x74, 0x79, 0x70]],
};

/** An image whose bytes are what its name says, and not too large to put in a PR. */
export function isMedia(file) {
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  if (!MAGIC[ext] || !existsSync(file)) return false;
  const size = statSync(file).size;
  if (!size || size > MAX_BYTES) return false;
  const [at, bytes] = MAGIC[ext];
  const head = readFileSync(file).subarray(at, at + bytes.length);
  return bytes.every((b, i) => head[i] === b);
}

/**
 * The scenarios recorded on both sides, paired by name: dir/before/<name>.{mp4,png} and
 * dir/after/<name>.{mp4,png}. A scenario needs something to show after the change; what the base
 * showed may be missing (a new screen has no before). Names are the file names the recorder chose
 * and nothing else, so nothing from the run's output reaches a path or the PR body unchecked.
 */
export function scenarios(dir) {
  const side = (s) => {
    const d = join(dir, s);
    if (!existsSync(d)) return {};
    const out = {};
    for (const f of readdirSync(d)) {
      const m = f.match(/^([a-z0-9][a-z0-9-]{0,59})\.(mp4|png)$/);
      if (!m || !isMedia(join(d, f))) continue;
      (out[m[1]] ??= {})[m[2]] = f;
    }
    return out;
  };
  const before = side('before');
  const after = side('after');
  return Object.keys(after).sort().slice(0, MAX_SCENARIOS)
    .map((name) => ({ name, before: before[name] ?? {}, after: after[name] }));
}

export const MARK = '<!-- sdlc:demo -->';

export const title = (name) => name.replace(/^pr-demo-/, '').replace(/-/g, ' ');

/**
 * The comment: one row per scenario with the last frame on each side, and the recordings listed
 * after the table. `link(side, file)` is where a file is reachable from the comment — its local
 * path for `gh --attach`, which uploads it and rewrites the reference, or a URL on the media branch.
 * `videos` says whether the recordings render as players (attached) or only as links (branch).
 */
export function demoComment({ sha, list, link, videos = true }) {
  const shot = (side, files) => (files.png ? `![${side}](${link(side, files.png)})` : '_nothing yet: new in this PR_');
  const lines = [
    MARK,
    `## Before / after — ${sha.slice(0, 12)}`,
    '',
    'Recorded by the pipeline, with no agent, from the implementer\'s demo script: first on the base ' +
      'branch, then on this PR\'s head. A step that fails on the base is expected where the change is new.',
    '',
    '| | Before | After |',
    '|---|---|---|',
    ...list.map((s) => `| ${title(s.name)} | ${shot('before', s.before)} | ${shot('after', s.after)} |`),
  ];
  if (!videos) {
    const recs = list.flatMap((s) => ['before', 'after'].filter((side) => s[side].mp4)
      .map((side) => `[${side}: ${title(s.name)}](${link(side, s[side].mp4)})`));
    if (recs.length) lines.push('', `Recordings: ${recs.join(' · ')}`);
  }
  return lines.join('\n');
}
