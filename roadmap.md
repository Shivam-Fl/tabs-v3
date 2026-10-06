# Roadmap (survey 2026-10-06)

Rebuilt from what is actually open: issues #24, #31, #35, #49, #52;
PRs #46, #53; recently closed #33, #34, #36, #37, #38, #39, #41, #47, #50
(+ earlier v1 slices #3–#8 with follow-ups #10, #13, #15, #18, #21, #26, #29).
No untrusted entries. Under the recorded decisions on #31/#35
(replan-project by @Shivam-Fl): UI redesign only — stack, data model, money
rules, TRs and every other decision stay exactly as they are, and docs/ui.md
is approved as written; and the replan on #49 (fix the width where it comes
from — headings/breadcrumbs, not the notices; acceptance criteria stand).

## Shipped

What a user can do now that they could not before:

- Use one consistent app shell on every signed-in page (Tabs mark to Home,
  current place, account menu with Profile and Sign out), with a way back
  from every nested page; signing in lands on Home, and no developer
  artefacts are linked or shown anywhere.
- Read a real landing page that explains Tabs and leads to sign up / sign in.
- See Home as a balance summary with the key number as hero, people owed /
  owing with avatars, and groups as rich rows with the primary action obvious.
- Edit expenses amount-first with sensible defaults (paid by me, split
  equally), a segmented split-type control with live per-member shares,
  multi-payer inputs revealed only when needed, styled controls, sticky save
  and cancel; settle up from a sheet with the suggested amount prefilled and
  editable; row actions in an overflow menu with destructive choices
  confirming by name.
- Manage members, read per-group and cross-group activity, and keep a profile
  with display name and default currency, with human dates carrying their
  absolute day, times in the viewer zone, zero balances neutral, direction
  always in words and colour, designed empty/loading/error states, 44px touch
  targets, keyboard, focus and reduced-motion rules holding at 375px
  and 1280px; archived groups read-only with blocked leave linking to settle.
- Retry a refused expense save quietly, with the form state kept as set.

## In flight

- #35 Group page with sections, expenses list and settings entry — PR #46
  open (`sdlc/issue-35`, ready, not draft). The last unmerged slice of #31.
- #52 Refused expense save silently resets split include switches — PR #53
  open (`sdlc/issue-52`, ready, not draft). Depends on closed #50, so
  unblocked; a retry currently resubmits a different split than the user set.
- #49 375px horizontal scroll from max-length group names — in planning, no
  PR. Depends on closed #34, so unblocked. Re-scoped by the person's replan:
  the width comes from the unbroken group name in the page headings (group
  h1, members h1 plus breadcrumbs), not the two notices; plan the fix there.
- #31 redesign epic — 6 of 7 slices closed (#33, #34, #36, #37 plus deferred
  close-outs #38, #39); #35 in review, follow-ups #49 planning and #52
  in review.
- #24 Spec coverage — open tracking issue, not work. Its S-8 row still names
  #34–#37 as in flight; actually #34, #36, #37 are built and only #35
  remains. Nothing to action from it.
- Nothing reads as stalled: #35 and #52 both have open PRs from this week,
  #49 got its scoping decision yesterday.

## Next

1. Land #35 (via PR #46), then #52 (via PR #53). Reason: both PRs are open
   and #35 is the last epic slice — merging it closes the redesign build;
   #52 rides alongside because a refused-save path that silently changes the
   split is the one follow-up that can corrupt the next retry.
2. Then #49 (max-length-name overflow at 375px). Reason: it is the last
   known viewport violation against the redesign's explicit 375px promise,
   and the implementer's measurement plus the person's replan already say
   where the fix goes — small, evidence-led, no dependencies.
3. Then nothing filed. Reason: after #35, #52 and #49 the redesign slices,
   their deferred close-outs and every known follow-up are landed; the
   deliberately-deferred items (password reset, native apps, in-app payment,
   receipts, recurring expenses, multi-currency rates, charts, email
   notifications) are eventual per the PRD, not next, so they stay out of
   the backlog.

## Blocked, and on whom

- Nothing open is labelled `sdlc:blocked` or `sdlc:needs-human`, and every
  `Depends on` points at a closed issue (#35 on closed #33; #49 on closed
  #34; #52 on closed #50) — on the pipeline, nothing waiting on a person.
- First production deploy is blocked on a person: per the README and the
  `project.md` open questions, someone must connect the repo to Vercel, add
  Neon from the Storage tab (pooled URL), set the required secrets, and run
  the manual Neon smoke check. Until then every proof is local-only
  (PGlite). The `project.md` QA-auth-mode question is still unanswered but
  blocks nothing currently in flight.

## Epics

- #31 Make Tabs look and feel like a professional, market-ready product — in flight (6 of 7 slices closed; #35 in review via PR #46; follow-ups #49 planning, #52 in review via PR #53). No dependencies.

## Survey notes

No new issues filed. The two known defects (#49 overflow, #52 include-switch
reset) already have tickets with owners and stages, the last slice (#35) is
in review, and the coverage tracker (#24) names nothing uncovered beyond the
in-flight slice. `patterns/` shows no new recurrence and no doc drift beyond
what open tickets own was found. Filing more now would be noise.
