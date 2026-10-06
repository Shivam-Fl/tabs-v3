# ADR-0008: Success notices ride redirect query params

**Date:** 2026-10-05
**Status:** accepted
**Forced by:** #5 (PR #16, QA rounds 1–3), extended unchanged to expenses in #6

## Decision
A Server Action whose success changes the page redirects to that page with a notice query
param from a closed vocabulary; the page reads the param through a validator (absent, blank
or unknown → null) and renders it in one `role="status"` slot per panel. Inline
`useActionState` state is for refusals only. The param name, its values and their sentences
are constants in the validation module beside the action, so the action that writes them and
the page that reads them cannot drift.

## Why
A success message returned to the submitting form never paints when the success unmounts
that form — `revalidatePath` re-renders the tree, a remove deletes the row that held the
form, an archive unmounts the section it sat in. Three QA bugs came from that one mechanism
before the rule existed (patterns/success-note-never-renders.md).

## Rejected
- **Inline success state on the submitting form** — the bug itself: the form is gone in the
  same round-trip that succeeds.
- **Per-action status slots in shared client state** — sibling `role="status"` nodes stack
  instead of replacing (rotate-then-disable showed both notes at once); one query value is
  structurally unable to produce two.
- **Lifting the message above the re-rendered list** — fixes one screen's shape and leaves
  the stacking problem. One redirect mechanism generalized to remove, archive, leave,
  rotate, disable, claim and the expense edit unchanged.

## Consequences
Every new action that succeeds by changing the page adds its param pair to the validation
module and the page reads it back through the same validator; refusals keep returning inline
because their forms stay mounted; forged notice params render nothing, which QA pinned
(T-16 in PR #16's final round); notice copy is defined once on the server, not per component.

**One recorded exception (2026-10-06, PR #48; lib/auth/actions.ts's comment carries it):** the
profile island answers *success* inline. The ADR's rationale is that a success unmounts the
form that would have shown its message; a form island that never unmounts does not meet that
rationale, and the redirect did real damage there — it throws, so `useActionState` never left
the state a refusal had put it in, and refusal-then-fix-then-save suppressed the confirmation
the save had just earned. A stale `?saved=1` beside a later refusal is the failure mode of the
redirect shape; inline answered both. An island keeps the redirect rule only while its success
unmounts it.
