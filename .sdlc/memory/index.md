# Memory index

One line per entry, describing **when it applies** — an agent reads this before deciding
whether to open the entry itself.

## Always
- [project.md](project.md) — stack, layout, commands. Read before any planning.
- [conventions.md](conventions.md) — naming, errors, tests (incl. source-reading tests), PR style, and the UI rules review and QA enforced (long names, refusals, disabled inputs). Read before writing code.
- [docs/prd.md](../../docs/prd.md) — what is being built, for whom, and what deliberately is not. Read before planning a feature.
- [docs/trd.md](../../docs/trd.md) — the numbered TR- requirements an issue's `Covers:` line cites. Read before planning or reviewing.
- [docs/ui.md](../../docs/ui.md) — theme tokens, patterns and every screen's five states. Read before touching anything a user sees.

## Situational
- [qa/environment.md](qa/environment.md) — the preview lags the branch (and how to tell which build it serves), the shared signup rate budget, PGlite test timeouts, the failing Vercel check and other verify-suite noise, why skeletons and the no-JS notice are unobservable locally, agent-box sandbox quirks, per-run accounts that nothing cleans up. Read before browser QA, any walk that must see the current build, or diagnosing a red suite.
- [qa/selectors.md](qa/selectors.md) — the `<thing>-error` field-error ids, the notice query params (expenses, groups, payments, profile), `#invite-url`, `#debts-heading`, `[data-amount]`, profile and skeleton attributes, the persistent live regions, the 375px overflow read and the `h-6`=32px spacing trap. Read before writing a browser test or walking a qa_script.
- [patterns/](patterns/) — bug shapes this repo has produced before. Grep by symptom.
  - [list-order-random-between-runs.md](patterns/list-order-random-between-runs.md) — when a "newest-first" list comes back in a different order every identical run; a uuid tiebreak.
  - [success-note-never-renders.md](patterns/success-note-never-renders.md) — when an action's success message never paints, or two notes show at once; the form unmounted with the state.
  - [refusal-redraws-the-form-from-saved-props.md](patterns/refusal-redraws-the-form-from-saved-props.md) — when a refused save silently reverts a control (switch, select, amount) to a value the user never set; what each island binds its repaint to.
  - [work-order-step-that-defeats-its-own-goal.md](patterns/work-order-step-that-defeats-its-own-goal.md) — when the order's named step, applied literally, fails the same order's goal sentence (rate-limit fallback, error-message gate, a fixed-width panel that no wrapping class fixes).
- [decisions/](decisions/) — why things are as they are. Read before proposing a rewrite.
  - [ADR-0008-success-notices-ride-redirect-params.md](decisions/ADR-0008-success-notices-ride-redirect-params.md) — read before returning success state inline from an action that changes the page.
