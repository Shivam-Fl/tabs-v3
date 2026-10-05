# Roadmap (survey 2026-10-05)

Rebuilt from what is actually open: issues #24, #31, #33, #34, #35, #36,
#37, #38, #39; PR #40; recently closed #1, #3, #4, #5, #6, #7, #8
(+ follow-ups #10, #13, #15, #18, #21, #26, #29). No untrusted entries.
Previous roadmap was `maintainer/roadmap.md`; this rebuild starts from the
repo as it stands, under the recorded decisions on #31–#37 (replan-project
by @Shivam-Fl): UI redesign only — stack, data model, money rules, TRs and
every other decision stay exactly as they are, and docs/ui.md is approved
as written.

## Shipped

What a user can do now that they could not before:

- Boot the app with one command on the embedded database and prove it is
  alive via the health endpoint.
- Sign up, sign in and sign out with email and password; keep a profile
  with display name and default currency.
- Create groups with currency and type, invite by link (disable/rotate),
  add placeholder members and claim them on join, rename/remove/archive as
  owner; removal and leave are blocked by a non-zero balance.
- Record expenses with description, amount, date, one or many payers, all
  four split types with validation naming the shortfall and its size,
  remainder to the first payer, member/category filter and description
  search, newest first; edit and delete commit atomically with activity rows.
- See per-group net balances with simplified who-pays-whom (at most N-1
  transfers), cross-group you-owe/you-are-owed totals on Home, and record
  full/partial settle-up payments that appear in the feed and settle to an
  explicit all-zero state.
- Follow per-group and cross-group activity (expense added/edited/deleted
  with structured before/after, payments, member join/leave/remove), seed
  QA data covering every split type plus a multi-payer expense, payments
  and a placeholder, and deploy from scratch via the README guide.

## In flight

- #33 Foundation, app shell, landing page and auth screens — PR #40 open
  (`sdlc/issue-33`, ready, not draft). The tokens, Inter via next/font,
  lucide-react, and the shared component set this piece defines are what
  every later slice consumes unchanged.
- #34 Home dashboard, #35 Group page, #36 Expense editor and settle-up
  sheet, #37 Members/activity/profile sweep — open, each `Depends on #33`,
  so parked until #33 closes. Neither PR nor work has started on them.
- #38 No-dev-artefacts sweep and #39 sign-in-lands-on-Home plus shell
  acceptance — deferred from #33 by its work order, labelled `sdlc:blocked`,
  each `Depends on #33`. Small close-outs of #33, not separate builds.
- #24 Spec coverage — open tracking issue, not work. It still names the
  retired epic #1 slices (#3–#8); its rows flip to the #31 slices as they
  land. Nothing to action from it.
- Nothing has sat long enough to call stalled: #33–#39 were filed today
  and PR #40 is the current review.

## Next

1. Land #33 (via PR #40), then start #34 and #35. Reason: #33 defines the
   theme, shell and component set the others consume unchanged — reviewing
   anything else first would review it against components that do not exist
   yet.
2. Then #36 (expense editor + settle-up sheet). Reason: it is the only
   slice touching the money-writing surfaces, with an explicit
   no-logic-change risk flag — it goes while review attention is free, not
   batched behind lower-risk screen work.
3. Then #37 (members, activity, profile + display/accessibility sweep).
   Reason: it is the close-out — it consumes everything above and its
   global sweep (neutral zeros, words-plus-colour, human dates, five states
   at both viewports) is the check that the redesign reads as one product.

## Blocked, and on whom

- #33 is labelled `sdlc:needs-human` — on a person, per the label. The
  recorded replan-project decisions answer the product question (UI only,
  keep docs/ui.md as approved); what the human action needs is whatever the
  label was set for, not a product decision this survey can see.
- #34, #35, #36, #37 wait on #33 (`Depends on #33` in each body) — on the
  pipeline, not on a person. They start when #33 closes.
- #38, #39 wait on #33 (deferred by its work order, `sdlc:blocked`) — on
  the pipeline. They close out #33's own acceptance lines.
- First production deploy is blocked on a person: per the README and the
  `project.md` open questions, someone must connect the repo to Vercel, add
  Neon from the Storage tab (pooled URL), set the required secrets, and run
  the manual Neon smoke check. Until then every proof is local-only
  (PGlite). The `project.md` QA-auth-mode question is still unanswered but
  blocks nothing currently in flight.

## Epics

- #31 Make Tabs look and feel like a professional, market-ready product —
  in flight (foundation #33 in review via PR #40; #34–#37 waiting on #33;
  deferred #38–#39 waiting on #33). No dependencies.

## Survey notes

No new issues filed. The redesign slices (#33–#37) plus their deferred
close-outs (#38–#39) already cover the whole UI scope in `docs/ui.md` under
the UI-only constraint, and the shipped v1 slices (#3–#8 with their
follow-ups) cover every TR. `patterns/` holds no recurrence to abstract,
and no doc drift beyond what open tickets own was found. Filing more now
would be noise.
