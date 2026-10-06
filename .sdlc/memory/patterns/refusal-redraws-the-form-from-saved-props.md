# After a refused submit, an input shows a value the user never set

**Symptom.** A refused save turns a form control back to a value the user did not choose,
while sibling controls keep what was typed. Three instances, each costing a QA round:

- the expense editor's split include switches snap back to included after a refusal
  (description, amount and payer inclusion all persist; only the included flags and the
  category select were discarded) — PR #43 QA BUG-1, #52, fixed in PR #53;
- the profile's currency select reverts to the *saved* currency on a refused save while the
  empty name keeps its field error — PR #44 QA BUG-1;
- a settle transfer row keeps offering the *fragment just paid* (10 in the row for the
  20.00 remainder) after a successful partial payment — PR #22 QA BUG-2.

**Cause.** All three are `useActionState` islands, and the refusal re-render repaints from
whichever source the render binds to. The action on a refusal usually returns errors but not
the submitted values, so any control seeded from the *saved* prop repaints the saved value;
the ones that survived were the ones whose React state happened to still hold the typed
value. The settle case is the same shape one step over: the row's amount state is seeded once
from the suggestion and the row key (`from:to`) did not change when the suggestion shrank, so
the stale value was never replaced.

**How it was found.** Not in code review: the return values looked right and the unit tests
passed, because the divergence is client-half and this repo runs vitest in a node
environment. It took driving the forms and reading the rendered values against what was
submitted (see qa/environment.md — no DOM harness, so the walk is the evidence).

**Where it lives now.** Three fixes, one per binding shape:
- the action echoes the raw submitted values back in the state (`values`, not normalized),
  and the form is uncontrolled and keyed by defaults that prefer the echo on a refusal —
  `updateProfile` / `profileFormDefaults` (components/profile-form.tsx);
- where the render must stay controlled, an effect bumps a reducer counter once when the
  action result is an error, and that extra commit repaints the controls from the intact
  React state — `repaintAfterRefusal` (components/expense-editor.tsx). Deliberately not a key
  remount, which would drop focus;
- where per-row state is seeded from a suggestion, key the row by the value that decides the
  seed (`transferRowKey` = `from:to:amountMinor`), so the row that changed remounts and the
  row a refusal is about does not (components/settle-panels.tsx).

**Quick check.** Submit each form with one field invalid and everything else deliberately
set off-default: every control on the refused render should read what was submitted, not
what was saved. A success-path test cannot catch this; the refusal path is the whole bug.
