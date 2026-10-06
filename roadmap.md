# Roadmap (survey 2026-10-06)

Rebuilt from what is actually open: issues #24, #60, #62, #63; PR #61;
recently closed #58, #55, #31, #35, #49, #52, #50, #36, #34, #47, #37 and
earlier slices. No untrusted entries. Decisions on record from the earlier
replans still stand: the redesign changed UI only — stack, data model, money
rules, TRs and every other decision stay as they were, and docs/ui.md is
approved as written.

## Shipped

What a user can do now that they could not before:

- Use one consistent app shell on every signed-in page (Tabs mark to Home,
  current place, account menu with Profile and Sign out), with a way back from
  every nested page; signing in lands on Home; no developer artefacts are shown.
- Read a real landing page that explains Tabs and leads to sign up / sign in.
- See Home as a balance summary with the key number as hero, people owed /
  owing, and groups as rich rows with the primary action obvious.
- Open a group page with sections, an expenses list and a settings entry.
- Edit expenses amount-first with sensible defaults, a segmented split-type
  control with live per-member shares, multi-payer inputs revealed only when
  needed; settle up from a sheet with the suggested amount prefilled; row
  actions in an overflow menu with destructive choices confirming by name.
- Manage members, read per-group and cross-group activity, keep a profile
  with display name and default currency; human dates, neutral zero balances,
  direction in words and colour, designed empty/loading/error states, 44px
  touch targets, keyboard/focus/reduced-motion rules.
- Retry a refused expense save with the form state kept as set (include
  switches no longer reset), and long group names no longer push headings and
  notices past the 375px viewport.
- The /activity feed degrades to a scoped failed state with a retry.
- The whole v1 spec (accounts, groups, expenses with all split types,
  balances and settle-up, activity, seed and deploy guide) and the redesign
  epic #31 are built and closed.

## In flight

- #60 Follow-ups from #55 (2 from QA: remove-member confirm and an
  80-character seat name each widen a page past 375px) — PR #61 open
  (`sdlc/issue-60`, ready, not draft), labelled `sdlc:needs-human`. The label
  is the thing to look at: the data does not say what it is waiting on.
- #62 Follow-ups from #58 (4 from the review: lost loading announcement on
  /activity, raw ?group= id carried on a failed feed, scope-line spacing,
  a comment/test that disagree) — labelled `sdlc:blocked`, no PR yet. Its
  only `Depends on` (#58) is closed, so nothing in the data explains the
  block beyond the session ceiling below.
- #63 Alert: the 100-agent-session daily ceiling was hit on 2026-10-06;
  `implement` on #60 was the first stage refused. Everything that tries to
  start parks until 2026-10-07T00:00Z and the watchdog resumes it by itself.
- #24 Spec coverage — tracking issue, not work. Its S-8 row still shows #35
  "in flight (#46)"; #35 is closed and merged, so the row is stale and will
  correct on the next rebuild. S-1 and S-11 read "not started" because they
  are scope sections, not requirements; nothing uncovered.
- Nothing has sat in a stage for days: both follow-ups were filed this
  morning.

## Next

1. Let the watchdog resume after 2026-10-07T00:00Z, and land #60 via PR #61.
   Reason: the PR is already open; it is the last known 375px viewport
   violation (member-row confirm width, balance-row long name), and the
   redesign promised 375px everywhere.
2. Then #62. Reason: the loading-announcement regression is an accessibility
   loss against docs/ui.md (status changes are announced), so it outranks the
   two cosmetic items bundled with it; the planner should drop any that no
   longer reproduce.
3. Then nothing filed. Reason: after #60 and #62 every known follow-up is
   landed; the deliberately deferred items (password reset, native apps,
   in-app payment, receipts, recurring expenses, multi-currency rates,
   charts, email notifications) are eventual per the PRD, not next.

## Blocked, and on whom

- #62 is labelled `sdlc:blocked`; #60 is labelled `sdlc:needs-human`. Both
  were parked while the day's session ceiling was reached (#63), and the
  watchdog restarts parked stages at 2026-10-07T00:00Z. If #60 or #62 is
  still labelled after that, the reason on the issue is for a person to read.
- If today's work is worth more than 100 sessions, a person must raise
  `limits.max_agent_sessions_per_day` in `.sdlc/config.yml` and
  `/sdlc retry <stage>`. Otherwise nothing is needed.
- First production deploy is blocked on a person: connect the repo to Vercel,
  add Neon from the Storage tab (pooled URL), set the required secrets, run
  the manual Neon smoke check. Until then every proof is local (PGlite). The
  `project.md` QA-auth-mode question is unanswered but blocks nothing in
  flight.

## Epics

No epic is open. #31 (professional redesign) closed with all seven slices
built; nothing is waiting on any epic.

EPIC DEPENDENCY GRAPH: none — no open epics, so no epic waits on another.

## Survey notes

No new issues filed. The two known defects classes (375px overflow, refused
save) are already owned by #60 and #62. Width overflow has now appeared twice
(#49, #60); a third would justify a ticket for a sweep test of every screen at
375px with maximum-length names, not before. The session-ceiling alert (#63)
clears on its own.
