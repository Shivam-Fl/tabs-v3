// Every key .sdlc/config.yml may hold, and the one check of it.
//
// loadConfig was a bare YAML parse, and every reader falls back to a default when its key is
// absent — so a key spelled wrong was a key absent, said by nothing. `gates.min_confidnce: 70` was
// a confidence floor of 0. `plan_approval: no` is the string "no" in YAML 1.2, which no reader
// compares with false. `allowlist: alice` is a string, and `.includes` on a string matches "ali".
//
// The kill switch (`sdlc-ctl guard`, the first step of every workflow) refuses a config this
// finds an error in, and `sdlc doctor` reports the same list. The keys are the ones the code
// reads; a key added to the code and not here stops every run until it is, which is the point.

import { ROLES } from '../claude-args.mjs';
import { enabledRiskAreas } from './triage.js';

// A leaf is a type: string, number, boolean, map (keys not checked) or strings (a list of
// scalars). An array is alternatives; oneOf() is the values a key takes; listOf() a list of
// sections; a plain object is a section whose keys are checked.
const oneOf = (...values) => ({ oneOf: values });
const listOf = (item) => ({ listOf: item });
const each = (names, spec) => Object.fromEntries(names.map((n) => [n, spec]));

export const CONFIG_SCHEMA = {
  runtime: {
    provider: { base_url: 'string', headers: 'map', openai_models: ['strings', 'map'], serves_claude: 'boolean' },
    // A string is the one model for every step, as before steps had their own (claude-args setting()).
    model: ['string', each(ROLES, 'string')],
    // Empty or 0 is no limit, and a value that is not a number is read as 0.
    max_turns: each(ROLES, ['number', 'string']),
  },
  councils: { plan: oneOf('single', 'council'), review: oneOf('single', 'council') },
  // Project skills a step must load (.claude/skills/<name>); any step may load any of them anyway.
  skills: each(ROLES, 'strings'),
  base_branch: 'string',
  route_bugs_to_debugger: 'boolean',
  intake: { risk_areas: each(enabledRiskAreas({}), 'boolean') },
  route: { enabled: 'boolean', fast_path: 'boolean', trivial_max_lines: 'number', trivial_max_files: 'number' },
  env: {
    mode: oneOf('preview', 'compose', 'none'), base_url: 'string', url_allowlist: 'strings', api_allowlist: 'strings',
    ready: 'string', ready_timeout_seconds: 'number', audit_url: 'string', boot: 'string', deploy_wait_minutes: 'number',
  },
  debug_env: { allow_production: 'boolean', url_allowlist: 'strings', api_allowlist: 'strings', read_only: 'boolean' },
  qa_auth: {
    mode: oneOf('none', 'fixture', 'secrets', 'derived'),
    accounts: listOf({ role: 'string', fields: 'map' }),
    scope: oneOf('run', 'pr', 'global'), roles: 'strings', email_domain: 'string', signup_url: 'string',
  },
  verify: {
    mode: oneOf('own', 'existing', 'both', 'none'), required_checks: 'strings', wait_minutes: 'number',
    prepare: 'string', typecheck: 'string', lint: 'string', unit: 'string', build: 'string', e2e: 'string',
  },
  gates: {
    plan_approval: 'boolean', plan_review_agent: 'boolean', min_confidence: 'number', merge_approval: 'boolean',
    qa_files_issues: 'boolean', min_route_confidence: 'number', max_route_risk: 'number', on_doubt: oneOf('human', 'agents'),
  },
  self_fix: { enabled: 'boolean', per_day: 'number', report_upstream: 'boolean', name_project: 'boolean', framework_repo: 'string' },
  limits: {
    attempts: 'number', runtime_retries: 'number', max_in_flight: 'number', lock_ttl_minutes: 'number',
    repeat_failure_escalate: 'number', stall_hours: 'number',
    // The repository's agent sessions per UTC day (lib/ceiling.js), and the per-run dollar cap
    // claude-args passes as --max-budget-usd.
    max_agent_sessions_per_day: 'number', max_usd_per_run: 'number',
  },
  // A dead-man service pinged after every watchdog sweep and passing canary (heartbeat.mjs).
  alerts: { heartbeat_url: 'string' },
  forbidden_paths: 'strings',
  allowlist: 'strings',
  maintainer: { club_if_under_files: 'number', flag_chain_of: 'number', flag_similarity: 'number' },
  spec: { paths: 'strings' },
  release: { merge_method: oneOf('squash', 'merge', 'rebase') },
};

// Keys an earlier version wrote and nothing reads now. A warning, not an error: a config carrying
// one runs exactly as it would without it, and an upgrade must not stop a pipeline over it.
export const DEAD = {
  'limits.minutes': 'there is no wall-clock cap per issue; limits.attempts and each job\'s timeout-minutes bound the work',
  'release.auto_merge': 'gates.merge_approval is the only merge switch',
  // The release agent adds notes to one rolling draft release; publishing it, tagging it and
  // choosing its version are a person's, and no changelog file is written.
  'release.auto_tag': 'nothing tags a release — a person publishes the draft release, and chooses its tag',
  'release.changelog': 'no changelog file is written — release notes go into the rolling draft release',
  'verify.install': 'the install is not read from config — it is the Install step of .github/workflows/ci-verify.yml',
  'qa_auth.secrets': 'qa_auth.accounts names the secrets each role signs in with',
};

const isMap = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSection = (s) => isMap(s) && !s.oneOf && !s.listOf;
const TYPES = {
  string: (v) => typeof v === 'string',
  // A quoted number reads as one everywhere it is used (Number(), or a comparison).
  number: (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))),
  boolean: (v) => typeof v === 'boolean',
  strings: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number'),
  map: isMap,
};
const NAMES = { string: 'a string', number: 'a number', boolean: 'true or false', strings: 'a list', map: 'a map of keys' };
const describe = (spec) => (typeof spec === 'string' ? NAMES[spec]
  : Array.isArray(spec) ? spec.map(describe).join(' or ')
    : spec.oneOf ? `one of ${spec.oneOf.join(', ')}` : spec.listOf ? 'a list' : 'a section of keys');
const shown = (v) => (Array.isArray(v) ? 'a list' : isMap(v) ? 'a map' : JSON.stringify(v));

// Every dotted path the schema knows, for "did you mean".
const PATHS = (function walk(spec, at) {
  const inner = Array.isArray(spec) ? spec.find(isSection) : spec?.listOf ?? spec;
  if (!isSection(inner)) return [];
  return Object.entries(inner).flatMap(([k, s]) => [at ? `${at}.${k}` : k, ...walk(s, at ? `${at}.${k}` : k)]);
})(CONFIG_SCHEMA, '');

function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}
const nearest = (path) => {
  const bare = path.replace(/\[\d+\]/g, '');
  return PATHS.reduce((best, p) => (distance(bare, p) < distance(bare, best) ? p : best), PATHS[0]);
};

const FIX = 'correct it in .sdlc/config.yml — the README\'s "Every config key" lists them';

/**
 * @returns {{errors: {say: string, fix: string}[], warnings: {say: string, fix: string}[]}}
 *          an error stops the pipeline at its kill switch; a warning is said and run past
 */
export function checkConfig(cfg) {
  const errors = [];
  const warnings = [];
  if (!isMap(cfg)) return { errors: [{ say: 'config.yml is not a map of keys', fix: FIX }], warnings };
  const wrong = (path, value, spec) => errors.push({ say: `${path} is ${shown(value)}, which is not ${describe(spec)}`, fix: FIX });

  (function check(value, spec, path) {
    if (value === null || value === undefined) return;   // unset: the reader's own default
    if (Array.isArray(spec)) {
      const fits = spec.find((s) => (isSection(s) ? isMap(value) : typeof s === 'string' && TYPES[s](value)));
      return fits ? check(value, fits, path) : wrong(path, value, spec);
    }
    if (spec.oneOf) return spec.oneOf.includes(value) ? undefined : wrong(path, value, spec);
    if (spec.listOf) {
      if (!Array.isArray(value)) return wrong(path, value, spec);
      return value.forEach((item, i) => check(item, spec.listOf, `${path}[${i}]`));
    }
    if (typeof spec === 'string') return TYPES[spec](value) ? undefined : wrong(path, value, spec);
    if (!isMap(value)) return wrong(path, value, spec);
    for (const [key, v] of Object.entries(value)) {
      const at = path ? `${path}.${key}` : key;
      if (Object.hasOwn(spec, key)) check(v, spec[key], at);
      else if (DEAD[at]) warnings.push({ say: `${at} is set, and nothing reads it`, fix: `${DEAD[at]} — delete the key.` });
      else errors.push({ say: `${at} is not a config key — the nearest one is ${nearest(at)}`, fix: FIX });
    }
  })(cfg, CONFIG_SCHEMA, '');
  return { errors, warnings };
}
