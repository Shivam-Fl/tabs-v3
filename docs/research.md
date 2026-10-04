# Research

_What was learned outside this repository before the architecture was decided, and where_
_it came from. Generated from `project-brief.json` for #1._

## Questions

- What Next.js/React/Node versions are current and supported, so the stack pins a live line?
- Can Postgres run embedded with zero setup and share migrations with hosted Neon via Drizzle?
- How does the Vercel Neon integration wire DATABASE_URL (pooled vs direct) for serverless use?
- Which password hash works reliably on Vercel serverless without native bindings?
- Is an auth framework needed for email/password plus server-revocable sessions?
- Which debt-simplification algorithm is standard, and what can it honestly guarantee?
- Which Drizzle Neon driver holds interactive transactions, and what does the http driver not support?

## Findings

### Next.js 16.x (React 19, App Router, Turbopack default) is the current stable line; App Router is the recommended router for all new projects.

**What the source says.** Next.js 16 shipped Oct 2025; reports of 16.1/16.2.x/16.3.x as latest stable in 2026 with React 19.2.x; App Router described as replacing the pages router as the recommended approach for all new projects; minimum Node 20.9+.

**Source.** web search: Next.js latest stable version 2026 App Router React version

**Confidence.** 85

**Changed.** Next.js App Router on Vercel

### PGlite is a WASM build of real PostgreSQL with a first-class Drizzle driver, usable in Node with no install; the standard CI pattern is drizzle-orm/pglite for the real dialect without containers.

**What the source says.** PGlite described as PostgreSQL compiled to WASM via Emscripten in a TypeScript client library for Node/Bun/Deno with no other dependencies; Drizzle docs pattern: wrap a PGlite instance with drizzle() from drizzle-orm/pglite; drizzle-orm stable exports ./pglite and ./pglite/migrator.

**Source.** web search: PGlite embedded Postgres current version Drizzle ORM integration

**Confidence.** 90

**Changed.** Drizzle with PGlite locally and Neon in production

### Neon via Vercel Storage auto-injects a pooled DATABASE_URL for runtime plus an unpooled URL for migrations; the Drizzle Neon-HTTP pattern is the documented serverless usage.

**What the source says.** Vercel Storage -> Create Database -> Neon auto-injects DATABASE_URL (pooled) into all environments with DATABASE_URL_UNPOOLED for migrations; code pattern const sql = neon(process.env.DATABASE_URL!) and drizzle-orm/neon-http cited.

**Source.** web search: Neon Postgres Vercel Storage integration DATABASE_URL pooled connection serverless

**Confidence.** 85

**Changed.** Drizzle with PGlite locally and Neon in production

### On Vercel serverless, bcryptjs (pure JS) is recommended over native bcrypt/argon2 packages, which have documented native-binding load failures.

**What the source says.** Vercel serverless has documented native binding issues with both native bcrypt and argon2; bcryptjs avoids node-gyp entirely and is sufficient at cost factor 12; @node-rs/argon2 reported loading failures on Vercel.

**Source.** web search: password hashing Vercel serverless bcrypt argon2 recommendation 2025

**Confidence.** 80

**Changed.** bcryptjs for password hashing

### For simple email/password with server-side session control, hand-rolled sessions are simpler than Auth.js v5, which is in security-patch mode with its team pointing new projects elsewhere.

**What the source says.** Auth.js v5 described as stable since late 2024 but as of Sept 2025 in security-patch mode with the Better Auth team taking over maintenance and guidance pointing new projects to Better Auth; iron-session/Auth.js comparisons note rolling your own is simpler for simple email/password with custom sessions.

**Source.** web search: Auth.js v5 Next.js custom session cookies iron-session versus Auth.js simple email password app

**Confidence.** 75

**Changed.** Hand-rolled sessions, no auth framework

### The standard Splitwise-class simplification is greedy min-cash-flow over net balances, guaranteeing at most N-1 transfers; true minimum-transfer settlement is NP-complete so absolute minimality cannot be promised.

**What the source says.** Tutorials describe: compute net Paid-minus-Share per member, repeatedly settle max debtor against max creditor with min(abs(debt),credit), guaranteeing at most (N-1) transactions and no cycles; separate analysis reduces exact minimization to subset-sum and calls it NP-complete.

**Source.** web search: Splitwise simplify debts greedy min cash flow algorithm guarantee fewest transfers

**Confidence.** 80

**Changed.** Greedy min-cash-flow debt simplification

### Drizzle's neon-http driver cannot hold an interactive multi-statement transaction because its one-shot HTTP requests have no persistent session for BEGIN/COMMIT across awaited statements; interactive db.transaction requires the WebSocket-based neon-serverless driver (a Pool from @neondatabase/serverless).

**What the source says.** Neon's plain HTTP neon() driver does not support interactive multi-statement transactions — use the WebSocket Pool; Drizzle's own connect-to-Neon guide: if you need session or interactive transaction support, use the WebSocket-based neon-serverless driver; neon-http throws client-side where interactive db.transaction callbacks are used.

**Source.** web search: Drizzle ORM Neon serverless driver vs neon-http interactive transactions WebSocket Pool

**Confidence.** 85

**Changed.** Drizzle with PGlite locally and Neon in production

## Sources not trusted

- Stale npm registry snippets quoting old PGlite/Postgres versions — version claims taken from 2026-dated sources and the projects' own docs instead of aggregator copies.

## Assumptions this rests on

### Node 20 or newer is available wherever the pipeline builds and runs (Vercel, CI runner, QA box).

**Believed because.** Next.js 16 requires Node 20.9+; the clean CI runner ships node/npm.

**If wrong.** Builds fail immediately on every ticket until the runner or engines field is fixed; cheap to detect, blocks everything.

**Cheapest check.** First skeleton ticket runs next build on CI.

### Neon's free tier and Vercel serverless limits comfortably hold a v1 Splitwise-class workload.

**Believed because.** Spec targets friends/flatmates/trips, not high-throughput; pooled Neon URL for runtime, direct URL for migrations.

**If wrong.** Connection exhaustion or cost forces pooling config or a paid tier mid-project.

**Cheapest check.** Skeleton ticket load-smokes the health endpoint and one group flow against Neon.

### One currency per group with integer minor units covers all v1 money needs; no FX or multi-currency splits.

**Believed because.** Spec explicitly defers multiple currencies and exchange rates to later.

**If wrong.** Split math and the schema need a currency-per-expense rework; contained but touches every money ticket.

**Cheapest check.** Human gate confirms S-10 deferral stands.

### PGlite (WASM Postgres) behaves as real Postgres for this schema: plain tables, no extensions, single connection.

**Believed because.** Drizzle documents a PGlite driver and PGlite embeds PostgreSQL 18; the same migrations run on both.

**If wrong.** Migration or query incompatibilities force conditional SQL per backend; the dual-DB decision unravels.

**Cheapest check.** Skeleton ticket runs the full migration set plus seed on both backends in CI.

### The repo owner will connect the Vercel project and add Neon from the Storage tab by hand; the pipeline never provisions cloud resources.

**Believed because.** Pipeline allowlists are localhost-only and agents hold no Vercel/Neon credentials.

**If wrong.** No production deploy or preview exists and deploy tickets stall waiting on a person.

**Cheapest check.** README deploy guide names the manual steps; open question asks the owner to confirm.
