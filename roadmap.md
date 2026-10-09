# Roadmap (survey 2026-10-09)

Rebuilt from what is actually open: issues #24 (Spec coverage) and #63 (an alert), and no open pull requests.
Recently closed: #71, #69, #60, #67, #65, #62, #58, #55, #31 and earlier slices; nothing has closed since 2026-10-07.
No untrusted entries. Decisions on record from the earlier replans still stand:
the redesign changed UI only; stack, data model, money rules, TRs and every
other decision stay as they were, and docs/ui.md is approved as written.

## Shipped

What a user can do now that they could not before:

- Use one consistent app shell on every signed-in page (Tabs mark to Home,
  current place, account menu with Profile and Sign out), with a way back from
  every nested page; signing in lands on Home; no developer artefacts shown.
- Read a real landing page that explains Tabs and leads to sign up / sign in.
- See Home as a balance summary with the key number as hero, people owed /
  owing, and groups as rich rows with the primary action obvious.
- Open a group page with sections, an expenses list and a settings entry.
- Edit expenses amount-first with sensible defaults, a segmented split-type
  control with live per-member shares, multi-payer inputs revealed only when
  needed; settle up from a sheet with the suggested amount prefilled; row
  actions in an overflow menu with destructive choices confirming by name.
- Manage members, read per-group and cross-group activity, keep a profile with
  display name and default currency; human dates, neutral zero balances,
  direction in words and colour, designed empty/loading/error states, 44px
  touch targets, keyboard/focus/reduced-motion rules.
- Retry a refused expense save with the form state kept as set.
- Long names (group names, member and seat names, transfer lines) wrap instead
  of pushing headings, notices, confirms and the group summary past the 375px
  viewport.
- The /activity feed degrades to a scoped failed state with a retry, keeps its
  loading announcement, and no longer carries a raw group id on a failed feed.
- The whole v1 spec (accounts, groups, expenses with all split types, balances
  and settle-up, activity, seed and deploy guide) and the redesign epic #31 are
  built and closed. The review follow-up chain that ran from #35 through #71
  has fully drained.

## In flight

Nothing. No open pull request and no open issue is work: #24 is the Spec
coverage tracking issue and #63 is an alert. Nothing has sat in a stage.

## Next

1. Nothing filed. Reason: every known follow-up has landed and nothing has been
   opened or closed since the last survey. The deliberately deferred items
   (password reset, native apps, in-app payment, receipts, recurring expenses,
   multi-currency rates, charts, email notifications) are eventual per the PRD,
   not next, and writing them as epics now would be a backlog against decisions
   nobody has made.
2. If a person wants more, the first useful move is the production deploy
   below, because every proof so far is local (PGlite) and that is the largest
   unverified assumption in the project.

## Blocked, and on whom

- #63 (alert: the 100-agent-session daily ceiling was reached on 2026-10-06)
  is still open although the ceiling reset at 2026-10-07T00:00Z and the queue
  it parked has drained. A person can close it; it needs no other action. If
  the ceiling is hit again, `limits.max_agent_sessions_per_day` in
  `.sdlc/config.yml` is the knob.
- First production deploy is blocked on a person: connect the repo to Vercel,
  add Neon from the Storage tab (pooled URL), set the required secrets, run the
  manual Neon smoke check. The `project.md` QA-auth-mode question is
  unanswered but blocks nothing.

## Epics

No epic is open. #31 (professional redesign) closed with all seven slices
built; nothing is waiting on any epic.

EPIC DEPENDENCY GRAPH: none. No open epics, so no epic waits on another.

## Survey notes

No new issues filed. Spec coverage (#24): 11 sections, 8 built, 2 scope
sections that read "not started" only because they are scope not requirements
(S-1, S-11), 1 non-goal, nothing uncovered. Width overflow has now appeared
three times (#49, #60 and its follow-up #69); a ticket for a sweep test of
every screen at 375px with maximum-length names is the right response to a
fourth, not before.
