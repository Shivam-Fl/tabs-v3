# ADR-0004: bcryptjs for password hashing

**Date:** 2026-10-04
**Status:** accepted
**Forced by:** #1

## Decision
Hash passwords with bcryptjs (cost factor 12); store the algorithm with the hash so a future upgrade path stays open.

## Why
Native bcrypt and argon2 packages have documented native-binding load failures on Vercel serverless, while bcryptjs is pure JS with no node-gyp step. OWASP prefers argon2id for new systems, but a hash that fails to load in production is worse than a slightly older algorithm; bcrypt at cost 12 remains an accepted choice.

## Consequences
Easy: hashing works identically on Vercel, CI and PGlite-backed dev with zero build tooling. Hard: migrating to argon2id later means re-hashing on next sign-in; the hash column must store the algorithm identifier to allow that.
