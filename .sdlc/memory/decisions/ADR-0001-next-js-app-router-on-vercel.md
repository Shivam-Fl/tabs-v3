# ADR-0001: Next.js App Router on Vercel

**Date:** 2026-10-04
**Status:** accepted
**Forced by:** #1

## Decision
Build one TypeScript Next.js 16 (App Router, React 19) application and deploy it on Vercel; no other runtime, no long-running process, no local disk that outlives a request.

## Why
The spec mandates TypeScript, one Next.js App Router app on Vercel with serverless-only execution. Next.js 16 (React 19, Turbopack) is the current stable line and App Router is the only recommended router for new projects; pinning one concrete version stops twenty tickets each guessing.

## Consequences
Easy: Vercel previews per PR, Server Components/Actions with no separate API server, one deploy target. Hard: everything must tolerate serverless (no local disk, short execution), and all DB access must be lazy so builds never need a live database.
