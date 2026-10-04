# ADR-0006: npm sdlc verbs with production-shaped targets

**Date:** 2026-10-04
**Status:** accepted
**Forced by:** #1

## Decision
The four verbs are npm scripts with production-shaped targets: verify installs then typechecks, unit-tests and builds; serve builds then starts on 3000; seed runs the seed script; ready curls /api/health. All four start as stubs until the code they run exists.

## Why
.sdlc/config.yml on a fresh repo calls npm run sdlc:verify and npm run sdlc:serve, so npm scripts are the contract regardless of stack. A clean CI runner has only node/npm and python3, so verify must install its own toolchain (npm ci) before typecheck, unit tests and build; QA boots compose locally and polls readiness, so serve must boot a production build and ready must hit the DB-checking health endpoint.

## Consequences
Easy: no config edit needed for the pipeline to drive any ticket; verify fails loudly while code exists and the verb is still a stub. Hard: serve does a full build first, so QA boot is minutes not seconds — accepted for testing what ships.
