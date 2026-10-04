# ADR-0002: Drizzle with PGlite locally and Neon in production

**Date:** 2026-10-04
**Status:** accepted
**Forced by:** #1

## Decision
Use Drizzle ORM with a getDb() switch: @electric-sql/pglite when DATABASE_URL is unset, Neon via Drizzle's neon-serverless driver (a Pool from @neondatabase/serverless over WebSocket) when DATABASE_URL is set; one SQL migration set applied automatically on boot.

## Why
The spec requires Postgres with zero local setup: Neon when DATABASE_URL is set, an embedded in-process Postgres otherwise, same migrations on both. PGlite is a WASM build of real PostgreSQL with a first-class Drizzle driver, so dev, CI and browser QA need nothing installed; Drizzle is light, serverless-safe and speaks to both backends. Prisma was rejected for its heavier engine downloads on serverless/CI and a weaker PGlite story. The http driver was rejected for the Neon side: it cannot hold an interactive transaction, and creating, editing or deleting an expense must write the expense, its payers, its shares and its activity entry atomically (TR-8: never half-written).

## Consequences
Easy: npm run dev works with nothing set; CI runs the real dialect with no containers; one migration set serves both backends; expense writes commit atomically via db.transaction. Hard: schema must stay within plain-Postgres SQL both backends accept; PGlite must never be used in production where disk is ephemeral; A WebSocket Pool must not outlive the request that uses it on serverless: getDb() on the Neon side opens the Pool for the request and closes it when the request's work is done, including after an error, and nothing holds a Pool or client at module scope, so every transaction must open, commit and close inside one request.
