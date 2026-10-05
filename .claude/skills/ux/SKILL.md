---
name: ux
description: How Tabs behaves for the person using it — navigation, information architecture, flows, forms, feedback, copy, and the money-specific rules (who owes whom, settling up). Load it before planning, building, reviewing or testing any user-facing flow or screen.
---

# UX for Tabs

A person opens Tabs to answer one of three questions — *who owes whom?*, *let me add what I just
paid*, *let me settle up* — usually on a phone, often with friends waiting. Every screen should
make its main job obvious within a second and doable in as few taps as the job allows. Clever is
worse than obvious.

`docs/ui.md` lists the screens and their regions; this skill is how they should behave.

## Navigation and structure

- **One app shell on every signed-in page:** a top bar with the Tabs mark (links home), the
  current place (group name), and an account menu (avatar → Profile, Sign out). On phones the bar
  stays slim; nothing important hides behind a hamburger.
- **Every page answers "where am I and how do I get back":** a back link or breadcrumb on nested
  pages (Group → Expense, Group → Members). Never a dead end.
- **Signing in lands on Home**, the groups and balances overview — not on Profile.
- **Group page is organised, not stacked.** Summary first (your balance in this group, who owes
  whom, the one primary action), then the content split into clear sections a person can jump
  between — Expenses, Balances & settle up, Activity, Members — as tabs or a segmented control on
  phones. Group settings (rename, archive) live behind a Settings entry, not on the main scroll.
- **The primary action is always reachable:** "Add expense" is visible without scrolling on the
  group page — a header button on desktop, a fixed bottom button on phones.
- **No developer artefacts in the product:** no `/api/health` links, raw ids, ISO dates, or UTC
  timestamps shown to people.

## Forms

- Labels above fields, always visible; placeholders are examples, never the label.
- Ask for the important thing first. In the expense editor that is the **amount** (large,
  autofocused, `inputmode="decimal"`) and the description; payer and split come after, with sensible
  defaults already chosen (paid by me, split equally among everyone).
- Progressive disclosure: one payer is the default and needs no extra field; "Paid by several
  people" reveals the per-person parts. Split type is a segmented control; per-member inputs appear
  only for the chosen type, each row showing the member's avatar, name and computed share live.
- Validate on blur and on submit; show the error next to the field and a one-line summary that
  names the shortfall and its size ("Parts add up to ₹450 — ₹50 short of ₹500"). Never clear
  what the person typed when a save fails.
- Every form has a clear way out: Cancel / back, and on phones a sticky bottom bar with the primary
  button. Submit with Enter where it is safe. Disable and show progress while saving; never allow
  a double submit.
- Use the platform where it helps (date picker), but styled to match; dates read as people say
  them ("13 Jan", "Yesterday"), not `2026-01-13`.

## Feedback and state

- Every action confirms: a toast ("Expense added"), and the affected number updates in place.
  Errors say what happened and what to do, with one recovery action.
- Destructive actions (delete expense or payment, remove member, archive group, rotate invite)
  confirm in a dialog or sheet that names the object and the consequence. Row-level delete lives
  in an overflow menu or the detail view, not as a red button on every row.
- Empty states teach: what this place is for, and the button that starts it ("No expenses yet —
  add the first one").
- Loading shows the shape of the content (skeletons); long lists keep their scroll position.

## Money

- Direction must be unmistakable: "You owe Bo ₹450" / "Bo owes you ₹450" — words plus colour,
  never colour alone. Zero is neutral ("All settled up"), never red.
- The biggest number on a screen is the one the person came for (their balance).
- Settling up is a flow, not a form on every row: "Settle up" opens a sheet with who pays whom,
  the suggested amount prefilled (editable for a partial payment), and one confirm button. After a
  partial payment, show what remains.
- Amounts always in the group currency with the right symbol and separators; never raw minor units.

## Copy

Plain, short, sentence case. Buttons are verbs that say what happens ("Add expense", "Record
payment"). Explain once, at the point of need, in one line — not paragraphs above forms. Use
people's names and "you", not "member" or "user".

## Accessibility (non-negotiable)

One `h1` per page and a logical heading order; every control labelled; focus visible and in a
sensible order; dialogs trap and return focus; status changes announced (`aria-live`); touch
targets 44px; contrast 4.5:1 for text; respect reduced motion; everything works with a keyboard.

## UX checklist — before calling a flow done

1. Can a first-time user find and finish the main job without reading instructions?
2. Count the taps for: add an equal-split expense, see who owes whom, record a full settle-up.
   Each should be a handful, on a phone.
3. Is the primary action visible without scrolling on a phone?
4. Does every page have a way back, and does every state (empty, loading, error, success) say
   something useful?
5. Is any amount ambiguous about who owes whom?
6. Would this screen look at home next to a well-known fintech app? If not, what is missing?
