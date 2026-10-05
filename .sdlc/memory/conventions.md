# Conventions

Written from the project brief for #31, so every ticket starts from the same
rules. Reviews add to it as they find patterns; correct it here rather than arguing in a ticket.

## Stack
TypeScript 5, Next.js 16 (App Router) + React 19 on Node 20+, Tailwind CSS v4, Drizzle ORM, PGlite (embedded WASM Postgres) when DATABASE_URL is unset and Neon Postgres via Drizzle's neon-serverless driver (a Pool from @neondatabase/serverless over WebSocket) when DATABASE_URL is set, bcryptjs password hashing, hand-rolled DB sessions, lucide-react icons, Inter via next/font, Vitest + TypeScript typecheck

## Rules
- TypeScript strict; Server Components and Server Actions by default, 'use client' only for interactive islands
- Validate every server input with zod at the route/action boundary; user-safe errors name what is off and by how much
- Drizzle schema in lib/db/schema is the single source of truth; migrations are SQL files applied automatically on boot, never hand-edits to prod
- Money crosses module boundaries only as integer minor units; formatting happens at render time from the group currency
- Tests colocate as *.test.ts beside the lib/ module or app/ route they prove and run under Vitest; no test needs network or a real server
- No dependency that needs native bindings or a background process; anything added must work on Vercel serverless and a clean CI runner with node/npm only
- UI work uses only the design tokens in the ui section and the shared components/ set; no screen invents its own spacing, type size, colour or empty/loading/error treatment
- PRs touch one concern, describe the manual QA path, and never touch the reserved framework paths
- The verify suite is typecheck + test:ci + build (via sdlc:verify). There is no lint script and none was added on purpose — a config the repo does not have is a decision about what the checks enforce. The work-order pack's lint step is not applicable here.
- A refusal sentence renders exactly once in the page — its field/section error, or the summary, or the live region, never two of them (PR #20 BUG-1).
- An action that succeeds by changing the page redirects with a notice query param rendered in one role=status slot per panel; inline action state is for refusals only (ADR-0008).
- Every form that acts gets a pending/double-submit guard: isPending in an auth island, a useFormStatus button island on a plain server form (ProfileSaveButton, PR #14). A bare server form submits twice on a double-click.
- Destructive flows confirm by naming their object through the shared ConfirmStep; rename deliberately does not — save-then-note. The AC that demanded a rename confirm was the defect, amended in PR #16.

## Added by review and QA, 2026-10-05
Rules the reviewers and QA runs enforced more than once; the diffs in PRs #12–#23 are the evidence.
- The verify suite is typecheck + test:ci + build (via sdlc:verify). There is no lint script and none was added on purpose — a config the repo does not have is a decision about what the checks enforce. The work-order pack's lint step is not applicable here.
- A refusal sentence renders exactly once in the page — its field/section error, or the summary, or the live region, never two of them (PR #20 BUG-1).
- An action that succeeds by changing the page redirects with a notice query param rendered in one role=status slot per panel; inline action state is for refusals only (ADR-0008).
- Every form that acts gets a pending/double-submit guard: isPending in an auth island, a useFormStatus button island on a plain server form (ProfileSaveButton, PR #14). A bare server form submits twice on a double-click.
- Destructive flows confirm by naming their object through the shared ConfirmStep; rename deliberately does not — save-then-note. The AC that demanded a rename confirm was the defect, amended in PR #16.
