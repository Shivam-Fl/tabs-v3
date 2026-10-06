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
- An action that succeeds by changing the page redirects with a notice query param rendered in one role=status slot per panel; inline action state is for refusals only (ADR-0008 — the one recorded exception is the profile island, whose success never unmounts its form).
- Every form that acts gets a pending/double-submit guard: isPending in an auth island, a useFormStatus button island on a plain server form (ProfileSaveButton, PR #14). A bare server form submits twice on a double-click.
- Destructive flows confirm by naming their object through the shared ConfirmStep; rename deliberately does not — save-then-note. The AC that demanded a rename confirm was the defect, amended in PR #16.
- A control whose value must survive submission is never `disabled` — disabled inputs contribute nothing to the FormData, so the number typed beside an excluded member was silently stored as null and reopened blank (PR #43 BUG-1). Dim it `readOnly` + `aria-disabled`, and keep the dimming class conditional rather than a `disabled:` variant, which stops firing.
- After a refused submit every control shows what the user submitted, not what was saved — bait the
  refusal path with off-default values; a control seeded from the saved prop repaints it
  (patterns/refusal-redraws-the-form-from-saved-props.md).
- Names are unbreakable up to 80 chars (`GROUP_NAME_MAX`/`PLACEHOLDER_NAME_MAX`): sentences and
  headings that interpolate one wrap with `break-words`, adding `min-w-0` at each level of a flex
  chain — overflow-wrap cannot lower a flex item's min-content floor; list rows keep `truncate`
  plus the full value in `title`. Measure at 375px and fix the widest element, not the obvious one:
  notices get blamed while the h1 or breadcrumb usually sets the width (issue #49's replan,
  PRs #49/#54).

## Added by review and QA
The rules above from "A refusal sentence renders exactly once" down were review-enforced on
2026-10-05/06 (PRs #12–#54 diffusely; evidence per rule in its parenthesis) and now live in Rules
so nothing is stated twice. Follow-ups in flight when this was written: #55 (the long-name family
on the join page, expense screen and ConfirmStep) and the group page's stale-param-notices.
