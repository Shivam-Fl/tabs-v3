import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { payments } from '../db/schema';

/**
 * The payment reads the group page renders (TR-9).
 *
 * They sit beside the boundary rather than inside the page, for the reason the expense reads do:
 * "this group's only, newest first" is one query a test can call, not a `where` clause retyped
 * into a screen where a missing `group_id` looks fine until another group's payments appear.
 *
 * Nothing here decides access. Whether the caller may see the group at all is `guardGroup`'s
 * answer before any of these run, and every one takes the group id those reads were authorized
 * for — so the failure mode of forgetting one is an empty list, not a leak.
 */

export interface PaymentRow {
  id: string;
  fromMembershipId: string;
  /** The snapshot taken when the payment was written; the seat may be gone (ADR-0007). */
  fromDisplayName: string;
  toMembershipId: string;
  toDisplayName: string;
  amountMinor: number;
  createdAt: Date;
}

const PAYMENT_COLUMNS = {
  id: payments.id,
  fromMembershipId: payments.fromMembershipId,
  fromDisplayName: payments.fromDisplayName,
  toMembershipId: payments.toMembershipId,
  toDisplayName: payments.toDisplayName,
  amountMinor: payments.amountMinor,
  createdAt: payments.createdAt,
};

/**
 * One group's recorded payments, newest first.
 *
 * Creation time is the order because it is the only date a payment has — the spec gives it no
 * date field — and the id breaks the tie so the order is total even for two payments written in
 * the same transaction, whose `created_at` is the same transaction clock to the microsecond.
 */
export async function listPayments(db: Db, groupId: string): Promise<PaymentRow[]> {
  return db
    .select(PAYMENT_COLUMNS)
    .from(payments)
    .where(eq(payments.groupId, groupId))
    .orderBy(desc(payments.createdAt), desc(payments.id));
}

/**
 * One payment with both its endpoints, or null when there is no such payment in this group —
 * which is the answer for an id from another group and for a made-up id alike (TR-3).
 *
 * The delete action loads the row it is about to delete inside the transaction it deletes in, so
 * what the activity row records is the payment as it was at the moment it was authorized.
 */
export async function loadPayment(
  db: Db,
  groupId: string,
  paymentId: string,
): Promise<PaymentRow | null> {
  const [payment] = await db
    .select(PAYMENT_COLUMNS)
    .from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.groupId, groupId)))
    .limit(1);

  return payment ?? null;
}
