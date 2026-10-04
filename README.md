# Tabs

Shared expenses for friends, flatmates and trips — who paid, who owes, and the fewest payments
that settle everyone up.

This repository started empty. It is being built end to end — architecture, code, tests, QA and
deployment — by an autonomous SDLC pipeline, from one document: [docs/spec/tabs.md](docs/spec/tabs.md).
The pipeline's agents run on Muse Spark 1.3, DeepSeek V4.1 Flash and GLM-5.3 Flash, served through
OpenCode Go.

## Run it locally

One command, no configuration, no database to install:

```sh
npm ci
npm run sdlc:serve
```

Then open <http://localhost:3000>. `sdlc:serve` runs a production build and serves it with
`next start` on port 3000 — the same code path production runs, not a development server.

With no environment set, the app boots on safe local defaults and says so in the log:

```
[sdlc] safe local defaults in use: db backend PGlite (DATABASE_URL is unset) and a dev-only session secret (SESSION_SECRET is unset). Set both before deploying.
```

The database is then PGlite — real Postgres compiled to WebAssembly, embedded in the process and
held in memory — and the session secret is a fixed development value. Nothing is written to disk
and nothing survives a restart, which is the point: local runs need no setup and leave no state
behind. Boot also applies the migrations, so the database is ready on the instance that serves
traffic.

## The four verbs

| Command | What it does |
| --- | --- |
| `npm run sdlc:serve` | `next build`, then `next start --port 3000` |
| `npm run sdlc:ready` | Curls `/api/health`; exits non-zero until the app answers |
| `npm run sdlc:seed` | Applies the migrations and exits 0 (no fixture rows yet — fixtures belong to the seed ticket) |
| `npm run sdlc:verify` | `npm ci && npm run typecheck && npm run test:ci && npm run build` — the whole gate, on a fresh clone |

The gate is `sdlc:verify`. It starts from `npm ci`, so the committed `package-lock.json` is what CI
actually installs — if the lockfile is stale, the gate fails rather than quietly resolving
something else.

## Environment

All three variables are optional locally and are read only on the server.

| Variable | Unset | Set |
| --- | --- | --- |
| `DATABASE_URL` | Embedded PGlite, in memory | Neon Postgres over the pooled WebSocket connection string |
| `SESSION_SECRET` | A dev-only default, with a logged warning | Used as-is |
| `VERCEL_ENV` | Not production | `production` turns both fallbacks above into hard failures |

There are no `.env` files in the repository, deliberately — nothing to accidentally commit. Set
these in the shell (`DATABASE_URL=... npm run sdlc:serve`) or, in production, in the Vercel project.

**`VERCEL_ENV=production` is what makes a missing secret fatal**, never `NODE_ENV` alone. `next
build` and `next start` both set `NODE_ENV=production`, so keying the guard on it would make
`sdlc:serve` impossible to boot. Under `VERCEL_ENV=production`, a missing or blank `SESSION_SECRET`
throws
`Missing required secret: SESSION_SECRET. Production refuses to boot without it`, and a missing or
blank `DATABASE_URL` throws `Missing required secret: DATABASE_URL` — production never quietly runs
on the embedded database. Both checks happen at boot, before the first request is served.

A blank or whitespace-only value counts as unset, so a cleared Vercel variable cannot select the
remote backend and then fail to reach it.

## Health

`GET /api/health` reads the migration ledger rather than running `SELECT 1`, so a `200` proves the
database is reachable *and* that boot migrations reached the instance serving the request:

```json
{ "status": "ok", "db": "ok", "latencyMs": 2 }
```

If that read fails it answers `503` with `{"status":"degraded","db":"down",...}` and logs the cause.
A `503` after a deploy is usually a `DATABASE_URL` that is malformed or unreachable.

## Migrations

SQL files in `lib/db/migrations/` are the only schema changes, and `lib/db/schema.ts` is the Drizzle
source of truth they are generated from. They apply automatically at boot — a deploy migrates
itself, on the instance that then serves traffic — and each file runs inside one transaction
together with the ledger row recording it, so a file that fails half-way leaves neither its effects
nor a version claiming it applied. Re-running is safe; already-applied files are skipped by name.

Add one with:

```sh
npm run db:generate    # drizzle-kit generate, from lib/db/schema.ts
```

Two rules keep re-application safe: **an applied filename is immutable** — renaming one makes the
ledger forget it and the SQL runs again — and every schema edit goes through `db:generate` so the
SQL files and `lib/db/schema.ts` stay in step.

The SQL ships inside the server bundle (see `outputFileTracingIncludes` in `next.config.ts`), which
is why a deployment needs no source tree to read migrations from.

## Seed

`npm run sdlc:seed` applies the migrations and exits 0.

**It currently writes no fixture rows.** The seed data — known-password users, a group per split
type, a multi-payer expense, payments and a placeholder member — belongs to the seed ticket, so
TR-12's seed proof is still open. A green `sdlc:seed` today means "migrations ran", not "the seed
data is correct".

## Deploying to Vercel

The repository is not connected yet; the first deploy needs a person to do this once.

1. **Import the repository** into Vercel. It builds with the default Next.js settings — no custom
   build command.
2. **Add Neon from the project's Storage tab.** Vercel creates the database and sets `DATABASE_URL`
   for you. Paste the **pooled** connection string (the host with `-pooler` in it) if you set it by
   hand: runtime queries go through a WebSocket `Pool`, and a direct or malformed URL fails at the
   first query with a connection error rather than a named missing secret. Vercel's integration
   already sets the pooled one.
3. **Set `SESSION_SECRET`** to a long random value (`openssl rand -base64 32`). Use the same value
   across deploys; changing it invalidates existing sessions.
4. **Deploy.** The first boot applies the migrations and `/api/health` turns `200` once it has.

Push to `main` deploys to production; every pull request gets a preview deployment.

Before trusting a fresh database, run the manual smoke check against it:

```sh
DATABASE_URL='postgres://…-pooler…' npm run neon:smoke
```

It applies the migrations, then proves the one thing the embedded backend cannot: that a transaction
through the real remote driver rolls back and leaves nothing behind. CI never runs it — CI has no
remote database — which is exactly why it is a command you run by hand.
