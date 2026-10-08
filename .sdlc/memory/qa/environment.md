# QA environment notes

Facts observed by QA runs and implementer browser walks on 2026-10-05 (PRs #9–#23), re-hit through 2026-10-06 (PRs #40–#59) and 2026-10-07 (PRs #61–#72). Facts, not orders — each one was hit in the wild at least once.

## The preview on port 3000 lags the branch
The compose preview is a static build served from before the branch's changes, and the process
holding it sits outside a job's sandbox, so a run cannot restart it. Five of the eight PRs
merged on 2026-10-05 hit it; every QA round on PRs #56–#72 that probed the build id (below)
found `:3000` current. Stale-preview symptoms all look like the change is broken:

- a new route 404s while the home page still renders (`/signup`, `/groups/new`),
- new `/_next/static/chunks/*` files 404, so React never hydrates and client islands look
  dead — a `useFormStatus` Save button showed no pending state for exactly this reason,
- a just-fixed bug still reproduces (PR #20's QA round 3 only confirmed the list-order fix
  after the preview was rebuilt from the fix commit).

The runs that needed the current build served a fresh production build of the branch on a
spare port (3100) and walked their scripts there. Every "still broken on the preview" result
that day traced to the stale build, not the code. Hit again by PRs #43 and #48 on
2026-10-06 (there: chunks 404ing *and* `/` answering 500).

**How to tell whether `:3000` serves the branch you are about to test** — check the build id
against the build on disk (`_pr/.next/BUILD_ID` is where this box's only `.next` build lives):
a matching id answers 200, a bogus id 404s. Verified-before-testing is one probe, not a
re-run-and-hope cycle (PR #22's QA did it first).

**The base preview can also wedge under Playwright traffic outright** — health timeouts and
aborted requests rather than stale content (PR #43's BUG-1 base-check; PR #44's `/profile`
rendered no form at all, just Next error chrome). When a before/after needs the base branch,
the honest "before" is the pipeline's own base-branch recording job: building `main` in a
scratch tree fails here (hardlinks across the overlay return `Invalid cross-device link`,
and Turbopack rejects an out-of-root `node_modules` symlink).

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

The same hides the JavaScript-off notice on a screen whose boundary is in-page: `/activity`
(Suspense below the session guard, no route-level `loading.tsx`) answers a scriptless reader
with the resolved feed, so "skeleton plus notice" is unobservable there, while the members
screen keeps a route-level `loading.tsx` and does show both (PR #59 QA, AC-11). Assert the
`/activity` fallback — `aria-busy="true"` and the sr-only `role=status` "Loading activity…" —
on the raw response, as PR #64's QA did, and the resolved page carries neither.

## The verify suite has known noise in it
- **`lib/db/*.test.ts` flake at vitest's default 5s timeout under parallel load.** PGlite boot
  takes ~5.0s against a 5.0s limit; at high file parallelism one of `migrate.test.ts`,
  `client.test.ts` or `backend-invariant.test.ts` times out, each passes alone in ~3s, and the
  full suite is green on re-run. Seen twice independently (PRs #40 and #43). A timeout there
  is timing, not a product regression.
  `app/api/health/route.test.ts` ("reports 503 degraded while the migration ledger is missing")
  flakes the same way and moves between itself and `backend-invariant.test.ts`: the unmodified
  base failed 2 of 3 full-suite runs on one implementer box (PR #56); each passes alone.
- **Vitest's GitHub Actions reporter prints an `EROFS` stack** trying to write a step summary
  into a read-only path. Reporter noise; the exit code is what counts (PR #22). An
  implementer in the sandbox ran `GITHUB_ACTIONS= npm run test:ci` to get a clean run, since
  the reporter cannot write its summary there (PR #64).
- **The `Vercel` check on a PR fails with "Deployment rate limited — retry in 24 hours"**
  (PRs #56, #61, #64). Infrastructure, not the diff; `ci-verify` is the check that proves the
  code, and QA passed with it red each time.
- **This repo has no DOM/React-render test harness** — vitest is `environment: 'node'` over
  `lib/`, `app/` and `scripts/` only (vitest.config.ts). A client-half repaint bug cannot be
  unit-tested here, so a work order's unit test for one passes on the unfixed tree; the
  browser walk is the evidence, and adding jsdom/testing-library would be a new dependency a
  plan must name (PRs #22 settled-branch region, #53 include-switch repaint).

## Each `playwright test` run wipes test-results
Playwright clears `test-results/` at every invocation, so run the *full* suite last — a `-g`
filter run after a full run erases its traces, videos and screenshots (PR #43's QA recorded
this flatly). The per-QA-report replay recipe stands: download the `qa-evidence`
artifact, then `npx playwright show-report qa-evidence/playwright-report`.

## Agent-box sandbox quirks (implementer sessions)
These shaped several implementer replies on 2026-10-05/06 and will cost the next one the
same time if rediscovered:
- `package.json` and `scripts/` are read-only inside an implementer session: a new dependency
  is staged at `sdlc-protected/` for the pipeline to apply (PR #40), and a scratch driver
  written into `scripts/` cannot be deleted afterwards (PR #22 left `scripts/.tmp-ac10-walk.mjs`).
- `npm ci` cannot run in place — the sandbox makes `node_modules/.bin` a mount point it cannot
  remove — so CI-shaped runs happen in a scratch clone of the head with the committed lockfile
  (PR #40).
- `pr-demo.spec.ts` sits at the repo root, uncommitted and hidden by `.git/info/exclude`; it
  imports `@playwright/test`, which is not a dependency, so its mere presence alone fails a
  bare `npm run typecheck` with one `TS2307`. The committed tree typechecks clean.

## Other constraints of this box
- Playwright runs Chromium only; no Firefox/WebKit pass is possible. Assertions are DOM- and
  text-based, so nothing engine-specific is relied on.
- Headless clipboard permissions make the invite-link Copy button unprovable by click; the
  link value is read from `#invite-url` instead.
- The Neon side of the database never runs under CI or QA (no remote DATABASE_URL in the
  compose boot): interactive transactions are proven on PGlite, and the Neon path is
  exercised only by a manual smoke script with a real URL.
