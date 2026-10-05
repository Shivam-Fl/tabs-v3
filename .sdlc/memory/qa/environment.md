# QA environment notes

Facts observed by QA runs and implementer browser walks on 2026-10-05 (PRs #9, #12, #14, #16, #19, #20, #23). Facts, not orders — each one was hit in the wild at least once.

## The preview on port 3000 lags the branch
The compose preview is a static build served from before the branch's changes, and the process
holding it sits outside a job's sandbox, so a run cannot restart it. Five of the eight PRs
merged on 2026-10-05 hit it, with three symptoms that all look like the change is broken:

- a new route 404s while the home page still renders (`/signup`, `/groups/new`),
- new `/_next/static/chunks/*` files 404, so React never hydrates and client islands look
  dead — a `useFormStatus` Save button showed no pending state for exactly this reason,
- a just-fixed bug still reproduces (PR #20's QA round 3 only confirmed the list-order fix
  after the preview was rebuilt from the fix commit).

The runs that needed the current build served a fresh production build of the branch on a
spare port (3100) and walked their scripts there. Every "still broken on the preview" result
that day traced to the stale build, not the code.

## Console noise that is not a bug
- A test that deliberately navigates to a route that must 404 (stranger probes, a dead invite
  link) makes Chromium log one `Failed to load resource` for the document itself.
- `/favicon.ico` 404'd on every page until PR #19; since `app/icon.svg` plus the root metadata
  there are no favicon requests at all, so a favicon 404 would now be a regression, not noise.
- `net::ERR_ABORTED` requests are Next's own prefetch and superseded navigations (~30 in one
  walk); not failures.

## The signup rate limit is a shared, real budget
Signup's only limiter key is the IP hint: 30 failures per 15 minutes per egress IP, plus a
shared `unknown` bucket for requests whose `x-forwarded-for` does not parse (lib/auth/rate-limit.ts). A browser suite accumulates failing signups and throttles itself suite-wide — seen
mid-campaign in PR #12's QA, which isolated each test behind a random `x-forwarded-for`. PR
#14's QA deliberately did not drive the null-IP throttle in the browser because 30 failures
would poison the shared `unknown` bucket for the replay run inside the window. Failing signups
against one address lock that address out for 15 minutes, and there is no reset flow.

## Accounts are per-run and never cleaned up
`qa_auth.mode` is still `none` in the pipeline config, so there are no provisioned
credentials: every run signs its own accounts up through `/signup` with timestamped addresses
(qa-*@example.com, qa-*@example.test). The app has no account-deletion UI, so each run's
accounts, groups, expenses and placeholder seats persist in the preview database — every
report that day ends with a "fixtures not cleaned up" list. Unique timestamped addresses are
what keep replay runs collision-free.

## PGlite never yields, so loading skeletons never paint locally
The members screen ships a designed `loading.tsx` skeleton, but the in-process PGlite resolves
inside the microtask queue, so React resolves the boundary before the shell flushes and the
served response already contains the resolved page — there is no paint window, and network
throttling cannot create one (it slows the wire, not the render). PR #16 pinned the fallback
on the streamed Flight response instead of pixels: the `<!--$?-->` marker and the
`data-skeleton` attributes appear in the stream, ahead of the resolved content. Against real
Neon latency the fallback paints first.

## Other constraints of this box
- Playwright runs Chromium only; no Firefox/WebKit pass is possible. Assertions are DOM- and
  text-based, so nothing engine-specific is relied on.
- Headless clipboard permissions make the invite-link Copy button unprovable by click; the
  link value is read from `#invite-url` instead.
- The Neon side of the database never runs under CI or QA (no remote DATABASE_URL in the
  compose boot): interactive transactions are proven on PGlite, and the Neon path is
  exercised only by a manual smoke script with a real URL.
