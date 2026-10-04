// The repository's ceiling on agent sessions per UTC day.
//
// The only budget was an issue's: `limits.attempts` per stage of each ticket. Nothing bounded a
// day, and the work generates itself — every merge files a follow-up ticket that files its own,
// the maintainer's twice-daily survey files more — so a repository could spend without limit
// while every issue stayed inside its budget. tabs-app ran about 143 agent runs in 65 hours over
// 21 tickets, and no number anywhere would have stopped the 500th.
//
// One counter for the whole repository, state/sessions.json on the state branch, keyed by UTC
// day and written compare-and-swap as the admissions record is, so two stages starting in the
// same second cannot both take the last session. It is spent by `sdlc-ctl attempt`, the step
// every agent stage passes before its agent runs; a council counts once, as one stage run. When
// the day is spent the stage does not start: the issue parks until 00:00 UTC on the outage
// cooldown's retry_after, which the watchdog resumes by itself, and the repository hears it once,
// on one alert issue (lib/alert.js) — not in a comment per issue.
//
// Not spent by what is bounded already: the triage (once per failure of a run counted here),
// intake's router (once per issue, which then stops at its first counted stage), the maintainer
// (two surveys a day, one split per epic — what they file queues behind this), the librarian
// (nightly), release notes (once per merge), self-fix (`self_fix.per_day`), and the probe and the
// canary, which have to answer precisely when everything else has stopped.
import { readLedger, updateLedger } from './state-io.js';
import { parkForCooldown } from './failure.js';
import { raiseAlert } from './alert.js';

/**
 * About twice tabs-app's busiest stretch: 143 agent runs in 65 hours is ~53 a day, ~7 a ticket.
 * 100 leaves room for a day of ~14 tickets, and holds a runaway loop to two ordinary days' spend.
 */
export const SESSIONS_PER_DAY = 100;
const KEEP_DAYS = 14;

/**
 * The day's ceiling, `limits.max_agent_sessions_per_day`. Absent is the default, and so is
 * anything that is not a positive whole number — 0 included. Every other limit here reads 0 as
 * "no cap", and a ceiling that a blank or a typo switches off is not a ceiling: there is no
 * unlimited, and allowing more is setting a larger number. A value it cannot use is said, every run.
 */
export function sessionCeiling(limits) {
  const raw = limits?.max_agent_sessions_per_day;
  if (raw === undefined || raw === null) return { max: SESSIONS_PER_DAY };
  if (Number.isInteger(raw) && raw > 0) return { max: raw };
  return { max: SESSIONS_PER_DAY, warning: `limits.max_agent_sessions_per_day is ${JSON.stringify(raw)}, ` +
    `not a positive whole number, so the ceiling stays at ${SESSIONS_PER_DAY}. There is no unlimited: ` +
    'set a larger number to allow more.' };
}

const dayOf = (now) => new Date(now).toISOString().slice(0, 10);
export const nextUtcDay = (now = new Date()) => {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
};

/**
 * Take one of today's sessions off the record, or refuse. Pure: the IO is spendSession's.
 * `notice` is true for the first refusal of a day only, and the record then remembers it was
 * given, so the repository hears it once whichever stage hits the ceiling first.
 */
export function takeSession(record, { max, now = new Date() }) {
  const day = dayOf(now);
  const today = { sessions: 0, ...(record?.days?.[day] ?? {}) };
  const ok = today.sessions < max;
  const notice = !ok && !today.noticed;
  const days = { ...(record?.days ?? {}), [day]: ok ? { ...today, sessions: today.sessions + 1 } : { ...today, noticed: true } };
  return {
    ok, notice, day, sessions: ok ? today.sessions + 1 : today.sessions,
    record: { ...(record ?? {}), days: Object.fromEntries(Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).slice(-KEEP_DAYS)) },
  };
}

/** Has today's ceiling been reached? For the wake pass, which spends nothing. */
export async function ceilingReached(repo, cfg, now = new Date()) {
  const { ledger } = await readLedger(repo, 'sessions');
  return (ledger?.days?.[dayOf(now)]?.sessions ?? 0) >= sessionCeiling(cfg?.limits).max;
}

/**
 * Spend one of today's sessions on `stage` of `issue`, or park the issue until the next UTC day.
 *
 * `stage` is the stage to start again — what resume-cooled-down hands to rerunTarget — and
 * `run` the run this refuses, written as `ceiling_run` so that run's failure handler can tell
 * this wait from a failure (dispatch-fix).
 *
 * @returns {Promise<{ok: true, sessions: number, max: number} | {ok: false, reason: string}>}
 */
export async function spendSession(repo, cfg, { issue, stage, run = process.env.GITHUB_RUN_ID ?? null, now = new Date() }) {
  const { max, warning } = sessionCeiling(cfg?.limits);
  if (warning) process.stdout.write(`::warning::${warning}\n`);

  let taken;
  await updateLedger(repo, 'sessions', (record) => {
    taken = takeSession(record, { max, now });
    return taken.ok || taken.notice ? taken.record : null;
  });
  if (taken.ok) {
    process.stdout.write(`agent session ${taken.sessions} of ${max} today (UTC)\n`);
    return { ok: true, sessions: taken.sessions, max };
  }

  const until = nextUtcDay(now);
  const reason = `this repository has started ${max} agent sessions today (UTC), which is its ` +
    '`limits.max_agent_sessions_per_day`';
  await parkForCooldown(repo, issue, stage, 0, {
    until, agent: 'watchdog', extra: { ceiling_run: run ? String(run) : null },
    why: `${reason}. Raise it in .sdlc/config.yml to allow more today`,
  });
  if (taken.notice) {
    await raiseAlert(repo, {
      key: 'ceiling',
      title: 'The daily agent-session ceiling was reached',
      body: `## ${taken.day}: ${max} agent sessions, the day's ceiling\n\n` +
        `\`${stage}\` on #${issue} was the first stage refused. Nothing more starts today: each stage ` +
        `that tries parks until ${until.toISOString()}, and the watchdog starts it again then, by ` +
        'itself. Queued issues wait to be started rather than start and park.\n\n' +
        'This is `limits.max_agent_sessions_per_day` in `.sdlc/config.yml`. If today\'s work is worth ' +
        'more, raise it and `/sdlc retry <stage>` a parked issue. If a loop is filing work faster than ' +
        'it can be judged, this is where it stopped.',
    }).catch((e) => process.stdout.write(`::warning::could not raise the ceiling alert: ${String(e.message).split('\n')[0]}\n`));
  }
  process.stdout.write(`::error::${reason} — \`${stage}\` parked until ${until.toISOString()}\n`);
  return { ok: false, reason };
}
