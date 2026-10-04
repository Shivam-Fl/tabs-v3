# ADR-0003: Hand-rolled sessions, no auth framework

**Date:** 2026-10-04
**Status:** accepted
**Forced by:** #1

## Decision
Hand-rolled auth: bcryptjs password hashes plus opaque random session tokens stored server-side in httpOnly cookies; no Auth.js, no third-party auth service.

## Why
The product needs only email/password plus server-revocable sessions; there is no OAuth and no external identity provider. Auth.js v5 is in security-patch mode with its own team pointing new projects at Better Auth, and its JWT strategy cannot revoke on sign-out without a denylist — while the spec requires sign-out to end the session on the server. Hand-rolled opaque tokens in a sessions table give exactly that with two dozen lines.

## Consequences
Easy: sign-out revocation is a row delete; no auth framework to track. Hard: the project owns session hygiene (expiry, rotation, cleanup) and must get cookie flags right once.
