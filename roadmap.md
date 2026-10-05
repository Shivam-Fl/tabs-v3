# Roadmap (survey 2026-10-05)

Rebuilt from what is actually open: issues #1, #7, #8, #21; PRs #22, #23;
recently closed #3, #4, #5, #6 (+ follow-ups #10, #13, #15, #18). No
untrusted entries. Previous roadmap was absent (first run), so this starts
from the repo as it stands.

## Shipped

What a user can do now that they could not before:

- Boot the app with one command on an embedded database and prove it is
  alive via the health endpoint (#3).
- Sign up, sign in and sign out with email and password; keep a profile
  with display name and default currency (#4).
- Create groups with a currency and type, invite by link (disable/rotate),
  add placeholder members and claim them on join, rename/remove/archive as
  owner; removal and leave are blocked by a non-zero balance (#5).
- Record expenses with description, amount, date, one or many payers, all
  four split types with validation naming the shortfall and its size,
  remainder to the first payer, member/category filter and description
  search, newest first; edit and delete commit atomically with their
  activity rows (#6).

## In flight

- #7 Balances with simplified debts and settle-up payments — PR #22 open
  (`sdlc/issue-7`), labelled `sdlc:qa`. The group page currently shows a
  balance-banner shell and the home page a settled placeholder; the real
  recompute path, simplification and payment ledger are the PR's work.
- #21 Follow-ups from #6: 8 from the review — PR #23 open, labelled
  `sdlc:qa`. Small review-hygiene batch (shared style constants,
  ConfirmStep reuse, no-change edit notice, parseValue dedup, page-shell
  dedup, floorDivide comment, generative-split coverage). Neither PR has
  sat long enough to call stalled.

## Next

1. Land #7, then start #8 (Activity feeds with seed data and deploy
   guide). Reason: #8 is the last slice of the epic — it consumes the
   expense/payment/member rows #6 and #7 produce, and it delivers the two
   things needed to call the product done: the seed QA logs in with and
   the README path that deploys it from scratch.
2. Land #21 alongside. Reason: it is independent of #7/#8 and stops the
   copy-pasted style constants and one-off confirm from spreading into the
   balances and activity screens being built now.

## Blocked, and on whom

- #8 is blocked on #7 (`Depends on #7` in its body; the pipeline parks it
  until #7 closes). On the pipeline, not on a person.
- The first production deploy is blocked on a person: per the README, the
  repo is not connected yet — someone must import it into Vercel, add Neon
  from the Storage tab (pooled URL), set `SESSION_SECRET`, and run the
  manual Neon smoke check. Until then every proof is local-only (PGlite).
- The `project.md` open questions (QA auth mode, default currency,
  who connects Vercel) are still unanswered but block nothing currently
  in flight.

## Epics

- #1 Build Tabs from the spec (docs/spec/tabs.md) — in flight (slices #3,
  #4, #5, #6 closed; #7 in review; #8 waiting on #7; follow-up #21 in
  review). No dependencies.

## Survey notes

No new issues filed. The ledger work (#7), the audit/operability slice
(#8) and the review follow-ups (#21) already cover every gap this survey
found: the seed stub says so itself in `scripts/seed.ts`, the balance
shells say so in `app/page.tsx` and `app/groups/[id]/page.tsx`, and the
feed UI is tracked by #8's acceptance criteria. `patterns/` is empty
(no recurrence to abstract), and no doc drift beyond what open tickets
own was found. Filing more now would be noise.
