# List order is random between identical runs

**Symptom.** A list claimed to be newest-first comes back in a different order on every
identical run. QA created alpha, beta, gamma the same way three times and got gamma-first,
alpha-first, then beta-first (PR #20 BUG-3, issue #6).

**Cause.** The order's tiebreak was `desc(id)`, and the primary key is `gen_random_uuid()` —
a random v4 uuid, so the tiebreak was random. The tie is not an edge case: the expense editor
defaults the date to today, so every expense entered without touching the date shares one
date, and the tie decides the whole order the user sees.

**How it was found.** Not by one failing run — by the same repro against fresh data giving a
different answer three times, which is also why it reads as flakiness rather than a bug.

**Fix in the code.** `lib/expenses/queries.ts` orders `desc(date), desc(createdAt), desc(id)`:
creation time is the same-day tiebreak, the uuid only makes the order total. The
`(group_id, date, id)` index is untouched, so same-day rows sort in memory — bounded by one
group's expenses on one day.

**Quick check.** Any `orderBy` whose final key is a uuid column orders tied rows at random.
Ask what the tie is, and whether the editor's defaults make the tie the common case.
