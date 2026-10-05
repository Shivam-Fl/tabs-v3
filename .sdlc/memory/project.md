# Project

Written by the project planner and approved by a human, once, before the first ticket was
planned. Every agent reads this before deciding anything — correct it here rather than
arguing with it in a ticket.

## What this is
Tabs is a Splitwise-class shared-expenses web app: groups of friends, flatmates or trip companions record who paid for what, split each expense (equally, by exact amounts, percentages or shares, with multiple payers allowed), see live balances with simplified who-pays-whom debts, settle up with recorded payments, and follow everything in an activity feed. One TypeScript Next.js application on Vercel with Postgres (Neon in production, embedded PGlite locally), real email/password accounts, exact integer-minor-unit money math, and a mobile-first UI ready for real users.

## Stack
TypeScript 5, Next.js 16 (App Router) + React 19 on Node 20+, Tailwind CSS v4, Drizzle ORM, PGlite (embedded WASM Postgres) when DATABASE_URL is unset and Neon Postgres via Drizzle's neon-serverless driver (a Pool from @neondatabase/serverless over WebSocket) when DATABASE_URL is set, bcryptjs password hashing, hand-rolled DB sessions, Vitest + TypeScript typecheck

The spec already fixes the big choices (TypeScript, Next.js App Router, Vercel, Postgres with PGlite-local/Neon-production), and research confirms each is on a live, documented path: Next.js 16 + React 19 is the current stable line, PGlite has a first-class Drizzle driver for zero-setup real-Postgres semantics, and Neon auto-wires pooled DATABASE_URL from Vercel Storage. Where the spec is silent, boring wins: Drizzle over Prisma for weight, hand-rolled DB sessions over Auth.js because server-side sign-out revocation is required, bcryptjs over argon2 because native bindings fail on serverless. The Neon side uses Drizzle's neon-serverless driver (WebSocket Pool), not the http driver, because expense writes must commit expense, payers, shares and activity rows in one interactive transaction and the http driver cannot hold one. Everything runs on node/npm alone, which is all the clean CI runner and the compose QA boot provide.

Rejected:
- **Prisma in place of Drizzle** — Heavier engine downloads on serverless and CI, and a weaker embedded-Postgres story than Drizzle's first-class PGlite driver.
- **Auth.js v5 / NextAuth for sessions** — In security-patch mode with its own team pointing new projects elsewhere, and its JWT strategy cannot revoke on server-side sign-out without extra machinery the spec forbids us to skip.
- **argon2 or native bcrypt for password hashing** — Documented native-binding load failures on Vercel serverless for both native bcrypt and argon2 Rust builds; pure-JS bcryptjs has no build step and works identically everywhere.
- **Dockerized or system Postgres for dev/CI** — Would need a container or installed server on the clean CI runner and the QA box, breaking the zero-setup constraint and the localhost-only compose boot.
- **Drizzle's neon-http driver for the Neon side** — Its one-shot HTTP requests hold no persistent session, so it cannot run interactive multi-statement transactions; creating, editing or deleting an expense must commit the expense, its payers, its shares and its activity entry atomically (TR-8).

## Architecture
One Next.js App Router application on Vercel serverless. Browser talks only to Next.js routes/Server Actions; all reads and writes go through a server-side authorization check against the session user, then through Drizzle to either embedded PGlite (DATABASE_URL unset: dev, CI, QA) or Neon Postgres (DATABASE_URL set: production). Pure domain logic (money splits, balances, debt simplification) lives in framework-free lib/ modules covered by unit tests; the database holds a ledger of expenses and payments from which balances are always derived.

### Modules
- `app/` — Routes, pages, layouts, Server Actions and API routes (incl. /api/health); the only place HTTP is handled
- `components/` — Shared React components built only from the ui tokens; no data fetching inside
- `lib/db/` — Drizzle schema (single source of truth), SQL migrations, getDb() that returns PGlite or a neon-serverless Pool
- `lib/auth/` — Signup/signin, bcryptjs hashing, opaque DB sessions, sign-out revocation, sign-in rate limiting
- `lib/money/` — Minor-unit money math, the four split calculators with validation, remainder rule, currency formatting
- `lib/settle/` — Net balances, greedy min-cash-flow simplification, settle-up payments; balances always derived, never stored
- `lib/activity/` — Activity-feed writers and readers (expense/payment/member events with actor and timestamp)
- `scripts/` — Seed script (users, groups, every split type, multi-payer expense, payments, placeholder) and migrate runner

## Invariants
These hold for every ticket, whatever it asks for.

- Money is integer minor units end to end; floats never cross a module boundary and are never stored.
- Every read and write of group data is authorized on the server against the session user; there are no anonymous mutations and the client is never trusted.
- Expense parts always sum to the expense total; the rounding remainder of equal, percentage and share splits goes to the first payer, deterministically.
- Balances are derived from the expense/payment ledger by one recompute path and are never stored; settle-up payments are ledger entries, not balance edits.
- Session tokens are opaque random values stored server-side; sign-out deletes the session row and a signed-out token authorizes nothing.
- Timestamps are stored in UTC and rendered in the viewer's time zone; amounts are rendered in the group's currency.
- A member with a non-zero balance can be neither removed nor leave; every membership change is recorded in the activity feed.
- No code except getDb() itself may branch on which database backend is active; CI and QA run on PGlite only, so a Neon-only code path would hide from every test.

## Requirements
Cited by id wherever work is split — an issue's `Covers: TR-3` means this list. The rationale
and the check that proves each one are in `docs/trd.md`; what is being built and for whom, and
what deliberately is not, in `docs/prd.md`; how every screen looks and behaves, in `docs/ui.md`.

- **TR-1** Ship one TypeScript Next.js App Router application deployed on Vercel; no long-running process and no local disk that outlives a request.
- **TR-2** With DATABASE_URL set use Neon Postgres through Drizzle's neon-serverless driver (a Pool from @neondatabase/serverless over WebSocket, pooled URL at runtime); with it unset run embedded PGlite; the same migrations apply automatically on start/deploy and user data survives redeploys and cold starts.
- **TR-3** Every read and write of group data is authorized on the server against the session user; users see only groups they belong to and missing-or-forbidden reads are indistinguishable.
- **TR-4** All money is integer minor units end to end, never floats; every split's parts sum to the whole with the rounding remainder assigned to the first payer, covered by unit tests.
- **TR-5** All secrets come from environment variables documented in the README; with nothing set the app boots on safe local defaults and logs it, while production refuses to start with a message naming the missing variable.
- **TR-6** Email/password signup and signin with slow salted hashing, secure httpOnly session cookies, server-side session end on sign-out, rate-limited failed sign-ins, no email-enumeration in errors, and a profile with display name and default currency.
- **TR-7** Group create (name, currency, type), owner-shared join links that can be disabled/rotated, placeholder members claimable on join, owner rename/remove/archive, no removal or leave with a non-zero balance, and membership-scoped visibility.
- **TR-8** Expenses with description, amount, date, one or many payers (parts sum to total), all four split types with validation errors naming the shortfall and its size, remainder to first payer, member/category filter, description search, newest-first list, and member-editable with changes recorded; create, edit and delete each commit the expense, its payers, its split lines and its activity entry atomically in a single interactive transaction, never half-written.
- **TR-9** Per-group net balances plus simplified who-pays-whom via stated greedy min-cash-flow (at most N-1 transfers), cross-group you-owe/you-are-owed totals per person on home, full/partial settle-up payments recorded in the feed and deletable by involved members, and an explicit all-zero state.
- **TR-10** Per-group and cross-group activity feeds recording expense added/edited/deleted, payments, and member join/leave/remove, each with actor and timestamp; an expense-edited entry stores a structured before/after of the fields that changed (description, amount, date, payers, participants, split type and inputs, category, note), written in the same transaction as the edit.
- **TR-11** Mobile-first responsive UI from the token set; one h1 and heading hierarchy, labelled controls, keyboard access and visible focus; designed empty/loading/error states; group-currency formatting; main screens interactive under 1s.
- **TR-12** Health endpoint proving database reachability, a seed with known-password users plus every split type, a multi-payer expense, payments and a placeholder, and a README covering one-command local run and from-scratch Vercel deploy (database, env vars, migrations).

## Commands
All four pipeline verbs are real (made so by the skeleton ticket, #3):
- `sdlc:verify` — `npm ci && npm run typecheck && npm run test:ci && npm run build`; there is no `lint` script and the repo deliberately has no ESLint config
- `sdlc:serve` — builds and starts on port 3000, which is the compose boot QA drives
- `sdlc:seed` — applies the migrations and exits 0; writes no fixture rows yet (fixtures belong to the seed ticket, TR-12)
- `sdlc:ready` — polls `/api/health` for `{status, db, latencyMs}`

## Deploy
Vercel, Git-connected: pushes to main deploy to production with Neon Postgres added from the project's Storage tab (pooled DATABASE_URL for runtime, direct URL for migrations); every pull request gets an automatic Vercel preview deployment. The pipeline's own QA does not drive those previews — env.mode is compose with a localhost-only allowlist — it boots the PR branch locally via npm run sdlc:serve and drives http://localhost:3000. First production deploy needs a person to connect Vercel, add Neon, and set the required secrets per the README guide.

## Open questions
- qa_auth.mode is currently none, but every group flow requires a signed-in user. Change it to derived (QA signs itself up via /signup, passwords derived from QA_FIXTURE_SEED) or fixture (QA logs in as seeded users)? Derived exercises signup on every run; fixture is simpler. Which do you want? — Status: still `none`; in practice every QA run signs its own timestamped accounts up through /signup (see memory/qa/environment.md), so the derived behaviour exists without the config or seed.
- The first production deploy and every Vercel preview need a person to connect the repo to Vercel, add Neon from the Storage tab, and set the required secrets. Who does that, and is it done before or after the skeleton ticket lands?
- ~~What is the default currency for new profiles and groups~~ — answered in code: new profiles default to INR (DEFAULT_CURRENCY in lib/auth/validation.ts; supported set INR, USD, EUR, GBP), the expense editor labels amounts in the group's currency, and QA walks assume it.
