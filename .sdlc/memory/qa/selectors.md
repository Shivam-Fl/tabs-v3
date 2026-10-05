# Stable selectors

What QA and the implementer walks pinned down while driving the real app on 2026-10-05
(PR #12 onward). Each has held across at least two independent runs, and the shared
components survived PR #23's dedupe with byte-identical markup.

## Field and section errors
Errors render through the shared `FieldError` (components/ui.tsx) with the id convention
`<thing>-error`, and the paired input carries `aria-invalid`:

- expense editor: `expense-description-error`, `expense-amount-error`, `expense-date-error`,
  `expense-category-error`, `expense-note-error`, `expense-split-type-error`,
  `expense-payers-error`, `expense-splits-error`
- groups: `group-name-error`, `group-currency-error`, `group-type-error`,
  `group-rename-error`, `placeholder-name-error`

Cross-field refusals (short payer parts, split shortfalls) land on the section anchor —
`expense-payers-error` / `expense-splits-error` — not on the page summary, so the refusal
sentence is asserted there and asserted exactly once in the page. The auth card has no
per-field ids; its one error is a plain `role="alert"`.

## Success notices are query params, not DOM state
A success that changes the page redirects with a notice value the page reads and renders in
one `role="status"` slot per panel. The assertion surface is the param plus its sentence, and
that the panel holds exactly one status node:

- `?expense=updated` / `?expense=unchanged` — group page ("Expense updated." / "Nothing to change.")
- `?claim=taken` — join page ("That seat has already been claimed.")
- `?invite=rotated` / `?invite=disabled` — members screen
- `?removed=…` / `?archived=…` / `?left=…` — members screen and home
- `?saved=1` / `?error=invalid` — profile ("Profile saved." / "Check the highlighted fields and try again.")

The vocabularies live beside their actions in lib/expenses/validation.ts and
lib/groups/validation.ts; a blank or unknown value renders nothing.

## Other anchors that held
- `#invite-url` — the invite-link input; the stable way to read the link, since the Copy
  button cannot be click-proven headless.
- `link[rel=icon]` → `/icon.svg` — since PR #19. Before it the app fired no icon link and
  `/favicon.ico` 404'd on every page.
- `data-skeleton="…"` blocks and `aria-busy="true"` on the members `loading.tsx` fallback —
  how the streamed skeleton is asserted (it never paints locally; see environment.md).
- Destructive flows each open a confirm naming their object (shared `ConfirmStep`); rename
  deliberately does not — save-then-note. The rotate/disable/remove/archive/leave regression
  cases assert a confirm naming the object; the rename case asserts its absence.
- One `h1` per page, every control programmatically labelled, visible `:focus-visible` ring —
  what every keyboard-only drive leans on.
