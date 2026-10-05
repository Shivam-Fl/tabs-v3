# UI

_Generated from `project-brief.json` for #31. Every ticket follows this rather
than inventing its own — five screens each inventing their own spacing is how one product
ends up looking like five._

## Theme

| token | value | used for |
|---|---|---|
| `--color-ink` | `#1A1D21` | Primary text, amounts (neutral 900) |
| `--color-ink-muted` | `#5F6570` | Secondary text, metadata; must still meet 4.5:1 on its surface (neutral 600) |
| `--color-ink-subtle` | `#8A919C` | Placeholders, disabled text, icons at rest (neutral 400) |
| `--color-border` | `#E3E5E8` | Hairline borders, dividers (neutral 200) |
| `--color-bg` | `#FAFAF8` | Page background (neutral 50) |
| `--color-surface-sunken` | `#F1F2F4` | Input fill, table stripes, recessed areas (neutral 100) |
| `--color-surface` | `#FFFFFF` | Cards, sheets, dialogs |
| `--color-accent` | `#0E6B4F` | Primary button fill, links, focus ring, selected tab — and almost nothing else |
| `--color-accent-hover` | `#0A5A42` | Primary button hover/active |
| `--color-accent-contrast` | `#FFFFFF` | Text and icons on the accent fill |
| `--color-accent-tint` | `rgba(14, 107, 79, 0.10)` | Selected-tab and highlighted backgrounds (accent at 10%) |
| `--color-owed` | `#B3261E` | Debt amounts and owe indicators, always paired with words |
| `--color-owed-tint` | `rgba(179, 38, 30, 0.10)` | Debt banner backgrounds (owed at 10%) with full-colour text |
| `--color-lent` | `#0E6B4F` | Credit amounts and owed-to-you indicators, always paired with words |
| `--color-lent-tint` | `rgba(14, 107, 79, 0.10)` | Credit/settled banner backgrounds (lent at 10%) with full-colour text |
| `--color-danger` | `#B3261E` | Destructive actions and errors only (shares its value with owed by role, never by alias) |
| `--color-danger-tint` | `rgba(179, 38, 30, 0.10)` | Error banner backgrounds (danger at 10%) with full-colour text |
| `--text-caption` | `12px / 16px` | Eyebrow labels, badge text (uppercase only with tracking-wide, muted colour) |
| `--text-secondary` | `14px / 20px` | Metadata, hints, secondary lines |
| `--text-body` | `16px / 24px` | Body copy, form values |
| `--text-lead` | `18px / 28px` | Lead paragraphs, emphasised lines |
| `--text-section` | `20px / 28px` | Section titles (h2) |
| `--text-page` | `24px / 32px` | Page titles (one h1 per page) |
| `--text-hero` | `30px / 36px` | Key balance on a screen — the largest text on it |
| `--space-1` | `4px` | Tightest inset gaps |
| `--space-2` | `8px` | Inline gaps, icon padding |
| `--space-3` | `12px` | Card padding tight, field gaps |
| `--space-4` | `16px` | Card padding, gutters, row padding |
| `--space-5` | `24px` | Section padding, card groups |
| `--space-6` | `32px` | Between sections on a page |
| `--space-7` | `48px` | Between major page blocks (extended for layouts) |
| `--space-8` | `64px` | Page-level separation, hero breathing room (extended for layouts) |
| `--radius` | `10px` | Cards, inputs, buttons |
| `--radius-full` | `9999px` | Avatars, pills, badges |
| `--shadow-sm` | `0 1px 2px rgba(16, 24, 40, 0.06)` | Cards: hairline border plus this soft shadow; nothing else floats at this level |
| `--shadow-md` | `0 8px 24px rgba(16, 24, 40, 0.12)` | Menus, dialogs, sheets, toasts |
| `--font-body` | `Inter, system-ui, sans-serif` | All UI text: Inter loaded with next/font (system-ui fallback, no flash, no layout shift); tabular-nums for every amount; weights 400 body, 500 labels/buttons, 600 headings/amounts; currency symbol the same size as the number, never superscript |

**Typography.** One scale used everywhere (12/16 caption, 14/20 secondary, 16/24 body, 18/28 lead, 20/28 section title, 24/32 page title, 30/36 hero number) with weights 400 body, 500 labels and buttons, 600 headings and amounts; never 300 for text. Page title is one h1 per page at 24/32 semibold, section titles h2 at 20/28, eyebrows 12/16 uppercase tracking-wide muted. Money is always tabular-nums with the key balance largest on screen; line length 60-75 characters for paragraphs; long names truncate with ellipsis and title, never wrapping a row into three lines.

**Density.** Comfortable touch targets (minimum 44px) for mobile-first use. Page shell: slim top bar, content in a centred column — 640px for forms and detail pages, up to 1024px for lists with an optional side panel on desktop; on phones the column is full-width with a 16px gutter. Inside a component use the small spacing steps; between sections use the largest; consistent vertical rhythm matters more than any single value.

**Motion.** Subtle only: 150ms ease on toasts and disclosures; honour prefers-reduced-motion by disabling all animation.

**Dark mode.** No dedicated dark mode in v1; tokens are chosen to pass contrast on light surfaces, and a dark inversion is explicitly deferred so no ticket invents one ad hoc.

## Patterns

### App shell and navigation

One app shell on every signed-in page: slim top bar with the Tabs mark (links Home), the current place (group name), and an account menu (avatar opens Profile and Sign out). Every nested page has a back link or breadcrumb (Group to Expense, Group to Members, Home to Group); never a dead end. Signing in lands on Home. Nothing important hides behind a hamburger on phones; no developer artefacts (health links, raw ids, ISO dates, UTC timestamps) anywhere in the product.

### Buttons

Four variants built once and reused: primary (accent fill), secondary (surface + border), ghost (text only), destructive (danger). Two sizes, 36px and 44px tall (44px for touch). Every button has hover, focus-visible ring, active, disabled and pending (spinner or Saving plus disabled) states. Labels are verbs: Add expense, Settle up, Record payment, Save. Double-submit is structurally impossible via pending guards.

### Inputs including money inputs

Visible label above, optional hint below, error below in danger colour with an icon; 44px tall on touch, sunken fill or white with border, accent ring on focus. Money inputs are right-aligned tabular figures with the group currency prefix inside the field and decimal input mode; the expense amount is large and autofocused. Placeholders are examples, never labels. Nothing default-browser: selects, date inputs, checkboxes and radios are all styled to match.

### Segmented control

Used for split type and feed filters; one clear selected state, arrow-key movement between options, full keyboard operability.

### List rows

Avatar or icon left, title plus metadata stacked middle, amount right-aligned and coloured by direction with words alongside; the whole row is the hit target with hover/pressed background. Row actions live in an overflow menu or the detail view, never as inline Edit/Delete buttons; destructive choices confirm.

### Cards

Surface background, 1px hairline border, shadow-sm, padding from the spacing scale, optional header with title plus action. The key balance on a screen is the largest text on it.

### Avatars

Initials on a stable colour derived from the member id; 32px in rows, 40px in headers; always aria-hidden with the name beside them.

### Badges

Small 12px pills for states: Settled, Placeholder, Archived, You, Owner. Never the only carrier of a state that matters.

### Dialogs and bottom sheets

Centred dialog on desktop, bottom sheet on phones; focus trapped and returned on close; destructive dialogs name the object and the consequence. Settle-up and confirms use this, not inline row forms.

### Toasts and success notices

Mutations confirm with a toast bottom-centre on phones and bottom-right on desktop, auto-dismissed, aria-live polite, with the affected number updated in place. Success across navigation rides the ADR-0008 redirect notice param rendered in one role=status slot per panel; inline action state is for refusals only, rendered exactly once.

### Skeletons

Loading shows grey blocks shaped like the real content; never a page-wide spinner and never layout shift when data arrives.

### Empty states

A simple illustration or icon, one sentence on what goes here, and the primary action that starts it; never a blank page.

### Errors

User-safe message plus one recovery action (retry or back); technical detail goes to server logs; 404 never distinguishes missing from forbidden. Failed saves never clear what the person typed.

### Forms and validation

Ask for the important thing first with sensible defaults already chosen (paid by me, split equally); progressive disclosure reveals multi-payer parts and per-member inputs only when needed, with live computed shares. Validate on blur and on submit; the summary line names the shortfall and its size. Every form has a clear way out (Cancel/back, sticky bottom primary on phones) and submits with Enter where safe.

### Destructive actions

Delete expense or payment, remove member, archive group, rotate or disable invite all confirm in a dialog or sheet naming the object and the consequence. Removal blocked by a non-zero balance says so and points at settle-up. Rename saves without a confirm.

### Money display and direction

All amounts render in the group currency with the correct symbol and separators from one formatter; raw minor units and floats never appear. Direction is words plus colour, never colour alone. Zero is neutral (All settled up), never debt red. Dates read as people say them; times render in the viewer zone.

### Icons

One set only: lucide-react (npm dependency), one stroke width, 16px inline and 20px in buttons, always aria-hidden next to text. No emoji as icons.

## Screens

### Landing

**Answers.** Explain Tabs to a visitor and lead to sign up or sign in.

**Regions.** Minimal marketing header (mark + Sign in) / hero (headline, one-line product story, primary Create account + secondary Sign in) / three-step how-it-works (record, split, settle) / trust line (exact money math, private groups) / footer with product links only — no developer or health links anywhere

- **ideal** — Visitor understands Tabs in seconds and reaches sign up or sign in in one click.
- **empty** — First visit: hero, three-step explainer, and primary Create account plus secondary Sign in; nothing assumes an account.
- **loading** — Not applicable: static content, no data fetching; fonts swap without layout shift via next/font.
- **partial** — Not applicable: no data fetching on this page.
- **error** — Marketing page rarely fails alone; a boot failure shows the shared failure card with retry.

**Narrow.** Single column at 375px with 16px gutters; centred column up to 1024px on desktop.

### Auth (sign in / sign up)

**Answers.** Let a legitimate user in and keep everyone else out.

**Regions.** Centred card (max 420px) on a calm page: email + password with visible labels, show/hide toggle, hint text for password rules on sign up, primary submit, links between sign-in and sign-up; signing in lands on Home, never on Profile

- **ideal** — Clean centred card, no errors, submit clearly labelled.
- **empty** — Not applicable: the form is always actionable, never data-driven.
- **loading** — Submit becomes a pending spinner with disabled state; double-submit is impossible.
- **partial** — Not applicable: no data fetching on this screen.
- **error** — One neutral message that never reveals whether an email is registered; input preserved; rate-limit refusal names the wait, not the account.

**Narrow.** Card goes full-width with 16px gutters and 44px targets; no other change.

### Home

**Answers.** Am I owed or owing, and which group needs attention?

**Regions.** App shell / balance summary card (hero number: net position, you-are-owed and you-owe totals) / people rows (per-person you-owe / owes-you with avatars) / group list as rich rows (name, member count, per-group balance, chevron) / primary Create group action

- **ideal** — Totals plus per-person and per-group balances all loaded.
- **empty** — No groups yet: illustration, one line on what Tabs does, Create-your-first-group button.
- **loading** — Skeleton summary card and group rows shaped like the real content; no layout shift when data arrives.
- **partial** — Groups that loaded render with balances; failed ones show inline retry rows, never a full-page error.
- **error** — Failed to load with retry; cached balances are never shown as current.

**Narrow.** Cards stack vertically; per-person rows collapse to two lines; create action is a header button on desktop and a thumb-reachable fixed button on phones.

### Group page

**Answers.** Who owes whom here, and what happened recently?

**Regions.** App shell with back-to-Home breadcrumb / group header (avatar-mark, name, currency badge, Settings entry) / summary card (your balance as the hero number, who-owes-whom lines, primary Add expense + secondary Settle up) / sections as tabs or segmented control: Expenses (search + member/category filters in a disclosure on phones, newest-first rows, row overflow menu for edit/delete) / Balances and settle up (simplified who-pays-whom with per-transfer Settle up opening the sheet) / Activity (recent excerpt linking to the full feed) / Members (roster excerpt linking to members); settings (rename, archive) live behind the Settings entry, never on the main scroll

- **ideal** — Summary, section content, expenses and activity excerpt all present and consistent.
- **empty** — No expenses yet: what to do first with an Add-expense button; settled banner when all balances are zero.
- **loading** — Skeleton summary card, section tabs, and three expense rows; no layout shift.
- **partial** — Loaded sections render; a failed section shows an inline retry inside its own panel without clearing the rest.
- **error** — Full-page error with retry; never a half-rendered ledger.

**Narrow.** Summary card first, then section tabs; Add expense is a header button on desktop and a fixed bottom button on phones; desktop 1024px may place the summary in a side card beside the main column.

### Expense editor

**Answers.** Record an expense correctly the first time.

**Regions.** App shell with back-to-group / amount first (large money input, group currency prefix, decimal input mode, autofocused) + description / date (styled picker, human reading) / payer area (single payer by default; Paid by several people reveals per-person parts) / split-type segmented control (equal/exact/percentage/shares) with per-member rows (avatar, name, computed share live) only for the chosen type / live remainder/sum validation line / category + note / sticky bottom bar with primary Save and Cancel; reopening shows the stored split type and each member's input exactly as entered

- **ideal** — Valid split with the sum line confirming parts equal the total; per-member shares shown live.
- **empty** — New expense: amount blank and autofocused, payer defaulting to me, split defaulting to equal among everyone.
- **loading** — Saving disables Save and shows progress (Saving plus spinner); the form never unmounts mid-save and double submit is impossible.
- **partial** — Not applicable: the form is local state, so it cannot partially load; member-list failure blocks open with an error.
- **error** — Failed save keeps all input, names the problem, offers retry; validation summary names the shortfall and its size.

**Narrow.** Single column; member rows stay full-width; sticky bottom save bar on phones.

### Settle-up flow

**Answers.** Record a payment from one member to another, in full or in part.

**Regions.** Bottom sheet on phones / centred dialog on desktop: who pays whom line, suggested amount prefilled and editable for partial payment, optional date, one Record payment confirm plus cancel; opened from Balances and settle up per-transfer Settle up buttons, never as inline forms on rows; destructive delete of a recorded payment lives in the payment detail overflow menu and confirms by naming it

- **ideal** — Suggested transfer confirmed and recorded with one confirm; feed and balances update with a toast.
- **empty** — Not applicable: the sheet always opens from a suggested transfer with a positive amount.
- **loading** — Confirm shows pending and disables; the sheet stays mounted until the redirect notice fires.
- **partial** — After a partial payment the sheet (or its confirmation) shows what remains owed between the pair.
- **error** — Failed record keeps the sheet open with all input, names the problem, offers retry.

**Narrow.** Bottom sheet on phones with thumb-reachable confirm; centred dialog on desktop.

### Members and invite

**Answers.** Who is in this group and how do new people join?

**Regions.** App shell with back-to-group / member list rows (avatar, name, You/Owner/Placeholder badges, per-member balance) with overflow menus for owner actions / invite-link panel (link with copy button, disable and rotate with confirm) / add-placeholder-by-name form / claim prompts for matching placeholders on join

- **ideal** — Members, balances and a working invite link.
- **empty** — Only the owner: prompt to share the invite link with a copy button.
- **loading** — Skeleton member rows; invite panel shows a loading button state.
- **partial** — Member list renders while invite-link fetch retries inline.
- **error** — Invite rotation failure keeps the old link active and says so; member-action failures name the balance blocker and point at settle-up.

**Narrow.** Invite panel stacks above the member list on phones.

### Activity

**Answers.** What changed, who changed it, and when?

**Regions.** App shell with back context / filter segmented control or scroll chip row (all/expenses/payments/members) / chronological event rows (actor avatar, plain-sentence action, relative-then-human timestamp in the viewer zone, link-through); expense-edited entries summarise the before/after of exactly the changed fields

- **ideal** — Chronological events with actor, human-readable time, and link-through to the expense or group.
- **empty** — No activity yet: explains the feed fills as the group acts.
- **loading** — Skeleton event rows shaped like the real rows.
- **partial** — Loaded days render; failed pages show a load-more retry.
- **error** — Feed error with retry; filter selection is preserved.

**Narrow.** Filters become a horizontal scroll chip row; rows collapse to two lines.

### Profile

**Answers.** Let the user control their name and default currency.

**Regions.** App shell / single settings card: display name field, default currency select (styled), Save with pending guard; sign-out lives in the account menu, never as a red button on this page

- **ideal** — Display name and default currency shown and editable, saved with confirmation.
- **empty** — Not applicable: profile fields always render with current values.
- **loading** — Save shows pending via the shared button island; the form never unmounts mid-save.
- **partial** — Not applicable: single small form, no partial data.
- **error** — Failed save keeps all input, names the problem, offers retry via the shared failure treatment.

**Narrow.** Card goes full-width with 16px gutters; no other change.

## Accessibility

- Text contrast at least 4.5:1 for body and muted text, 3:1 for large text and icons, on every surface including tinted banners
- Every control has a programmatic label; icon-only buttons get aria-labels; icons are aria-hidden next to text
- Full keyboard path: tab order matches visual order, visible focus ring on all controls, segmented options move with arrow keys, dialogs trap and return focus
- One h1 per page with hierarchical headings; balance and feed updates announced via aria-live; success notices render in one role=status slot per panel
- Touch targets at least 44px; reduced motion disables all animation; direction is never conveyed by colour alone
