# Technical requirements

_Generated from `project-brief.json` for #31. Edit the brief, not this file._

## Requirements

### TR-1 — Ship one TypeScript Next.js App Router application deployed on Vercel; no long-running process and no local disk that outlives a request.

**Why.** Spec hard constraint: everything runs on Vercel serverless with no durable local disk.

**Priority.** must

**Proved by.** CI builds the app and QA drives it via sdlc:serve; review rejects any disk-persisting or background-process code.

### TR-2 — With DATABASE_URL set use Neon Postgres through Drizzle's neon-serverless driver (a Pool from @neondatabase/serverless over WebSocket, pooled URL at runtime); with it unset run embedded PGlite; the same migrations apply automatically on start/deploy and user data survives redeploys and cold starts.

**Why.** Spec hard constraint: zero-setup local Postgres with production Neon, same migrations, no data loss.

**Priority.** must

**Proved by.** CI runs migrations plus seed against PGlite; the Neon smoke test runs one transaction that rolls back on error and leaves nothing behind; QA boots with DATABASE_URL unset.

### TR-3 — Every read and write of group data is authorized on the server against the session user; users see only groups they belong to and missing-or-forbidden reads are indistinguishable.

**Why.** Spec hard constraint: real accounts — group data is never public or client-trusted.

**Priority.** must

**Proved by.** QA probes cross-user and signed-out access to every group route; negative tests assert 404/401 with no data leak.

### TR-4 — All money is integer minor units end to end, never floats; every split's parts sum to the whole with the rounding remainder assigned to the first payer, covered by unit tests.

**Why.** Spec hard constraint: money is exact and the remainder rule is stated and tested.

**Priority.** must

**Proved by.** Vitest property tests over generated splits assert sum preservation and remainder placement.

### TR-5 — All secrets come from environment variables documented in the README; with nothing set the app boots on safe local defaults and logs it, while production refuses to start with a message naming the missing variable.

**Why.** Spec hard constraint: twelve-factor secrets with safe local boot and loud production failure.

**Priority.** must

**Proved by.** CI boots with a clean env and asserts the boot log; review checks every secret has a README entry and a prod guard.

### TR-6 — Email/password signup and signin with slow salted hashing, secure httpOnly session cookies, server-side session end on sign-out, rate-limited failed sign-ins, no email-enumeration in errors, and a profile with display name and default currency.

**Why.** Accounts are the trust root for every authorization check in TR-3.

**Priority.** must

**Proved by.** Unit tests for hashing/session lifecycle plus QA signup/signin/signout and rate-limit probes.

### TR-7 — Group create (name, currency, type), owner-shared join links that can be disabled/rotated, placeholder members claimable on join, owner rename/remove/archive, no removal or leave with a non-zero balance, and membership-scoped visibility.

**Why.** Groups and membership are the authorization boundary and the onboarding path for late joiners.

**Priority.** must

**Proved by.** QA drives create, invite, claim, rotate, remove-blocked-by-balance and leave flows with two test users.

### TR-8 — Expenses with description, amount, date, one or many payers (parts sum to total), all four split types with validation errors naming the shortfall and its size, remainder to first payer, member/category filter, description search, newest-first list, and member-editable with changes recorded; create, edit and delete each commit the expense, its payers, its split lines and its activity entry atomically in a single interactive transaction, never half-written.

**Why.** Expenses are the core write path and the ledger everything else derives from.

**Priority.** must

**Proved by.** Unit tests for each split type and validation math; transaction tests assert a failing write leaves no expense, payer, share or activity rows; QA adds, edits, deletes and filters expenses of every type.

### TR-9 — Per-group net balances plus simplified who-pays-whom via stated greedy min-cash-flow (at most N-1 transfers), cross-group you-owe/you-are-owed totals per person on home, full/partial settle-up payments recorded in the feed and deletable by involved members, and an explicit all-zero state.

**Why.** Balances and settle-up are the payoff: the numbers everyone must trust.

**Priority.** must

**Proved by.** Unit tests fix balances and simplification outputs on fixtures; QA settles a group to zero and checks both screens.

### TR-10 — Per-group and cross-group activity feeds recording expense added/edited/deleted, payments, and member join/leave/remove, each with actor and timestamp; an expense-edited entry stores a structured before/after of the fields that changed (description, amount, date, payers, participants, split type and inputs, category, note), written in the same transaction as the edit.

**Why.** The feed is the audit trail that makes shared money trustworthy.

**Priority.** must

**Proved by.** QA performs each event kind and asserts it appears in both the group and global feeds; QA edits an expense and asserts the feed entry carries the before/after of exactly the changed fields.

### TR-11 — Mobile-first responsive UI from the token set; one h1 and heading hierarchy, labelled controls, keyboard access and visible focus; designed empty/loading/error states; group-currency formatting; main screens interactive under 1s.

**Why.** A product people choose needs mobile-first, accessible, fast screens held to one design system — not a prototype.

**Priority.** must

**Proved by.** QA drives phone and laptop viewports with keyboard only, checks all five states per screen, and times main-screen loads.

### TR-12 — Health endpoint proving database reachability, a seed with known-password users plus every split type, a multi-payer expense, payments and a placeholder, and a README covering one-command local run and from-scratch Vercel deploy (database, env vars, migrations).

**Why.** Operability: health proof, reproducible QA data, and a deploy path a person can follow from scratch.

**Priority.** must

**Proved by.** sdlc:ready polls /api/health; QA runs the seed then logs in as a seeded user; review reads the README against a fresh clone.

## Data model

### User

Email, bcrypt hash + algorithm, display name, default currency; owns sessions and memberships

**Keys.** id (uuid), email (unique)

### Session

Opaque token hash, owning user, expiry; deleted on sign-out

**Keys.** token_hash (unique), user_id

### Group

Name, currency, type (trip/home/couple/other), invite token + enabled flag, archived flag

**Keys.** id (uuid), invite_token (unique, nullable)

### Membership

Links user (or placeholder name) to group with role owner/member and claimed state

**Keys.** (group_id, user_id) unique; placeholder rows carry display_name with null user_id until claimed

### Expense

Group, description, total minor units, date, category, note, split type (equal/exact/percentage/shares); has payers and split lines

**Keys.** id (uuid), (group_id, date, id) for newest-first listing

### ExpensePayer

Each member's part of what was paid; parts sum to the expense total

**Keys.** (expense_id, member)

### SplitLine

Each member's share owed: the input as entered (exact amount, percentage or share count, and whether they were included) beside the computed share in minor units; computed shares sum to the total and balances read only the stored payer parts and computed shares

**Keys.** (expense_id, member)

### Payment

Settle-up transfer from one member to another, full or partial; deletable by involved members

**Keys.** id (uuid), (group_id, id)

### ActivityEvent

Immutable feed rows: expense/payment/member events with actor and timestamp; expense-edited events carry a structured before/after of the fields that changed (description, amount, date, payers, participants, split type and inputs, category, note)

**Keys.** id (uuid), (group_id, created_at)

## Interfaces

### Server Actions / Route Handlers per resource

```
(sessionUser, groupScope, zod-validated input) -> { data } or { error: user-safe message }; every group-scoped call checks membership first
```

**On failure.** 401 unauthenticated; 404 when group missing OR not a member (no existence leak); 422 with shortfall named and sized

**Idempotency.** Invite-claim and expense-create are not idempotent; clients disable resubmit and the server rejects double-claim of a placeholder.

### Database layer getDb()

```
getDb(): Drizzle instance over PGlite (no DATABASE_URL) or over a neon-serverless Pool from @neondatabase/serverless over WebSocket (DATABASE_URL set); same schema and migrations either way, and expense create/edit/delete run as interactive transactions. On the Neon side getDb() opens the Pool for the request and closes it when the request's work is done, including after an error, and nothing holds a Pool or client at module scope.
```

**On failure.** 500 surfaces as a generic failure card with retry; expenses never half-write (transactional)

**Idempotency.** Migrations are versioned and re-runnable; seed is wipe-and-reload in dev only, never in production.

### GET /api/health

```
{ status: ok|degraded, db: ok|down, latencyMs } — checks database reachability with a live query; never linked from product surfaces
```

**On failure.** Health returns degraded status naming the failing check

**Idempotency.** N/A (read-only)

## Non-functional

- Main screens interactive in under 1s on an ordinary connection (server-rendered, minimal client JS)
- p95 expense-create under 400ms at single-user dev load; balances recompute in-request for groups up to 200 members
- Passwords: bcrypt cost 12; sign-in rate-limited; error messages never reveal email registration
- Sessions: httpOnly, Secure in production, SameSite=Lax cookies; server-side revocation on sign-out
