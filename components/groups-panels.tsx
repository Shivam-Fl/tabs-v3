'use client';

import { MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { SUPPORTED_CURRENCIES } from '../lib/auth/validation';
import {
  addPlaceholder,
  archiveGroup,
  claimPlaceholder,
  createGroup,
  disableInvite,
  joinByToken,
  leaveGroup,
  removeMember,
  renameGroup,
  rotateInvite,
} from '../lib/groups/actions';
import {
  GROUP_NAME_MAX,
  GROUP_TYPES,
  GROUP_TYPE_LABELS,
  IDLE_GROUP_STATE,
  PLACEHOLDER_NAME_MAX,
  isBalanceBlockedRefusal,
} from '../lib/groups/validation';
import { directionWords, formatMinorUnits } from '../lib/money/format';
import {
  Avatar,
  Badge,
  Button,
  ConfirmStep,
  DANGER_BUTTON,
  FIELD_CLASSES,
  FieldError,
  INPUT_CLASSES,
  LABEL_CLASSES,
  PRIMARY_BUTTON,
  QUIET_BUTTON,
  StateMessage,
  TextInput,
} from './ui';

/**
 * The client islands of the group screens. Every page around them is a Server Component; these
 * exist for the three things a server-rendered form cannot do: keep what the user typed when a
 * submit comes back with an error, hold a two-step confirm open, and read the clipboard.
 *
 * Nothing here decides anything. The session, the membership and the input validation all live
 * on the server, so none of these islands can be talked into an action the caller may not take
 * — the worst a tampered form achieves is a refused request.
 *
 * Destructive actions (remove, leave, archive, rotate, disable) go through a confirm step that
 * names the object and stays on the page: a native dialog would be the one control a keyboard
 * user can dismiss with a stray Escape and a browser agent cannot drive reliably.
 *
 * The class strings and the three small components the forms are built from live in
 * `components/ui.tsx`, shared with the other screens' forms; what is left here is the behaviour.
 */

export function CreateGroupForm({ defaultCurrency }: { defaultCurrency: string }) {
  const [state, formAction, isPending] = useActionState(createGroup, IDLE_GROUP_STATE);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [type, setType] = useState<string>('other');

  const errors = state.fieldErrors ?? {};
  const summary = state.status === 'error' && Object.keys(errors).length === 0 ? state.message : null;

  return (
    <form
      action={formAction}
      noValidate
      onSubmit={(event) => {
        if (isPending) event.preventDefault();
      }}
      className="flex flex-col gap-4 rounded-token border border-muted/20 bg-surface p-5"
    >
      {summary ? (
        <p role="alert" className="text-sm text-danger">
          {summary}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <label className={LABEL_CLASSES} htmlFor="group-name">
          Group name
        </label>
        <input
          id="group-name"
          name="name"
          type="text"
          maxLength={GROUP_NAME_MAX}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={errors.name !== undefined}
          aria-describedby={errors.name ? 'group-name-error' : undefined}
          className={INPUT_CLASSES}
        />
        <FieldError id="group-name-error" message={errors.name} />
      </div>

      <div className="flex flex-col gap-2">
        <label className={LABEL_CLASSES} htmlFor="group-currency">
          Currency
        </label>
        <select
          id="group-currency"
          name="currency"
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          aria-invalid={errors.currency !== undefined}
          aria-describedby={errors.currency ? 'group-currency-error' : undefined}
          className={INPUT_CLASSES}
        >
          {SUPPORTED_CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        <FieldError id="group-currency-error" message={errors.currency} />
      </div>

      <div className="flex flex-col gap-2">
        <label className={LABEL_CLASSES} htmlFor="group-type">
          Type
        </label>
        <select
          id="group-type"
          name="type"
          value={type}
          onChange={(event) => setType(event.target.value)}
          aria-invalid={errors.type !== undefined}
          aria-describedby={errors.type ? 'group-type-error' : undefined}
          className={INPUT_CLASSES}
        >
          {GROUP_TYPES.map((code) => (
            <option key={code} value={code}>
              {GROUP_TYPE_LABELS[code]}
            </option>
          ))}
        </select>
        <FieldError id="group-type-error" message={errors.type} />
      </div>

      <button type="submit" disabled={isPending} aria-busy={isPending} className={PRIMARY_BUTTON}>
        {isPending ? 'Creating…' : 'Create group'}
      </button>
    </form>
  );
}

export function RenameGroupForm({ groupId, name }: { groupId: string; name: string }) {
  const [state, formAction, isPending] = useActionState(renameGroup, IDLE_GROUP_STATE);
  const [value, setValue] = useState(name);
  const errors = state.fieldErrors ?? {};

  return (
    <form
      action={formAction}
      noValidate
      onSubmit={(event) => {
        if (isPending) event.preventDefault();
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="groupId" value={groupId} />
      <div className="flex flex-col gap-2">
        <label className={LABEL_CLASSES} htmlFor="group-rename">
          Group name
        </label>
        <input
          id="group-rename"
          name="name"
          type="text"
          maxLength={GROUP_NAME_MAX}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={errors.name !== undefined}
          aria-describedby={errors.name ? 'group-rename-error' : undefined}
          className={INPUT_CLASSES}
        />
        <FieldError id="group-rename-error" message={errors.name} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={isPending} aria-busy={isPending} className={QUIET_BUTTON}>
          {isPending ? 'Saving…' : 'Save name'}
        </button>
        <StateMessage state={state} />
      </div>
    </form>
  );
}

export function AddPlaceholderForm({ groupId }: { groupId: string }) {
  const [state, formAction, isPending] = useActionState(addPlaceholder, IDLE_GROUP_STATE);
  const [value, setValue] = useState('');
  const errors = state.fieldErrors ?? {};

  // The seat is added and the field is ready for the next one; an error leaves the name put.
  useEffect(() => {
    if (state.status === 'success') setValue('');
  }, [state]);

  return (
    <form
      action={formAction}
      noValidate
      onSubmit={(event) => {
        if (isPending) event.preventDefault();
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="groupId" value={groupId} />
      {/* The field and its refusal come from the shared TextInput, so `placeholder-name-error`
          is wired to the input by the same `aria-describedby` every other form gets. */}
      <TextInput
        id="placeholder-name"
        name="displayName"
        label="Add someone by name"
        hint="For people who are in the group but have not signed up yet. They claim the seat when they open the invite link."
        type="text"
        maxLength={PLACEHOLDER_NAME_MAX}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Their name"
        error={errors.displayName}
        errorId="placeholder-name-error"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" pending={isPending} pendingLabel="Adding…">
          Add seat
        </Button>
        <StateMessage state={state} />
      </div>
    </form>
  );
}

/**
 * Writing the invite link to the clipboard, and the one sentence either outcome reads as.
 *
 * Kept as a helper rather than written twice because the panel and the solo-owner empty state
 * both copy the same link, and a second `try/catch` around `navigator.clipboard` is a second
 * place for the failure wording — and the failure itself — to be got subtly wrong.
 */
async function copyInviteLink(url: string): Promise<string> {
  try {
    await navigator.clipboard.writeText(url);
    return 'Copied';
  } catch {
    return 'Copy failed — select the link and copy it manually.';
  }
}

/** The absolute form of a same-origin invite path, built once the browser can supply an origin. */
function useAbsoluteLink(invitePath: string | null): string | null {
  const [absolute, setAbsolute] = useState<string | null>(null);

  // Built after mount rather than during render: the server has no window to read an origin
  // from, and rendering a different string on the two sides is a hydration mismatch.
  useEffect(() => {
    setAbsolute(invitePath ? new URL(invitePath, window.location.origin).toString() : null);
  }, [invitePath]);

  return absolute;
}

/**
 * One button that copies the group's invite link (AC-2).
 *
 * The members screen's solo-owner empty state uses it and nothing else does: the invite panel
 * owns the full link, while this is the single action a group with nobody else in it needs.
 */
export function CopyLinkButton({
  invitePath,
  label = 'Copy invite link',
}: {
  invitePath: string;
  label?: string;
}) {
  const absolute = useAbsoluteLink(invitePath);
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-2">
      {/* Disabled until the absolute link exists, so a click during the first paint cannot
          copy an empty string and report success. */}
      <Button
        type="button"
        variant="secondary"
        disabled={absolute === null}
        onClick={async () => {
          if (absolute === null) return;
          setNote(await copyInviteLink(absolute));
        }}
      >
        {label}
      </Button>
      <p aria-live="polite" className="text-secondary text-ink-muted">
        {note ?? 'Anyone signed in who opens this link can join.'}
      </p>
    </div>
  );
}

export function InvitePanel({
  groupId,
  groupName,
  invitePath,
  inviteEnabled,
  inviteNotice = null,
  archived = false,
}: {
  groupId: string;
  groupName: string;
  invitePath: string | null;
  inviteEnabled: boolean;
  /** The sentence a successful rotate or disable came back with, built from the page's query
   * (AC-13). One slot, because both outcomes share it and the later one replaces the earlier. */
  inviteNotice?: string | null;
  /**
   * Whether the group is archived (AC-2). Every control this panel owns is dead on an archived
   * group — joining filters archived groups out of the invite lookup, and rotate and disable both
   * answer with the archived refusal — so the panel says so in one read-only sentence and offers
   * nothing at all: no link to copy, no captions about joining, no rotate or disable, and no
   * notice slot, because a success notice about a link nobody can use is noise.
   */
  archived?: boolean;
}) {
  const [rotateState, rotateAction, rotatePending] = useActionState(rotateInvite, IDLE_GROUP_STATE);
  const [disableState, disableAction, disablePending] = useActionState(
    disableInvite,
    IDLE_GROUP_STATE,
  );
  const [confirming, setConfirming] = useState<'rotate' | 'disable' | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const absolute = useAbsoluteLink(invitePath);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="invite-heading">
      <h2 id="invite-heading" className="text-section font-semibold text-ink">
        Invite link
      </h2>

      {archived ? (
        <p className="text-secondary text-ink-muted">
          This group is archived, so nobody new can join.
        </p>
      ) : (
        <>
          {/* Section level, once, holding whichever invite outcome just happened: the two successes
              ride one query value, so this is the only place either can render and neither can sit
              beside the other (AC-13). */}
          {inviteNotice ? (
            <p
              role="status"
              aria-live="polite"
              className="rounded-token border border-border bg-lent-tint p-3 text-secondary text-lent"
            >
              {inviteNotice}
            </p>
          ) : null}

          {invitePath === null ? (
            <p className="text-secondary text-ink-muted">
              This group has no link yet. Create one to invite people.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="sr-only" htmlFor="invite-url">
                  Invite link
                </label>
                <input
                  id="invite-url"
                  type="text"
                  readOnly
                  value={absolute ?? invitePath}
                  onFocus={(event) => event.target.select()}
                  className={FIELD_CLASSES}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={async () => {
                    if (absolute === null) return;
                    setCopyNote(await copyInviteLink(absolute));
                  }}
                >
                  Copy
                </Button>
              </div>
              <p aria-live="polite" className="text-secondary text-ink-muted">
                {copyNote ?? 'Anyone signed in who opens this link can join.'}
              </p>
              <p className={inviteEnabled ? 'text-secondary text-lent' : 'text-secondary text-danger'}>
                {inviteEnabled ? 'The link is active.' : 'The link is disabled — nobody can join with it.'}
              </p>
            </>
          )}

          {/* Refusals only: a success redirects to the notice slot above, so the state never comes
              back here with one to show. */}
          <StateMessage state={rotateState} />
          <StateMessage state={disableState} />

          {confirming === 'rotate' ? (
            <form action={rotateAction}>
              <input type="hidden" name="groupId" value={groupId} />
              <ConfirmStep
                question={`Replace the invite link for “${groupName}”? The current link stops working immediately.`}
                confirmLabel="Replace link"
                pendingLabel="Replacing…"
                isPending={rotatePending}
                onCancel={() => setConfirming(null)}
              />
            </form>
          ) : null}

          {confirming === 'disable' ? (
            <form action={disableAction}>
              <input type="hidden" name="groupId" value={groupId} />
              <ConfirmStep
                question={`Disable the invite link for “${groupName}”? Nobody will be able to join until you create a new one.`}
                confirmLabel="Disable link"
                pendingLabel="Disabling…"
                isPending={disablePending}
                onCancel={() => setConfirming(null)}
              />
            </form>
          ) : null}

          {confirming === null ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => setConfirming('rotate')}>
                {invitePath === null ? 'Create link' : 'Rotate link'}
              </Button>
              {invitePath !== null && inviteEnabled ? (
                <Button type="button" variant="destructive" onClick={() => setConfirming('disable')}>
                  Disable link
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

interface MemberSummary {
  id: string;
  userId: string | null;
  displayName: string;
  role: string;
  /** Minor units, already computed on the server by the balance seam (TR-9 fills it in). */
  balanceMinor: number;
}

function RemoveMemberForm({
  groupId,
  groupName,
  member,
}: {
  groupId: string;
  groupName: string;
  member: MemberSummary;
}) {
  const [state, formAction, isPending] = useActionState(removeMember, IDLE_GROUP_STATE);
  const [confirming, setConfirming] = useState(false);

  // Success never arrives here: it deletes this row and redirects to the members page with the
  // note (AC-11). What is left for the form to render is the refusals, which stay inline
  // because the form is still on screen to show them — and because a refusal is the only thing
  // that comes back, the confirm step stays open under it rather than closing on the refusal.
  useEffect(() => {
    if (state.status === 'success') setConfirming(false);
  }, [state]);

  // The guard's own sentence, recognised rather than re-derived: only the member who still
  // carries a balance can be pointed at settle-up, and the panel would otherwise have to know
  // the guard's arithmetic to decide (AC-2). The leave section below recognises the same sentence
  // for the same reason — `leaveGroup` throws the identical `NonZeroBalanceError` — with one
  // exception: an archived group refuses settling too, so there the note says so instead of
  // offering a link that cannot work (AC-1).
  const balanceBlocked = isBalanceBlockedRefusal(state.message);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="membershipId" value={member.id} />
      {confirming ? (
        <ConfirmStep
          question={`Remove ${member.displayName} from “${groupName}”?`}
          confirmLabel="Remove member"
          pendingLabel="Removing…"
          isPending={isPending}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={DANGER_BUTTON}>
          Remove
        </button>
      )}
      <StateMessage state={state} />
      {balanceBlocked ? (
        <Link
          className="text-secondary text-accent underline underline-offset-4"
          href={`/groups/${groupId}#debts-heading`}
        >
          Settle up
        </Link>
      ) : null}
    </form>
  );
}

/**
 * Archiving lives on the group's own settings section rather than here: it acts on the group,
 * not on a member, and one confirm for one action is the point of putting them all behind one.
 */
export function ArchiveGroupForm({ groupId, groupName }: { groupId: string; groupName: string }) {
  const [state, formAction, isPending] = useActionState(archiveGroup, IDLE_GROUP_STATE);
  const [confirming, setConfirming] = useState(false);

  // As with remove: success redirects to the group page, where the note renders beside the
  // read-only banner, and leaves this form to show refusals only (AC-11).
  useEffect(() => {
    if (state.status === 'success') setConfirming(false);
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="groupId" value={groupId} />
      {confirming ? (
        <ConfirmStep
          question={`Archive “${groupName}”? It disappears from everyone's group list and becomes read-only. This cannot be undone.`}
          confirmLabel="Archive group"
          pendingLabel="Archiving…"
          isPending={isPending}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={DANGER_BUTTON}>
          Archive group
        </button>
      )}
      <StateMessage state={state} />
    </form>
  );
}

/** The colour a balance's words and amount wear; the words are what carry the direction. */
const TONE_CLASSES = {
  neutral: 'text-ink-muted',
  lent: 'text-lent',
  owed: 'text-owed',
} as const;

/** The balance line of a roster row: the direction in words first, then the amount it is about. */
function MemberBalance({
  member,
  viewerIsSubject,
  currency,
}: {
  member: MemberSummary;
  viewerIsSubject: boolean;
  currency: string;
}) {
  const { words, tone } = directionWords(member.balanceMinor, viewerIsSubject);

  return (
    <p className="flex flex-wrap items-baseline gap-2 text-secondary">
      {/* The words come first and are never dropped: colour alone is not a direction (AC-6). */}
      <span className={TONE_CLASSES[tone]}>{words}</span>
      {/* A zero amount is the one number ui.md keeps off the screen — "settled up" already says
          it, and a ₹0.00 next to it reads as a debt of nothing. */}
      {member.balanceMinor === 0 ? null : (
        <span data-amount className={`font-semibold ${TONE_CLASSES[tone]}`}>
          {formatMinorUnits(Math.abs(member.balanceMinor), currency)}
        </span>
      )}
    </p>
  );
}

/**
 * One seat in the roster: who it is, what it is worth, and — for the owner, on somebody else's
 * row — the one action that acts on it (AC-1).
 *
 * Owner actions sit behind a `<details>` disclosure rather than an inline button: ui.md puts row
 * actions behind an overflow menu, and `details` is the version of that which opens with the
 * keyboard and needs no script — this island is a client component, but the disclosure must
 * still work before it hydrates and for a reader whose JavaScript never arrives.
 */
function MemberRow({
  member,
  groupId,
  groupName,
  viewerMembershipId,
  isOwner,
  archived,
  currency,
}: {
  member: MemberSummary;
  groupId: string;
  groupName: string;
  viewerMembershipId: string;
  isOwner: boolean;
  archived: boolean;
  currency: string;
}) {
  const isViewer = member.id === viewerMembershipId;

  return (
    <li className="flex items-start gap-3 rounded-token border border-border bg-surface p-3">
      {/* A seat with no account behind it has no initials to draw, so it takes the Avatar's
          fallback icon and the Placeholder badge says why (ui.md's Avatar, AC-1). */}
      <Avatar
        name={member.userId === null ? '' : member.displayName}
        memberId={member.id}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Truncated with its full value in `title`, so a long name shortens rather than
              wrapping the row into three lines (ui.md). */}
          <span className="min-w-0 truncate font-medium text-ink" title={member.displayName}>
            {member.displayName}
          </span>
          <span className="flex flex-wrap items-center gap-1">
            {isViewer ? <Badge tone="accent">You</Badge> : null}
            {member.role === 'owner' ? <Badge>Owner</Badge> : null}
            {member.userId === null ? <Badge>Placeholder</Badge> : null}
          </span>
        </div>

        <MemberBalance member={member} viewerIsSubject={isViewer} currency={currency} />

        {/* The row's name above truncates; this line prints the same name in full, so it is the
            one that has to wrap — an 80-character unbroken name would otherwise widen the row
            past the viewport (AC-7). */}
        {member.userId === null ? (
          <p className="text-secondary text-ink-muted break-words">
            Claim this seat from the invite link — whoever opens it and picks{' '}
            {member.displayName} takes over everything recorded for them.
          </p>
        ) : null}
      </div>

      {isOwner && !archived && !isViewer ? (
        <details className="relative shrink-0">
          {/* The marker is hidden with `list-none`, not with a `display` override: a summary
              whose display is not `list-item` stops being announced as a disclosure at all, and
              the target's size belongs on the span inside it (ui.md's 44px, AC-1). */}
          <summary className="cursor-pointer list-none rounded-token text-ink-muted hover:bg-surface-sunken hover:text-ink [&::-webkit-details-marker]:hidden">
            <span className="inline-flex size-11 items-center justify-center">
              <MoreHorizontal aria-hidden="true" className="size-5" />
            </span>
            <span className="sr-only">{`Actions for ${member.displayName}`}</span>
          </summary>
          {/* The panel floats over the rows below rather than sitting in this one's flow: it is a
              fixed 256px box, and the row's own content — avatar, gaps and this disclosure —
              plus that box is wider than the `li` has inside the Card at a 375px viewport, so
              the row, and with it the page, overflowed with *any* name length (AC-7: short names
              read byte-identical to 80-character ones, which is how the wrapping diagnosis was
              disproved). `absolute` pairs with the `relative` above to take the panel's width
              out of the row's arithmetic entirely, `w-64 max-w-[calc(100vw-3rem)]` still caps it,
              and the surface card is the MenuPanel idiom every other overlay in the app uses. The
              disclosure, the form and the shared ConfirmStep are untouched, so the keyboard path
              and the question's own wrapping are unchanged. */}
          <div className="absolute right-0 z-40 mt-2 w-64 max-w-[calc(100vw-3rem)] rounded-token border border-border bg-surface p-3 shadow-md">
            <RemoveMemberForm groupId={groupId} groupName={groupName} member={member} />
          </div>
        </details>
      ) : null}
    </li>
  );
}

export function MembersPanel({
  groupId,
  groupName,
  members,
  viewerMembershipId,
  isOwner,
  archived,
  currency,
  removedNotice = null,
}: {
  groupId: string;
  groupName: string;
  members: MemberSummary[];
  viewerMembershipId: string;
  isOwner: boolean;
  archived: boolean;
  currency: string;
  /** The note a successful remove came back with, built from the page's query (AC-11). */
  removedNotice?: string | null;
}) {
  const [leaveState, leaveAction, leavePending] = useActionState(leaveGroup, IDLE_GROUP_STATE);
  const [confirming, setConfirming] = useState(false);

  // A refusal stays in `leaveState` after the person dismisses it — React keeps the action's last
  // answer — so the removal note this panel also owns needs a flag of its own to say the refusal
  // has been dismissed. Without it, cancelling the confirm would leave the note hidden for good.
  const [leaveRefusalDismissed, setLeaveRefusalDismissed] = useState(false);

  // The same guard sentence the remove form recognises (AC-1). `leaveGroup` throws the identical
  // `NonZeroBalanceError`, and leaving is the write an archived group still accepts, which is why
  // this path keeps its balance guard where the others refuse archived groups outright.
  const leaveBlocked = isBalanceBlockedRefusal(leaveState.message);

  // The removal note is true until a leave refusal takes the slot: two sentences about two
  // different outcomes must not stand in the same panel at once (AC-4).
  const leaveFailed = leaveState.status === 'error' && !leaveRefusalDismissed;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="members-heading">
      <h2 id="members-heading" className="text-section font-semibold text-ink">
        Members
      </h2>

      {/* Panel level, like the join page's lost-seat notice and for the same reason: the row
          whose form carried the message is the row the remove deleted, so the note has to live
          somewhere the removal cannot unmount. */}
      {removedNotice && !leaveFailed ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded-token border border-border bg-lent-tint p-3 text-secondary text-lent break-words"
        >
          {removedNotice}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {members.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            groupId={groupId}
            groupName={groupName}
            viewerMembershipId={viewerMembershipId}
            isOwner={isOwner}
            archived={archived}
            currency={currency}
          />
        ))}
      </ul>

      <StateMessage state={leaveState} />

      {/* A leaver who still carries a balance used to be told to settle up and given nothing to
          settle up with, while the remove form three lines up linked onward (AC-1). Same
          refusal, same link — except in an archived group, where settling is refused as well, so
          the link would be a dead end and the note says what is actually true instead. */}
      {leaveBlocked ? (
        archived ? (
          <p className="text-secondary text-ink-muted">
            This group is archived, so this balance cannot be settled here.
          </p>
        ) : (
          <Link
            className="text-secondary text-accent underline underline-offset-4"
            href={`/groups/${groupId}#debts-heading`}
          >
            Settle up
          </Link>
        )
      ) : null}

      {confirming ? (
        <form action={leaveAction}>
          <input type="hidden" name="groupId" value={groupId} />
          <ConfirmStep
            question={`Leave “${groupName}”? You will stop seeing its expenses and balances.`}
            confirmLabel="Leave group"
            pendingLabel="Leaving…"
            isPending={leavePending}
            onCancel={() => {
              setConfirming(false);
              // Dismissing the refusal hands the note slot back to the removal note it was
              // covering (AC-4) — the refusal itself stays on the panel, where it still is true.
              setLeaveRefusalDismissed(true);
            }}
          />
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setConfirming(true);
              // A fresh attempt at leaving: whatever the last one was refused with is this
              // panel's business again, and while it stands it takes the note slot.
              setLeaveRefusalDismissed(false);
            }}
          >
            Leave group
          </Button>
        </div>
      )}
    </section>
  );
}

function ClaimSeatForm({
  token,
  seat,
  matchesYou,
}: {
  token: string;
  seat: { id: string; displayName: string };
  matchesYou: boolean;
}) {
  const [state, formAction, isPending] = useActionState(claimPlaceholder, IDLE_GROUP_STATE);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2 rounded-token border border-border bg-surface p-3"
    >
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="membershipId" value={seat.id} />
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={seat.displayName} memberId={seat.id} />
        <span className="min-w-0 truncate font-medium text-ink" title={seat.displayName}>
          {seat.displayName}
        </span>
        {/* A hint, not an assertion: the visitor decides, and the badge only says why this seat
            is being offered to them first (ui.md's Badge). */}
        {matchesYou ? <Badge tone="accent">Looks like you</Badge> : null}
        {/* The label is its own box rather than a bare text node, and the button shrinks with it:
            this is a flex-wrap row, and a flex item's automatic minimum size is its min-content
            width, so a placeholder-maximum name would hold the button — and the row, and the page
            — at the full string. `min-w-0` joins `ml-auto` rather than replacing it, so the
            button still takes its own line beside the truncated seat name (AC-1). */}
        <Button
          type="submit"
          variant="secondary"
          className="ml-auto min-w-0"
          pending={isPending}
          pendingLabel="Claiming…"
        >
          <span className="min-w-0 break-words">{`This is me — claim ${seat.displayName}`}</span>
        </Button>
      </div>
      <StateMessage state={state} />
    </form>
  );
}

export function JoinPanel({
  token,
  groupName,
  seats,
  claimNotice = null,
}: {
  token: string;
  groupName: string;
  seats: { id: string; displayName: string; matchesYou: boolean }[];
  /** Why the visitor is back here after a claim, when a claim is what sent them (AC-9). */
  claimNotice?: string | null;
}) {
  const [state, joinAction, joinPending] = useActionState(joinByToken, IDLE_GROUP_STATE);

  return (
    <div className="flex flex-col gap-5">
      {/* Panel level, not per seat: the seat the visitor tried for is no longer on this page to
          carry a message, and the refusal is about the page as a whole anyway. */}
      {claimNotice ? (
        <p
          role="alert"
          aria-live="polite"
          className="rounded-token border border-danger-tint bg-danger-tint p-3 text-secondary text-danger"
        >
          {claimNotice}
        </p>
      ) : null}

      <form action={joinAction} className="flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        {/* Same two-level treatment as the claim button below: `break-words` on the label so an
            80-character unbroken group name wraps, and `min-w-0` on both the label and the button
            so the flex item can be narrower than its own longest word instead of widening the
            page (AC-1). */}
        <Button type="submit" className="min-w-0" pending={joinPending} pendingLabel="Joining…">
          <span className="min-w-0 break-words">{`Join ${groupName}`}</span>
        </Button>
        <StateMessage state={state} />
      </form>

      <section className="flex flex-col gap-3" aria-labelledby="claim-heading">
        <h2 id="claim-heading" className="text-section font-semibold text-ink">
          Or claim your seat
        </h2>
        {seats.length === 0 ? (
          <p className="text-secondary text-ink-muted">
            Nobody has added a seat for you by name yet — join as a new member instead.
          </p>
        ) : (
          <>
            <p className="text-secondary text-ink-muted">
              If somebody already added you by name, claiming their seat takes over everything
              recorded for it.
            </p>
            <ul className="flex flex-col gap-3">
              {seats.map((seat) => (
                <li key={seat.id}>
                  <ClaimSeatForm token={token} seat={seat} matchesYou={seat.matchesYou} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
