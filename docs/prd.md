# Product requirements

_Generated from `project-brief.json` for #1. Edit the brief, not this file._

## The problem

Splitting shared costs among friends, flatmates and trip groups still runs on memory, chat scrollback and spreadsheets, so someone always overpays and nobody can prove who owes whom. Tabs records who paid, how each expense splits, and the fewest payments that settle everyone up — trustworthy enough to end the argument.

## Who has it

### Friends splitting trip and everyday costs

- **When:** Weekend trips and flatshares where costs land on whoever has their card out
- **Pain:** Reconstructing who paid for what from chat history, and doing split math by hand

### Flatmates sharing rent, utilities and groceries

- **When:** One roof, recurring shared bills, roommates joining or leaving mid-lease
- **Pain:** Latecomers and leavers break informal tallies; nobody trusts the running total

## Jobs to be done

- Record what was spent, by whom, and how it splits, without spreadsheet math
- See who owes whom right now, in one group and across all groups
- Settle up with the fewest payments and have everyone trust the numbers
- Onboard latecomers: add people by name now, let them claim their share when they join
- Keep a trustworthy history of who changed what and when

## In scope

- Tabs v1 web app for shared expenses
- Skeleton, database, accounts and health first
- Groups and members second
- Expenses third
- Balances and settle-up fourth
- Activity, seed and deploy guide last

## Deliberately not doing

- Password reset and account deletion — deferred; support load is accepted for v1
- Native mobile apps — mobile web must be good enough for v1
- Paying through the app (UPI, cards) — settle-up records payments, money never moves here
- Receipt photos/scanning, recurring expenses, multi-currency groups with exchange rates, charts/reports, email notifications — all deferred, but the schema must not make them hard

## Success

- **Main screens load fast** — Home, group and expense screens interactive in under 1 second
  - measured by: Automated check in CI plus a timed QA pass over the main screens on an ordinary connection
- **Money is exact on every split** — Zero lost or invented minor units across the whole suite; parts always sum to the whole
  - measured by: Property/unit tests over generated splits plus QA spot-checks
- **A real group can settle end to end** — Create group, invite, add expenses of all four split types, simplify, settle up and read the feed with no errors
  - measured by: QA sign-up-to-settled flow on a phone-viewport browser

## Constraints

- TypeScript, one Next.js App Router app, Vercel serverless only (spec hard constraint)
- Postgres with zero local setup: Neon in production, embedded PGlite otherwise, same migrations (spec hard constraint)
- Server-side authorization on every group data access; secrets from environment only (spec hard constraints)
