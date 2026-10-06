'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { withDb } from '../db/client';
import { activityEvents, memberships, payments } from '../db/schema';
import { guardGroup, type GroupAccess } from '../groups/authz';
import {
  ARCHIVED_GROUP_MESSAGE,
  GROUP_NOT_FOUND_MESSAGE,
  UNAUTHENTICATED_MESSAGE,
} from '../groups/validation';
import { computeNetBalances } from './balances';
import { loadPayment } from './queries';
import {
  PAYMENT_BOTH_DEPARTED_MESSAGE,
  PAYMENT_DELETED,
  PAYMENT_NOT_FOUND_MESSAGE,
  PAYMENT_NOTICE_FROM_PARAM,
  PAYMENT_NOTICE_PARAM,
  PAYMENT_NOTICE_TO_PARAM,
  PAYMENT_RECORDED,
  parsePaymentInput,
  paymentScope,
  paymentSubject,
  type PaymentActionState,
  type PaymentSnapshot,
} from './validation';

/**
 * Every write to a payment (TR-9, TR-10).
 *
 * The shape is the expense actions' shape: the caller comes from the request's own session, the
 * group comes through `guardGroup`, the input crosses a zod boundary, and the payment and the
 * activity row that records it commit in **one** interactive transaction — a payment without its
 * feed row is a ledger the feed disagrees with, and the feed is the record that this money moved.
 *
 * Two rules are this ticket's own and both are checked against the guarded group rather than
 * against the form:
 *
 * - **Both endpoints have to belong to this group**, with the same answer a group the caller
 *   cannot see gets. An endpoint may be a current member *or* a departed ledger participant
 *   (ADR-0007): a seat whose membership row was deleted still owns its expenses, and refusing to
 *   let it be settled would strand a net that no write could ever clear. An id from another group
 *   is neither, and gets the 404-shaped refusal (AC-5) — the same answer a stranger, a missing
 *   group and a made-up id get, so nothing about which ids exist leaks through the refusal.
 *   At least one endpoint must still be a *current* membership, though: a payment between two
 *   departed seats could be recorded and never deleted, since the delete rule below needs a
 *   current member on one end, so it is refused at the write instead.
 * - **Only a member the payment involves may delete it** (spec: "a payment can be deleted by the
 *   members it involves"). A payment naming a departed seat is deletable by the *current* member
 *   on the other end of it — the only person left who was there. Everybody else gets the same
 *   refusal a payment that does not exist gets, because to them it is one.
 *
 * A success **redirects**; a refusal does not. Recording or deleting a payment changes the list
 * of suggested transfers it was made from, so the row that held the form — and the island's live
 * region around it — is unmounted by the outcome it would have announced. The confirmation
 * therefore rides home on the group page's query (ADR-0008), carrying the pair the notice is
 * about, and is rendered in the debts card's own panel-level region. A refusal never redirects:
 * the sheet that shows it is still open, holding what was typed.
 */

const UNAUTHENTICATED_STATE: PaymentActionState = {
  status: 'error',
  message: UNAUTHENTICATED_MESSAGE,
};
const NOT_FOUND_STATE: PaymentActionState = { status: 'error', message: GROUP_NOT_FOUND_MESSAGE };
const ARCHIVED_STATE: PaymentActionState = { status: 'error', message: ARCHIVED_GROUP_MESSAGE };
const PAYMENT_GONE_STATE: PaymentActionState = {
  status: 'error',
  message: PAYMENT_NOT_FOUND_MESSAGE,
};
const BOTH_DEPARTED_STATE: PaymentActionState = {
  status: 'error',
  message: PAYMENT_BOTH_DEPARTED_MESSAGE,
};

function refusal(access: GroupAccess): PaymentActionState {
  return access.status === 'unauthenticated' ? UNAUTHENTICATED_STATE : NOT_FOUND_STATE;
}

interface Outcome {
  state: PaymentActionState;
  /** Where a successful action sends the caller, when staying put no longer makes sense. */
  redirectTo?: string;
  /** The group the outcome changed, so the screens that render it are refreshed. */
  groupId?: string;
}

function finish(outcome: Outcome): PaymentActionState {
  if (outcome.redirectTo) redirect(outcome.redirectTo);
  return outcome.state;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/**
 * The group page, carrying which payment outcome just happened and the pair it was about — the
 * two query values the debts card's notice slot reads back (AC-6).
 */
function paymentNoticePath(
  groupId: string,
  notice: string,
  snapshot: Pick<PaymentSnapshot, 'fromMembershipId' | 'toMembershipId'>,
): string {
  const params = new URLSearchParams({
    [PAYMENT_NOTICE_PARAM]: notice,
    [PAYMENT_NOTICE_FROM_PARAM]: snapshot.fromMembershipId,
    [PAYMENT_NOTICE_TO_PARAM]: snapshot.toMembershipId,
  });
  return `/groups/${groupId}?${params.toString()}`;
}

/**
 * The group page, home and the cross-group feed, refreshed after anything that moves a balance.
 * The feed is on the list because a recorded or deleted payment is what puts its row there: the
 * balances and the record of what moved them have to move together.
 */
function revalidateBalances(groupId?: string): void {
  revalidatePath('/');
  revalidatePath('/activity');
  if (groupId) {
    revalidatePath(`/groups/${groupId}`);
    revalidatePath(`/groups/${groupId}/members`);
  }
}

export async function createPayment(
  _previous: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const groupId = field(formData, 'groupId');

  const outcome = await withDb(async (handle): Promise<Outcome> => {
    const access = await guardGroup(handle.db, groupId);
    if (access.status !== 'ok') return { state: refusal(access) };
    if (access.group.archived) return { state: ARCHIVED_STATE };

    const parsed = parsePaymentInput(formData);
    if (!parsed.ok) {
      return { state: { status: 'error', message: parsed.message, fieldErrors: parsed.fieldErrors } };
    }

    // Every seat this group's ledger knows: the current members in their live names and the
    // departed participants under the names their rows snapshotted. An id that is not in here is
    // not part of this group, and gets the refusal this group's absence would.
    const balances = await computeNetBalances(handle.db, access.group.id);
    const names = new Map(balances.map((balance) => [balance.membershipId, balance.displayName]));

    const fromName = names.get(parsed.draft.fromMembershipId);
    const toName = names.get(parsed.draft.toMembershipId);
    if (fromName === undefined || toName === undefined) return { state: NOT_FOUND_STATE };

    // The ledger map knows departed seats too, so the check above lets a payment between two of
    // them through — and the delete rule, which needs one endpoint to still be a current member,
    // could then never undo it. Current here means the membership row exists: a placeholder (null
    // userId) is as current as a signed-up member. Nothing leaks by saying so: both seats are
    // already on the balances screen under the names this group's ledger kept for them.
    const current = await handle.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.groupId, access.group.id));
    const currentIds = new Set(current.map((seat) => seat.id));
    if (
      !currentIds.has(parsed.draft.fromMembershipId) &&
      !currentIds.has(parsed.draft.toMembershipId)
    ) {
      return { state: BOTH_DEPARTED_STATE };
    }

    const snapshot: PaymentSnapshot = {
      amountMinor: parsed.draft.amount,
      fromMembershipId: parsed.draft.fromMembershipId,
      fromDisplayName: fromName,
      toMembershipId: parsed.draft.toMembershipId,
      toDisplayName: toName,
    };

    await handle.db.transaction(async (tx) => {
      const [payment] = await tx
        .insert(payments)
        .values({
          groupId: access.group.id,
          fromMembershipId: snapshot.fromMembershipId,
          fromDisplayName: snapshot.fromDisplayName,
          toMembershipId: snapshot.toMembershipId,
          toDisplayName: snapshot.toDisplayName,
          amountMinor: snapshot.amountMinor,
        })
        .returning({ id: payments.id });

      // The snapshot rides the event as well as the row: when the payment is later deleted its
      // link is nulled, and this is what is left for the feed to render (AC-7).
      await tx.insert(activityEvents).values({
        groupId: access.group.id,
        actorUserId: access.user.id,
        subjectName: paymentSubject(snapshot),
        kind: 'payment-created',
        paymentId: payment.id,
        payload: snapshot,
      });
    });

    return {
      state: { status: 'success', message: 'Payment recorded.' },
      redirectTo: paymentNoticePath(access.group.id, PAYMENT_RECORDED, snapshot),
      groupId: access.group.id,
    };
  });

  revalidateBalances(outcome.groupId);
  return finish(outcome);
}

export async function deletePayment(
  _previous: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const groupId = field(formData, 'groupId');
  const scope = paymentScope.safeParse(field(formData, 'paymentId'));
  // A malformed id is answered before the database sees it, and answered the same way as an id
  // that exists in somebody else's group: nothing here is true of one and not the other.
  if (!scope.success) return PAYMENT_GONE_STATE;

  const outcome = await withDb(async (handle): Promise<Outcome> => {
    const access = await guardGroup(handle.db, groupId);
    if (access.status !== 'ok') return { state: refusal(access) };
    if (access.group.archived) return { state: ARCHIVED_STATE };

    // Read inside the transaction the delete commits in, so the row the feed records is the one
    // the authorization above decided about rather than a snapshot that raced with another write.
    const deleted = await handle.db.transaction(async (tx) => {
      const payment = await loadPayment(tx, access.group.id, scope.data);
      if (!payment) return null;

      const viewer = access.membership.id;
      const involved =
        payment.fromMembershipId === viewer || payment.toMembershipId === viewer;
      // Not involved reads exactly as not there: the caller learns nothing about a payment that
      // is none of their business, not even that it exists.
      if (!involved) return null;

      await tx.delete(payments).where(eq(payments.id, payment.id));

      const snapshot: PaymentSnapshot = {
        amountMinor: payment.amountMinor,
        fromMembershipId: payment.fromMembershipId,
        fromDisplayName: payment.fromDisplayName,
        toMembershipId: payment.toMembershipId,
        toDisplayName: payment.toDisplayName,
      };

      // Written after the delete and pointing at nothing, exactly as an expense-deleted row is:
      // the feed row is the record that the payment existed, and the snapshot is what it was.
      await tx.insert(activityEvents).values({
        groupId: access.group.id,
        actorUserId: access.user.id,
        subjectName: paymentSubject(snapshot),
        kind: 'payment-deleted',
        payload: snapshot,
      });

      return snapshot;
    });

    if (deleted === null) return { state: PAYMENT_GONE_STATE };

    return {
      state: { status: 'success', message: 'Payment deleted.' },
      redirectTo: paymentNoticePath(access.group.id, PAYMENT_DELETED, deleted),
      groupId: access.group.id,
    };
  });

  revalidateBalances(outcome.groupId);
  return finish(outcome);
}
