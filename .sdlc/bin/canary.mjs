#!/usr/bin/env node
// Once a day, one model call with the credential and the provider every stage uses.
//
// A dead credential was found by the first stage that needed it, read as an outage, and waited
// out about four hours of cooldowns before a person heard; on a quiet repository, by the next issue
// anyone filed. The probe (`sdlc doctor --live`) asks only when someone thinks to, and only on the
// API-key path. This asks every day, through Claude Code itself — so an OAuth token is asked too,
// exactly as an agent step would present it — and when the answer is no it says so on ONE issue,
// with what kind of no it was.
//
//   node .sdlc/bin/canary.mjs call     the job holding the model secrets and no GitHub write:
//                                      one `claude -p`, as outputs ok / class / detail / model
//   node .sdlc/bin/canary.mjs report   the job that may write and runs no npm: the alert issue
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig, setOutput, repo as repoOf } from './lib/actions.js';
import { ROLES, modelFor } from './claude-args.mjs';
import { openaiApis } from './model-bridge.mjs';
import { modelErrorClass } from './lib/failure.js';
import { raiseAlert } from './lib/alert.js';

const mode = process.argv[2];

if (mode === 'call') {
  const cfg = await loadConfig();
  // Whichever configured model the provider serves on the Messages API. The question is whether
  // the credential and the endpoint answer, which every stage shares; one model served only
  // through the translator would need it started, and the probe covers those.
  const bridged = openaiApis(cfg);
  const model = ROLES.map((r) => modelFor(cfg, r)).find((m) => !bridged.has(m));
  if (model === undefined) {
    process.stdout.write('every configured model runs through the translator — nothing to call directly; `sdlc doctor --live` probes them\n');
    setOutput('ok', 'skipped');
    process.exit(0);
  }
  // One turn, no tools: the smallest session Claude Code will run, so a pass costs next to nothing.
  const run = await promisify(execFile)('claude', ['-p', 'Reply with the word ok.', '--max-turns', '1', '--tools', '',
    '--output-format', 'json', ...(model ? ['--model', model] : [])], { timeout: 180_000, maxBuffer: 16 << 20 })
    .then((o) => ({ code: 0, stdout: o.stdout, stderr: o.stderr }))
    .catch((e) => ({ code: e.code ?? 1, stdout: String(e.stdout ?? ''), stderr: e.killed ? 'no answer in three minutes' : String(e.stderr || e.message) }));
  let res = {};
  try { res = JSON.parse(run.stdout); } catch { /* not JSON: the CLI failed before a session */ }
  const ok = run.code === 0 && res.is_error !== true;
  const detail = String(res.result || run.stderr || run.stdout).replace(/\s+/g, ' ').trim().slice(0, 500);
  setOutput('ok', String(ok));
  setOutput('class', ok ? '' : modelErrorClass(detail));
  setOutput('detail', ok ? '' : detail);
  setOutput('model', model || '(action default)');
  process.stdout.write(ok ? 'the model answered\n' : `the model did not answer: ${detail}\n`);
} else if (mode === 'report') {
  const { OK: ok = '', CLASS: cls = '', DETAIL: detail = '', MODEL: model = '', RUN_URL: runUrl = '' } = process.env;
  if (ok === 'true' || ok === 'skipped') {
    process.stdout.write('the canary passed\n');
    process.exit(0);
  }
  const what = {
    auth: 'endpoint refused the credential (401/403)',
    'rate-limit': 'provider is rate- or quota-limiting the credential',
    outage: 'provider is failing — a 5xx, overloaded or unreachable',
  }[cls] ?? (ok === 'false' ? 'did not answer, for a reason the canary could not name'
    : 'could not be asked: the canary\'s call job did not finish');
  const next = cls === 'auth'
    ? 'Every agent stage fails the same way, and stops for a person when it does. Replace the secret — ' +
      '`CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`; `node .sdlc/bin/verify-token.mjs` checks one) or ' +
      '`ANTHROPIC_API_KEY` — then `gh workflow run sdlc-canary.yml` to check again.'
    : 'Stages that hit this park on a cooldown and start again by themselves. If it outlasts a few hours, ' +
      'look at the provider\'s status and the plan\'s quota, then `gh workflow run sdlc-canary.yml` to check again.';
  await raiseAlert(repoOf(), {
    key: 'canary',
    title: 'The model credential or provider is failing',
    body: `## ${new Date().toISOString().slice(0, 10)}: the model ${what}\n\n` +
      `**${cls || 'unknown'}** · model \`${model || '?'}\`\n\n` +
      (detail ? `\`\`\`\n${detail}\n\`\`\`\n\n` : '') + next + (runUrl ? `\n\n[The canary run](${runUrl})` : ''),
  });
  process.stdout.write(`::error::the model ${what}\n`);
  process.exit(1);
} else {
  process.stderr.write('usage: canary.mjs call|report\n');
  process.exit(1);
}
