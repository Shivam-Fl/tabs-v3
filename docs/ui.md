# UI

_Generated from `project-brief.json` for #1. Every ticket follows this rather
than inventing its own — five screens each inventing their own spacing is how one product
ends up looking like five._

## Theme

| token | value | used for |
|---|---|---|
| `--color-bg` | `#FAFAF8` | Page background |
| `--color-surface` | `#FFFFFF` | Cards, sheets, dialogs |
| `--color-ink` | `#1A1D21` | Primary text |
| `--color-muted` | `#5F6570` | Secondary text, placeholders |
| `--color-accent` | `#0E6B4F` | Primary actions, links, focus ring |
| `--color-danger` | `#B3261E` | Destructive actions and errors |
| `--color-owed` | `#B3261E` | Amounts you owe (debt) indicators |
| `--color-lent` | `#0E6B4F` | Amounts owed to you (credit) indicators |
| `--space-1..6` | `4px 8px 12px 16px 24px 32px` | 4/8/12/16/24/32 spacing scale; nothing else |
| `--radius` | `10px` | Cards, inputs, buttons |
| `--font-body` | `Inter, system-ui, sans-serif` | All UI text; tabular numerals for amounts |

**Typography.** Inter (system fallback) with tabular-nums for every amount; one h1 per page, section headings hierarchical; amounts semibold, body regular.

**Density.** Comfortable touch targets (min 44px) for mobile-first use; desktop caps content at 72ch/1024px with the same spacing scale.

**Motion.** Subtle only: 150ms ease on toasts and disclosures; honor prefers-reduced-motion by disabling all animation.

**Dark mode.** No dedicated dark mode in v1; tokens are chosen to pass contrast on light surfaces, and a dark inversion is explicitly deferred so no ticket invents one ad hoc.

## Patterns

### Forms and validation

Validate on submit and on blur; inline errors sit under the field and the summary line names the shortfall and its size (e.g. parts sum to 450, 50 short of 500). Failed saves never clear input.

### Empty states

Every empty screen shows what it is for, what to do next, and the button that does it — never a blank page.

### Loading states

Skeleton blocks matching the final layout; no spinners replacing whole pages and no layout shift when data arrives.

### Errors

User-safe message plus one recovery action (retry or back); technical detail goes to server logs, and 404 never distinguishes missing from forbidden.

### Destructive actions

Delete expense, delete payment, remove member, rotate/disable invite and archive group all require an explicit confirm naming the object; removal blocked by non-zero balance says so and points at settle-up.

### Money display

All amounts render in the group's currency with correct symbol and separators from one formatter; minor units are never shown raw and floats never appear.

### Toasts and feedback

Mutations confirm with a toast bottom-center on mobile / bottom-right on desktop; the affected number updates in place with an aria-live announcement.

## Screens

### Home

**Answers.** Am I owed or owing, and which group needs attention?

**Regions.** Header (app name, user menu) / totals cards (you-are-owed, you-owe) / per-person rows / group list with per-group balance / primary Create group action

- **ideal** — Totals plus per-person and per-group balances all loaded.
- **empty** — No groups yet: illustration, what Tabs does in one line, Create-your-first-group button.
- **loading** — Skeleton cards and rows, no layout shift when data arrives.
- **partial** — Groups that loaded render with balances; failed ones show inline retry rows, never a full-page error.
- **error** — Failed to load with retry; cached balances are never shown as current.

**Narrow.** Cards stack vertically; per-person rows collapse to two-line entries; create action becomes a floating button.

### Group detail

**Answers.** Who owes whom here, and what happened recently?

**Regions.** Group header (name, currency, settings) / balance banner (settled or owes-summary) / simplified-debts card with Settle-up buttons / expenses list with filter+search / recent activity excerpt

- **ideal** — Balances, debts, expenses and activity all present.
- **empty** — No expenses yet: what to do first with an Add-expense button; settled banner when all balances are zero.
- **loading** — Skeleton header, debts card and three expense rows.
- **partial** — Cached header with stale badge plus inline retry for the failed section.
- **error** — Full-page error with retry; never a half-rendered ledger.

**Narrow.** Debts card moves above expenses on narrow screens; filters collapse into a disclosure.

### Expense editor

**Answers.** Record an expense correctly the first time.

**Regions.** Amount + currency display / description + date / payer picker (single or multi with parts) / split-type tabs with per-member inputs (exact amount, percentage or share count, included or left out) / live remainder/sum validation line / category + note / Save; reopening an existing expense shows the stored split type and each member's input exactly as entered

- **ideal** — Valid split with the sum line confirming parts equal the total.
- **empty** — New expense: blank with payer defaulting to me and split defaulting to equal.
- **loading** — Saving state disables Save and shows progress; form never unmounts mid-save.
- **partial** — Not applicable: the form is local state, so it cannot partially load; member list failure blocks open with an error.
- **error** — Failed save keeps all input, names the problem, offers retry.

**Narrow.** Single column; split-type tabs become a select; member rows stay full-width.

### Members and invite

**Answers.** Who is in this group and how do new people join?

**Regions.** Member list with balances and owner badges / invite-link panel with copy, disable and rotate / placeholder add-by-name / claim prompts for matching placeholders

- **ideal** — Members, balances and a working invite link.
- **empty** — Only the owner: prompt to share the invite link with copy button.
- **loading** — Skeleton member rows; invite panel shows a loading button state.
- **partial** — Member list renders while invite-link fetch retries inline.
- **error** — Invite rotation failure keeps the old link active and says so.

**Narrow.** Invite panel stacks above the member list on narrow screens.

### Activity

**Answers.** What changed, who changed it, and when?

**Regions.** Filter (all/expenses/payments/members) / chronological event rows with actor, action and timestamp / link-through to the expense or group

- **ideal** — Chronological events with actor and time.
- **empty** — No activity yet: explains the feed fills as the group acts.
- **loading** — Skeleton event rows.
- **partial** — Loaded days render; failed pages show a load-more retry.
- **error** — Feed error with retry; filter selection is preserved.

**Narrow.** Filters become a horizontal scroll chip row; rows collapse to two lines.

### Auth (sign in / sign up)

**Answers.** Let a legitimate user in and keep everyone else out.

**Regions.** Single centered card: email + password, show/hide toggle, submit; links between sign-in, sign-up and (later) reset placeholder

- **ideal** — Clean form, no errors.
- **empty** — Not applicable: the form is always actionable, never data-driven.
- **loading** — Submit becomes a pending spinner; double-submit is impossible.
- **partial** — Not applicable: no data fetching on this screen.
- **error** — One neutral message that never reveals whether an email is registered; input preserved.

**Narrow.** Card goes full-width with comfortable touch targets; no other change.

## Accessibility

- Text contrast at least 4.5:1 for body and 3:1 for large text against surfaces
- Every control has a programmatic label; icon-only buttons get aria-labels
- Full keyboard path: tab order matches visual order, visible focus ring on all tokens, dialogs trap and return focus
- One h1 per page, hierarchical headings, and aria-live announcements for balance/feed updates after mutations
