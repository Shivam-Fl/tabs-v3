# The success message the action returned never renders

**Symptom.** Two shapes, one cause (PR #16, issue #5 — BUG-1, BUG-3, BUG-5):

- the confirmation an action definitely returns never paints: a stale placeholder claim
  silently refreshes the join page, a remove deletes the member row with no "Removed …"
  note, an archive shows the banner with no "… is archived." note;
- the opposite: two success notes show at once — after rotate-then-disable, "New invite link
  created." stayed on screen beside "Invite link disabled.".

**Cause.** `useActionState` state lives in the component that submitted, and a success
unmounts that component in the same round-trip: `revalidatePath('/')` re-renders the whole
tree, remove deletes the row that held the form, archive unmounts the settings section the
form sat in. The stacking shape is the same family one step over: each form owns its own
`role="status"` node, so nothing ever replaces the previous notice.

**How it was found.** The actions' return values looked right in code and passed the unit
tests; the messages only went missing in the browser. The diagnosis that stuck was asking
what happens to the DOM the form was sitting in, not what the action returned.

**Where it lives now.** Success redirects with a notice query param the page reads into one
`role="status"` slot per panel (ADR-0008); inline state is for refusals only, because a
refused form stays mounted. One query value per panel is what makes a later success
structurally replace an earlier one.

**Quick check.** Does the success path return state to a form whose DOM the action just
changed? Then the message is already gone.
