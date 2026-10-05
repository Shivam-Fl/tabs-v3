# The work order's literal step defeats its own goal sentence

**Symptom.** Implementing the named step exactly still fails the criterion the same work
order states. Twice on 2026-10-05:

- PR #14 (issue #13): "always push an ip spec" for the rate limiter — taken literally it also
  fires for `clearRateLimit({ email })`, which calls the same `keySpecs` with no ip key, and
  would delete the shared `unknown` bucket on every successful sign-in, letting anyone with
  one valid account reset the signup gate on demand. The same order says "no change to
  clearRateLimit logic"; the two cannot both hold. The fix that kept both gated the fallback
  on the caller naming an ip (`'ip' in keys`).
- PR #20 (issue #6): gate the submit-row message "the same gate the top summary already uses"
  (no field errors) — but refusals that carry no field errors (group gone, unauthenticated,
  archived) would then render the sentence twice, against the order's own "each refusal
  sentence renders exactly once". The gate that meets the goal is broader: no message row at
  all while the state is an error.

**What the planner misread.** In #14, the helper's other callers; in #20, the page-level
wording of the criterion. Both were visible in the files the order already cited.

**How it resolved.** Both implementers followed the order's goal sentence, kept the change to
the named file, and recorded the deviation in the implementer reply rather than widening
scope. The goal sentence outranks the step; the step gets amended, not silently skipped.
