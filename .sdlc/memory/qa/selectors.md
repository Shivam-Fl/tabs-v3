# Stable selectors

What QA and the implementer walks pinned down while driving the real app on 2026-10-05
(PR #12 onward) and 2026-10-06 (PRs #43–#54 against the redesign). Each has held across at
least two independent runs, and the shared components survived PR #23's dedupe with
byte-identical markup.

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
- `?payment=recorded&from=<membershipId>&to=<membershipId>` — settle-up (PR #43): the debts
  card's notice slot renders the closed vocabulary in `lib/settle/validation.ts`
  (`paymentNoticeText`): plain "Payment recorded: X paid Y ₹N.", a partial names what is
  still to pay between them, an over-payment names the flipped direction, and a full payment
  that settles the pair says so — the pair absent from the page means settled.
- Profile's save is **inline now, not a redirect** (PR #48): a save shows "Profile saved." on
  the page with no URL param, and a refusal shows its field errors with the URL untouched.
  `?saved=1` / `?error=invalid` still render their legacy sentences on a *direct hit*
  (`profileNoticeText` in lib/auth/validation.ts) — assert the param only for direct-visit
  tests, and assert its absence after a real save.

The vocabularies live beside their actions in lib/expenses/validation.ts and
lib/groups/validation.ts; a blank or unknown value renders nothing.

## Other anchors that held
- `#invite-url` — the invite-link input; the stable way to read the link, since the Copy
  button cannot be click-proven headless.
- `#debts-heading` — the group page's debts section; the target the settle-up link in a
  balance-blocked removal/leave refusal points at (`/groups/<id>#debts-heading`).
- `#profile-displayName` / `#profile-currency` — the profile island's two fields
  (`profile-currency-error` beside the select is a field error, not a section error).
- Each settle/delete panel owns **one persistent** `p[role=status][aria-live=polite]`, mounted
  empty from first paint (`StateMessage` no longer returns null while idle). Assert these
  with `attached`, **not** `visible`: an empty live region is zero-height and reads as absent
  to Playwright's visibility check, which is exactly the false-negative that failed PR #22's
  T-12 before the fix.
- Expense-editor include switch: the label is the hit area — `min-h-11 min-w-11`, 44×44 —
  around an `h-6 w-11` visible track. Note `h-6` is **32px** here, not Tailwind's 24px: the
  repo replaces the spacing scale in `app/globals.css` (`--spacing-6: 32px`). Measure the
  track as unchanged across diffs, not as 24px (PR #51 AC-2).
- Dates: relative readings always carry their absolute half — "Today · 6 Oct" — with the
  machine-readable day still in the `<time datetime>`; assert the pair, never the bare word
  (lib/money/human-date.ts, PR #51).
- `link[rel=icon]` → `/icon.svg` — since PR #19. Before it the app fired no icon link and
  `/favicon.ico` 404'd on every page.
- `data-skeleton="…"` blocks and `aria-busy="true"` on the members `loading.tsx` fallback —
  how the streamed skeleton is asserted (it never paints locally; see environment.md).
- Destructive flows each open a confirm naming their object (shared `ConfirmStep`); rename
  deliberately does not — save-then-note. The rotate/disable/remove/archive/leave regression
  cases assert a confirm naming the object; the rename case asserts its absence.
- One `h1` per page, every control programmatically labelled, visible `:focus-visible` ring —
  what every keyboard-only drive leans on.
