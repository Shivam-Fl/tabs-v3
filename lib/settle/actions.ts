'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { withDb } from '../db/client';
import { activityEvents, payments } from '../db/schema';
import { guardGroup, type GroupAccess } from '../groups/authz';
import {
  ARCHIVED_GROUP_MESSAGE,
  GROUP_NOT_FOUND_MESSAGE,
  UNAUTHENTICATED_MESSAGE,
} from '../groups/validation';
import { formatMinorUnits } from '../money/format';
import { computeNetBalances } from './balances';
import { loadPayment } from './queries';
import {
  PAYMENT_NOT_FOUND_MESSAGE,
  parsePaymentInput,
  paymentScope,
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
 * - **Only a member the payment involves may delete it** (spec: "a payment can be deleted by the
 *   members it involves"). A payment naming a departed seat is deletable by the *current* member
 *   on the other end of it — the only person left who was there. Everybody else gets the same
 *   refusal a payment that does not exist gets, because to them it is one.
 *
 * Neither action redirects. Both forms live in the group page's debts card, which stays mounted
 * while the numbers beside it change, so the outcome is returned as state and announced through
 * the island's live region (AC-3) rather than carried away as a query on a page the caller left.
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

function refusal(access: GroupAccess): PaymentActionState {
  return access.status === 'unauthenticated' ? UNAUTHENTICATED_STATE : NOT_FOUND_STATE;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/** The group page and home, refreshed after anything that moves a balance. */
function revalidateBalances(groupId: string): void {
  revalidatePath('/');
  revalidatePath(`/groups/${groupId}`);
  revalidatePath(`/groups/${groupId}/members`);
}

/** What the feed row says happened, in the words the two seats carried at the time. */
function paymentSubject(snapshot: PaymentSnapshot): string {
  return `${snapshot.fromDisplayName} paid ${snapshot.toDisplayName}`;
}

export async function createPayment(
  _previous: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const groupId = field(formData, 'groupId');

  return withDb(async (handle): Promise<PaymentActionState> => {
    const access = await guardGroup(handle.db, groupId);
    if (access.status !== 'ok') return refusal(access);
    if (access.group.archived) return ARCHIVED_STATE;

    const parsed = parsePaymentInput(formData);
    if (!parsed.ok) {
      return { status: 'error', message: parsed.message, fieldErrors: parsed.fieldErrors };
    }

    // Every seat this group's ledger knows: the current members in their live names and the
    // departed participants under the names their rows snapshotted. An id that is not in here is
    // not part of this group, and gets the refusal this group's absence would.
    const balances = await computeNetBalances(handle.db, access.group.id);
    const names = new Map(balances.map((balance) => [balance.membershipId, balance.displayName]));

    const fromName = names.get(parsed.draft.fromMembershipId);
    const toName = names.get(parsed.draft.toMembershipId);
    if (fromName === undefined || toName === undefined) return NOT_FOUND_STATE;

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

    revalidateBalances(access.group.id);

    return {
      status: 'success',
      message: `Payment recorded: ${fromName} paid ${toName} ${formatMinorUnits(snapshot.amountMinor, access.group.currency)}.`,
    };
  });
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

  return withDb(async (handle): Promise<PaymentActionState> => {
    const access = await guardGroup(handle.db, groupId);
    if (access.status !== 'ok') return refusal(access);
    if (access.group.archived) return ARCHIVED_STATE;

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

    if (deleted === null) return PAYMENT_GONE_STATE;

    revalidateBalances(access.group.id);

    return {
      status: 'success',
      message: `Payment deleted: ${deleted.fromDisplayName} paid ${deleted.toDisplayName} ${formatMinorUnits(deleted.amountMinor, access.group.currency)}.`,
    };
  });
}
