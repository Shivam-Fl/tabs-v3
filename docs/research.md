# Research

_What was learned outside this repository before the architecture was decided, and where_
_it came from. Generated from `project-brief.json` for #31._

## Questions

- What Next.js/React/Node versions are current and supported, so the stack pins a live line?
- Can Postgres run embedded with zero setup and share migrations with hosted Neon via Drizzle, including interactive transactions?
- How does the Vercel Neon integration wire DATABASE_URL (pooled vs direct) for serverless use?
- Which password hash works reliably on Vercel serverless without native bindings?
- Is an auth framework needed for email/password plus server-revocable sessions?
- Which debt-simplification algorithm is standard, and what can it honestly guarantee?
- Which single icon set and font-loading path fit a Next.js App Router app with no runtime font fetch and a tree-shakeable icon bundle?

## Findings

### Next.js 16.x with React 19 is the current stable line; App Router is the recommended router for all new projects.

**What the source says.** Next.js 16 shipped Oct 2025 with 16.1/16.2.x/16.3.x reported as latest stable in 2026 with React 19.2.x; App Router described as replacing the pages router as the recommended approach for all new projects; minimum Node 20.9+.

**Source.** web search: Next.js latest stable version 2026 App Router React version

**Confidence.** 85

**Changed.** ADR-0001: Next.js App Router on Vercel

### PGlite is a WASM build of real PostgreSQL with a first-class Drizzle driver, usable in Node with no install.

**What the source says.** PGlite described as PostgreSQL compiled to WASM via Emscripten in a TypeScript client library for Node/Bun/Deno with no other dependencies; Drizzle docs pattern wraps a PGlite instance with drizzle() from drizzle-orm/pglite.

**Source.** web search: PGlite embedded Postgres current version Drizzle ORM integration

**Confidence.** 90

**Changed.** ADR-0002: Drizzle with PGlite locally and Neon in production

### Neon via Vercel Storage auto-injects a pooled DATABASE_URL for runtime plus an unpooled URL for migrations; the Neon side must use the neon-serverless WebSocket driver, not the http driver, to hold interactive transactions.

**What the source says.** Vercel Storage -> Create Database -> Neon auto-injects pooled DATABASE_URL with DATABASE_URL_UNPOOLED for migrations; Drizzle neon-http is one-shot requests with no persistent session, so it cannot run interactive multi-statement transactions.

**Source.** web search: Neon Postgres Vercel Storage integration DATABASE_URL pooled connection serverless

**Confidence.** 85

**Changed.** ADR-0002: Drizzle with PGlite locally and Neon in production

### On Vercel serverless, bcryptjs (pure JS) is recommended over native bcrypt/argon2 packages, which have documented native-binding load failures.

**What the source says.** Vercel serverless has documented native binding issues with both native bcrypt and argon2; bcryptjs avoids node-gyp entirely and is sufficient at cost factor 12.

**Source.** web search: password hashing Vercel serverless bcrypt argon2 recommendation 2025

**Confidence.** 80

**Changed.** ADR-0004: bcryptjs for password hashing

### For simple email/password with server-side session control, hand-rolled sessions are simpler than Auth.js v5, which is in security-patch mode with its team pointing new projects elsewhere.

**What the source says.** Auth.js v5 described as stable since late 2024 but as of Sept 2025 in security-patch mode with maintenance moving to the Better Auth team and guidance pointing new projects at Better Auth.

**Source.** web search: Auth.js v5 maintenance status Better Auth recommendation 2025

**Confidence.** 80

**Changed.** ADR-0003: Hand-rolled sessions, no auth framework

### Greedy min-cash-flow over net balances is the standard stated algorithm for Splitwise-class settlement, guaranteeing at most N-1 transfers.

**What the source says.** Minimum-transfer settlement reduces to subset-sum (NP-complete); the documented standard approach settles the max debtor against the max creditor iteratively, which empties at least one balance per transfer and therefore uses at most N-1 transfers.

**Source.** first-party: docs/spec/tabs.md Balances section plus algorithm literature cited in ADR-0005

**Confidence.** 85

**Changed.** ADR-0005: Greedy min-cash-flow debt simplification

### lucide-react is an actively maintained, tree-shakeable icon set and the default icon dependency for Next.js starter stacks in 2026.

**What the source says.** lucide-react 1.x releases reported through 2026 (1.24.0, 1.26.0, 1.43/1.44.0); documented as tree-shakeable at roughly 2KB per icon, the default for shadcn/ui Next.js starters, installed via npm install lucide-react.

**Source.** web search: lucide-react icon set Next.js dependency maintained 2026

**Confidence.** 85

**Changed.** ADR-0009: UI-only redesign to a complete design system

### next/font self-hosts Inter at build time with no runtime fetch and no layout shift, and Tailwind v4 expresses the whole theme as CSS-first design tokens.

**What the source says.** next/font loads the body font at build time with automatic self-hosting and zero layout shift; Tailwind v4 defines theme values as CSS custom properties consumed directly by utilities, which is the documented path for a token-driven theme.

**Source.** web search: next/font Inter self-hosting Tailwind v4 CSS-first theme tokens

**Confidence.** 90

**Changed.** ADR-0009: UI-only redesign to a complete design system

## Sources not trusted

- Tutorial posts recommending the Drizzle neon-http driver for all serverless use: rejected because one-shot HTTP requests cannot hold the interactive transactions TR-8 requires.
- Forum advice to mix emoji glyphs or inline SVGs for icons: rejected because a product needs one consistent stroke width and tree-shaking, which is what lucide-react provides.

## Assumptions this rests on

### Vercel plus Neon remain available with the Storage-tab integration that auto-injects a pooled DATABASE_URL.

**Believed because.** Neon/Vercel documented integration; the repo is already deployed this way.

**If wrong.** Production database wiring must be redesigned; local, CI and QA on PGlite are unaffected.

**Cheapest check.** First production deploy connects Vercel, adds Neon, and sets secrets per the README.

### One currency per group is sufficient for v1; no exchange rates are ever needed.

**Believed because.** Spec hard constraint: multi-currency groups are explicitly not in this version.

**If wrong.** Money math, formatting and the balance derivation all assume a single group currency and would need a rates model.

**Cheapest check.** No issue before v1 asks for a second currency in one group.

### QA keeps booting the app locally via compose on localhost:3000 with PGlite, not against Vercel previews.

**Believed because.** .sdlc/config.yml env.mode is compose with a localhost-only allowlist.

**If wrong.** The sdlc:serve target and seed strategy would need to change to drive remote previews.

**Cheapest check.** Next QA run boots via npm run sdlc:serve and drives http://localhost:3000.

### Inter can be bundled at build time via next/font with no runtime fetch to Google Fonts.

**Believed because.** next/font self-hosts font files at build time; the standard pattern for offline-safe builds.

**If wrong.** First build with the font wired in fails or flashes unstyled text, and the theme falls back to the system stack.

**Cheapest check.** CI build with next/font/Inter passes and QA screenshots show Inter, not fallback.

### lucide-react stays actively maintained as the single icon dependency for the life of v1.

**Believed because.** Web research in 2026 shows active 1.x releases and default adoption in Next.js starter stacks.

**If wrong.** Icons freeze on the last published version; replacement means swapping one dependency, not redesigning screens.

**Cheapest check.** npm audit / version check during each dependency pass.
