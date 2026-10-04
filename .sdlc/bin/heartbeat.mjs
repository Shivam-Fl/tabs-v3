#!/usr/bin/env node
// Pings `alerts.heartbeat_url`, when it is set: the watchdog after each sweep, the canary after
// each passing call.
//
// Every backstop here — stall notes, cooldown resumes, lock reclaims — runs on GitHub's
// `schedule`, which promises no timing: the fifteen-minute watchdog fired about 3% of the times it
// should have on two fresh repositories, and a public repository with no commit in 60 days has
// its schedules switched off. Nothing inside GitHub can report its own silence. A dead-man
// service outside it (healthchecks.io, Cronitor, Better Stack…) alarms when the pings STOP, so
// the silence has someone to hear it. Give it a period of a day: the canary pings once a day.
//
// Never fails the job and never prints the URL — anyone holding it can ping it. A ping that
// cannot be delivered is the dead-man service's to notice.
import { loadConfig } from './lib/actions.js';

const url = String((await loadConfig()).alerts?.heartbeat_url ?? '').trim();
if (!url) {
  process.stdout.write('no alerts.heartbeat_url — nothing to ping\n');
  process.exit(0);
}
let last = '';
for (let i = 0; i < 3; i++) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) { process.stdout.write('heartbeat sent\n'); process.exit(0); }
    last = `HTTP ${res.status}`;
  } catch (e) { last = e.message; }
  if (i < 2) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
}
process.stdout.write(`::warning::the heartbeat to alerts.heartbeat_url failed (${last}); the dead-man service will say so\n`);
