# Conventions

Written from the project brief for #1, so every ticket starts from the same
rules. Reviews add to it as they find patterns; correct it here rather than arguing in a ticket.

## Stack
TypeScript 5, Next.js 16 (App Router) + React 19 on Node 20+, Tailwind CSS v4, Drizzle ORM, PGlite (embedded WASM Postgres) when DATABASE_URL is unset and Neon Postgres via Drizzle's neon-serverless driver (a Pool from @neondatabase/serverless over WebSocket) when DATABASE_URL is set, bcryptjs password hashing, hand-rolled DB sessions, Vitest + TypeScript typecheck

## Rules
- TypeScript strict; Server Components and Server Actions by default, 'use client' only for interactive islands
- Validate every server input with zod at the route/action boundary; user-safe errors name what is off and by how much
- Drizzle schema in lib/db/schema is the single source of truth; migrations are SQL files applied automatically on boot, never hand-edits to prod
- Money crosses module boundaries only as integer minor units; formatting happens at render time from the group's currency
- Tests colocate as *.test.ts beside the lib/ module they prove and run under Vitest; no test needs network or a real server
- No dependency that needs native bindings or a background process; anything added must work on Vercel serverless and a clean CI runner with node/npm only
- PRs touch one concern, describe the manual QA path, and never touch the reserved framework paths
