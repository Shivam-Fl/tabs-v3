'use client';

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
  type GroupActionState,
} from '../lib/groups/validation';
import { formatMinorUnits } from '../lib/money/format';

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
 */

const INPUT_CLASSES =
  'min-h-11 w-full rounded-token border border-muted/40 bg-surface px-3 text-ink placeholder:text-muted';
const LABEL_CLASSES = 'text-sm font-medium';
const PRIMARY_BUTTON =
  'min-h-11 rounded-token bg-accent px-4 font-medium text-surface disabled:opacity-60';
const QUIET_BUTTON = 'min-h-11 rounded-token border border-muted/40 px-4 font-medium';
const DANGER_BUTTON = 'min-h-11 rounded-token border border-danger/50 px-4 font-medium text-danger';

function StateMessage({ state }: { state: GroupActionState }) {
  if (state.status === 'idle' || state.message === '') return null;

  return (
    <p
      role={state.status === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      className={state.status === 'error' ? 'text-sm text-danger' : 'text-sm text-lent'}
    >
      {state.message}
    </p>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-danger">
      {message}
    </p>
  );
}

/** The confirm step every destructive action shares: a question naming the object, then a pair. */
function ConfirmStep({
  question,
  confirmLabel,
  pendingLabel,
  isPending,
  onCancel,
}: {
  question: string;
  confirmLabel: string;
  pendingLabel: string;
  isPending: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-token border border-danger/40 p-3">
      <p role="alert" className="text-sm">
        {question}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={isPending} aria-busy={isPending} className={DANGER_BUTTON}>
          {isPending ? pendingLabel : confirmLabel}
        </button>
        <button type="button" onClick={onCancel} className={QUIET_BUTTON}>
          Cancel
        </button>
      </div>
    </div>
  );
}

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
      <div className="flex flex-col gap-2">
        <label className={LABEL_CLASSES} htmlFor="placeholder-name">
          Add someone by name
        </label>
        <p className="text-sm text-muted">
          For people who are in the group but have not signed up yet. They claim the seat when
          they open the invite link.
        </p>
        <input
          id="placeholder-name"
          name="displayName"
          type="text"
          maxLength={PLACEHOLDER_NAME_MAX}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Their name"
          aria-invalid={errors.displayName !== undefined}
          aria-describedby={errors.displayName ? 'placeholder-name-error' : undefined}
          className={INPUT_CLASSES}
        />
        <FieldError id="placeholder-name-error" message={errors.displayName} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={isPending} aria-busy={isPending} className={QUIET_BUTTON}>
          {isPending ? 'Adding…' : 'Add seat'}
        </button>
        <StateMessage state={state} />
      </div>
    </form>
  );
}

export function InvitePanel({
  groupId,
  groupName,
  invitePath,
  inviteEnabled,
}: {
  groupId: string;
  groupName: string;
  invitePath: string | null;
  inviteEnabled: boolean;
}) {
  const [rotateState, rotateAction, rotatePending] = useActionState(rotateInvite, IDLE_GROUP_STATE);
  const [disableState, disableAction, disablePending] = useActionState(
    disableInvite,
    IDLE_GROUP_STATE,
  );
  const [confirming, setConfirming] = useState<'rotate' | 'disable' | null>(null);
  const [absolute, setAbsolute] = useState<string | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);

  // Built after mount rather than during render: the server has no window to read an origin
  // from, and rendering a different string on the two sides is a hydration mismatch.
  useEffect(() => {
    setAbsolute(invitePath ? new URL(invitePath, window.location.origin).toString() : null);
  }, [invitePath]);

  useEffect(() => {
    if (rotateState.status === 'success' || disableState.status === 'success') setConfirming(null);
  }, [rotateState, disableState]);

  async function copyLink() {
    const url = absolute;
    if (!url) return;

    try {
      await navigator.clipboard.writeText(url);
      setCopyNote('Copied');
    } catch {
      setCopyNote('Copy failed — select the link and copy it manually.');
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="invite-heading">
      <h2 id="invite-heading" className="text-lg font-semibold">
        Invite link
      </h2>

      {invitePath === null ? (
        <p className="text-sm text-muted">
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
              className={INPUT_CLASSES}
            />
            <button type="button" onClick={copyLink} className={QUIET_BUTTON}>
              Copy
            </button>
          </div>
          <p aria-live="polite" className="text-sm text-muted">
            {copyNote ?? 'Anyone signed in who opens this link can join.'}
          </p>
          <p className={inviteEnabled ? 'text-sm text-lent' : 'text-sm text-danger'}>
            {inviteEnabled ? 'The link is active.' : 'The link is disabled — nobody can join with it.'}
          </p>
        </>
      )}

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
          <button
            type="button"
            onClick={() => setConfirming('rotate')}
            className={QUIET_BUTTON}
          >
            {invitePath === null ? 'Create link' : 'Rotate link'}
          </button>
          {invitePath !== null && inviteEnabled ? (
            <button
              type="button"
              onClick={() => setConfirming('disable')}
              className={DANGER_BUTTON}
            >
              Disable link
            </button>
          ) : null}
        </div>
      ) : null}
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
  // because the form is still on screen to show them.
  useEffect(() => {
    if (state.status === 'success') setConfirming(false);
  }, [state]);

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

  return (
    <section className="flex flex-col gap-4" aria-labelledby="members-heading">
      <h2 id="members-heading" className="text-lg font-semibold">
        Members
      </h2>

      {/* Panel level, like the join page's lost-seat notice and for the same reason: the row
          whose form carried the message is the row the remove deleted, so the note has to live
          somewhere the removal cannot unmount. */}
      {removedNotice ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded-token border border-muted/40 bg-surface p-3 text-sm text-lent"
        >
          {removedNotice}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {members.map((member) => (
          <li
            key={member.id}
            className="flex flex-col gap-2 rounded-token border border-muted/20 bg-surface p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{member.displayName}</span>
              {member.role === 'owner' ? (
                <span className="rounded-token border border-muted/40 px-2 text-sm text-muted">
                  Owner
                </span>
              ) : null}
              {member.id === viewerMembershipId ? (
                <span className="rounded-token border border-accent/40 px-2 text-sm text-accent">
                  You
                </span>
              ) : null}
              {member.userId === null ? (
                <span className="rounded-token border border-muted/40 px-2 text-sm text-muted">
                  Hasn’t joined yet
                </span>
              ) : null}
            </div>

            <p className="text-sm text-muted">
              <span className="sr-only">Balance </span>
              <span data-amount className="font-semibold text-ink">
                {formatMinorUnits(member.balanceMinor, currency)}
              </span>
            </p>

            {member.userId === null ? (
              <p className="text-sm text-muted">
                Claim this seat from the invite link — whoever opens it and picks{' '}
                {member.displayName} takes over everything recorded for them.
              </p>
            ) : null}

            {isOwner && !archived && member.id !== viewerMembershipId ? (
              <RemoveMemberForm groupId={groupId} groupName={groupName} member={member} />
            ) : null}
          </li>
        ))}
      </ul>

      <StateMessage state={leaveState} />

      {confirming ? (
        <form action={leaveAction}>
          <input type="hidden" name="groupId" value={groupId} />
          <ConfirmStep
            question={`Leave “${groupName}”? You will stop seeing its expenses and balances.`}
            confirmLabel="Leave group"
            pendingLabel="Leaving…"
            isPending={leavePending}
            onCancel={() => setConfirming(false)}
          />
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setConfirming(true)} className={QUIET_BUTTON}>
            Leave group
          </button>
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
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="membershipId" value={seat.id} />
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">{seat.displayName}</span>
        {matchesYou ? <span className="text-sm text-muted">Looks like you</span> : null}
        <button type="submit" disabled={isPending} aria-busy={isPending} className={QUIET_BUTTON}>
          {isPending ? 'Claiming…' : `This is me — claim ${seat.displayName}`}
        </button>
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
          className="rounded-token border border-danger/50 bg-surface p-3 text-sm text-danger"
        >
          {claimNotice}
        </p>
      ) : null}

      <form action={joinAction} className="flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        <button type="submit" disabled={joinPending} aria-busy={joinPending} className={PRIMARY_BUTTON}>
          {joinPending ? 'Joining…' : `Join ${groupName}`}
        </button>
        <StateMessage state={state} />
      </form>

      <section className="flex flex-col gap-3" aria-labelledby="claim-heading">
        <h2 id="claim-heading" className="text-lg font-semibold">
          Or claim your seat
        </h2>
        {seats.length === 0 ? (
          <p className="text-sm text-muted">
            Nobody has added a seat for you by name yet — join as a new member instead.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">
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
