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
| `npm run sdlc:seed` | Writes the demo fixtures and prints the sign-in details — see [Seed](#seed) |
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

`npm run sdlc:ready` is this same check as a command: it curls `/api/health` with `curl -fsS` and
exits non-zero until the app answers `200`. That is the deploy proof — green means the app is up
*and* boot migrations reached the instance serving traffic, which is the whole question a fresh
deploy raises. Against a deployment rather than a local run, curl its URL directly:

```sh
curl -fsS https://<your-deployment>/api/health
```

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

`npm run sdlc:seed` writes the demo fixtures, applying the migrations first when it has to run
them itself.

**The seed replaces what is there.** It empties the fixture tables — activity, split lines,
expense payers, expenses, payments, memberships, sessions, groups, users — and writes the set
again, so a second run leaves one copy rather than two. Sessions go with the wipe, so anybody
signed in is signed out. That is what a development database is for and it is unacceptable
anywhere else, which is why the seed refuses to run when `VERCEL_ENV=production` and the route it
uses in the serving app is refused there too.

It seeds whichever way reaches a database somebody can actually see:

| Where | What happens |
| --- | --- |
| An app is serving on <http://localhost:3000> | The script posts to that app's dev-only `POST /api/seed` and the app writes the fixtures from inside the process that owns the connection — the only way rows reach the browser when the database is the in-memory one |
| Nothing is listening | The script applies the migrations and loads the same fixtures from its own process — the CI and deployed case |

Both paths run one loader, so they cannot drift into two fixture sets. An app that answers and
*refuses* is an error, never a quiet fallback to the other path: in the embedded case the two
write different databases, so falling back would report a success no screen could show. The route
requires the `x-tabs-seed: 1` header that the script sends — a custom header is enough to make a
cross-site `POST` preflighted, and the app answers no preflight, so a page you happen to have open
cannot reset your fixtures behind your back.

### What it writes

Three accounts, one password between them:

| Email | Name |
| --- | --- |
| `ada@tabs.test` | Ada |
| `bo@tabs.test` | Bo |
| `cy@tabs.test` | Cy |

**Password `tabs-demo-password`.** The domain is reserved for testing, so no address here can
belong to a person. These are the credentials the pipeline's QA runs use.

Then two groups:

- **Goa trip** — Ada, Bo and Cy, plus a seat held for "Dee", who has no account. One expense of
  every split type (equal, exact, percentage, shares), one with two payers, and a settle-up
  payment. The equal expense is deliberately one that does not divide evenly, so the rounding rule
  is visible in the balances.
- **Flat 4B** — Ada and Bo, one expense and one payment, so there is a second group for the
  cross-group feed to span.

Every one of those rows writes its activity row too, on a fixed schedule that runs oldest-first.
Both feeds therefore read chronologically and identically on every run — nothing here is stamped
with the clock.

`sdlc:seed` prints the counts, the three addresses and the password when it finishes.

## Deploying to Vercel

The repository is not connected yet; the first deploy needs a person to do this once, from scratch:

1. **Import the repository** into Vercel. It builds with the default Next.js settings — no custom
   build command, no build-time environment.
2. **Add Neon from the project's Storage tab.** Vercel creates the database and sets `DATABASE_URL`
   for you. Paste the **pooled** connection string (the host with `-pooler` in it) if you set it by
   hand: runtime queries go through a WebSocket `Pool`, and a direct or malformed URL fails at the
   first query with a connection error rather than a named missing secret. Vercel's integration
   already sets the pooled one.
3. **Set `SESSION_SECRET`** to a long random value (`openssl rand -base64 32`). Use the same value
   across deploys; changing it invalidates existing sessions.
4. **Deploy.** The first boot applies the migrations and `/api/health` turns `200` once it has.
   Nothing else has to be run: a deploy migrates its own database, on the instance that then
   serves traffic.
5. **Prove it rather than assume it.** `curl -fsS https://<your-deployment>/api/health` must print
   `{"status":"ok",...}`. A `503` means the database is unreachable or the migrations did not reach
   that instance — read the build log before retrying.
6. **Check the remote driver itself** with the smoke script below, which is the one thing a
   deployment cannot demonstrate from the outside.

Push to `main` deploys to production; every pull request gets a preview deployment. The seed is
refused on both — it is a development tool, and a preview deployment is still a deployment.

Before trusting a fresh database, run the manual smoke check against it:

```sh
DATABASE_URL='postgres://…-pooler…' npm run neon:smoke
```

It applies the migrations, then proves the one thing the embedded backend cannot: that a transaction
through the real remote driver rolls back and leaves nothing behind. CI never runs it — CI has no
remote database — which is exactly why it is a command you run by hand.
