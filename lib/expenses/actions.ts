'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { withDb, type Db } from '../db/client';
import { activityEvents, expensePayers, expenses, splitLines } from '../db/schema';
import { guardGroup, type GroupAccess } from '../groups/authz';
import { listMembers, type MemberRow } from '../groups/queries';
import {
  ARCHIVED_GROUP_MESSAGE,
  GROUP_NOT_FOUND_MESSAGE,
  UNAUTHENTICATED_MESSAGE,
} from '../groups/validation';
import { splitAmount } from '../money/splits';
import { loadExpense, type ExpenseRecord } from './queries';
import {
  EXPENSE_ADDED,
  EXPENSE_DELETED,
  EXPENSE_NOT_FOUND_MESSAGE,
  EXPENSE_NOTICE_PARAM,
  EXPENSE_UPDATED,
  UNKNOWN_MEMBER_MESSAGE,
  expenseChanges,
  expenseScope,
  parseExpenseInput,
  type ExpenseActionState,
  type ExpenseDraft,
  type ExpenseSnapshot,
} from './validation';

/**
 * Every write to an expense (TR-8, TR-10).
 *
 * The shape is the group actions' shape, deliberately: the caller is resolved from the request's
 * own session, the group comes through `guardGroup`, the input crosses a zod boundary, and the
 * whole change and the activity row that records it commit in **one** interactive transaction.
 * That last part is the one this ticket is really about — an expense with its payers but not its
 * split lines is a group whose balances disagree with its own list, and a transaction is what
 * makes that state unreachable rather than merely unlikely.
 *
 * The guard runs **before** the form is read, which is not just tidiness: the group's currency
 * is what a refusal sentence formats an amount in, so the input cannot be judged until the group
 * is known to exist. It also means a stranger and a made-up id get the same answer no matter
 * what they posted (TR-3).
 *
 * Create and delete redirect to the group, where the new or vanished row is what the caller
 * needs to see, and carry the confirmation as a query value — the form that would show the
 * message is unmounted by the change itself, exactly as it is for the group notices. A refusal
 * never redirects: the form that shows it is still on screen, holding what was typed.
 */

/** The three refusals every action can answer with, said the way the group actions say them. */
const UNAUTHENTICATED_STATE: ExpenseActionState = {
  status: 'error',
  message: UNAUTHENTICATED_MESSAGE,
};
const NOT_FOUND_STATE: ExpenseActionState = { status: 'error', message: GROUP_NOT_FOUND_MESSAGE };
const ARCHIVED_STATE: ExpenseActionState = { status: 'error', message: ARCHIVED_GROUP_MESSAGE };
const EXPENSE_GONE_STATE: ExpenseActionState = {
  status: 'error',
  message: EXPENSE_NOT_FOUND_MESSAGE,
};

function refusal(access: GroupAccess): ExpenseActionState {
  return access.status === 'unauthenticated' ? UNAUTHENTICATED_STATE : NOT_FOUND_STATE;
}

interface Outcome {
  state: ExpenseActionState;
  /** Where a successful action sends the caller, when staying put no longer makes sense. */
  redirectTo?: string;
  /** The group the outcome changed, so the screens that render it are refreshed. */
  groupId?: string;
}

function finish(outcome: Outcome): ExpenseActionState {
  if (outcome.redirectTo) redirect(outcome.redirectTo);
  return outcome.state;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function groupPath(groupId: string): string {
  return `/groups/${groupId}`;
}

/** The group page, carrying what just happened to the expense list that lives there. */
function expenseNoticePath(groupId: string, notice: string): string {
  return `${groupPath(groupId)}?${EXPENSE_NOTICE_PARAM}=${notice}`;
}

function revalidateGroup(groupId?: string): void {
  revalidatePath('/');
  if (groupId) {
    revalidatePath(groupPath(groupId));
    revalidatePath(`${groupPath(groupId)}/members`);
  }
}

/**
 * Everyone named by a draft, resolved to the name their row will carry — or null when somebody
 * in it cannot be named, which is the refusal for a membership id that is not this group's.
 *
 * A submitted id resolves two ways. A current member resolves to the name on their membership,
 * which is what keeps a row reading correctly after a placeholder is claimed and renamed. A seat
 * that is **no longer a member** resolves to the name this expense already snapshotted for them
 * — which is the case ADR-0007 exists for: removing somebody must not erase what they paid or
 * rewrite how the rest of the expense divides, so an edit of an unrelated field has to be able
 * to write their row back exactly as it was. An id that resolves neither way is somebody who was
 * never in this group and never in this expense, and the whole save is refused.
 *
 * The submitted name is never trusted: the form carries ids, and every name here comes from the
 * database.
 */
function resolveNames(
  draft: ExpenseDraft,
  members: readonly MemberRow[],
  previous?: ReadonlyMap<string, string>,
): Map<string, string> | null {
  const byId = new Map(members.map((member) => [member.id, member.displayName]));
  const names = new Map<string, string>();

  for (const membershipId of [
    ...draft.payers.map((payer) => payer.membershipId),
    ...draft.splits.map((line) => line.membershipId),
  ]) {
    const name = byId.get(membershipId) ?? previous?.get(membershipId);
    if (name === undefined) return null;
    names.set(membershipId, name);
  }

  return names;
}

/** The stored name of every seat this expense already has, for the resolution above. */
function storedNames(record: ExpenseRecord): Map<string, string> {
  return new Map(
    [...record.payers, ...record.splits].map((row) => [row.membershipId, row.displayName]),
  );
}

/**
 * A stored expense as the feed compares it, with its participant rows in one stated order.
 *
 * Participants and their inputs are ordered by name so the two sides of an edit are comparable:
 * the form sends the group's order, the ledger holds its own, and two lists that differ only in
 * order are not a change anybody made. Payers are deliberately left in their own order, because
 * there the order *is* data — it is what "the first payer" means for the remainder.
 */
function storedSnapshot(record: ExpenseRecord): ExpenseSnapshot {
  const byName = [...record.splits].sort(
    (left, right) =>
      left.displayName.localeCompare(right.displayName) ||
      left.membershipId.localeCompare(right.membershipId),
  );

  return {
    description: record.description,
    amountMinor: record.amountMinor,
    date: record.date,
    payers: record.payers.map((payer) => ({
      membershipId: payer.membershipId,
      displayName: payer.displayName,
      amountMinor: payer.amountMinor,
    })),
    participants: byName.map((line) => ({
      membershipId: line.membershipId,
      displayName: line.displayName,
      included: line.included,
    })),
    splitType: record.splitType,
    inputs: byName.map((line) => ({ membershipId: line.membershipId, value: line.inputValue })),
    category: record.category,
    note: record.note,
  };
}

/** The same, for the draft a save just produced — ordered the same way, so the diff is a diff. */
function draftSnapshot(draft: ExpenseDraft, names: ReadonlyMap<string, string>): ExpenseSnapshot {
  const byName = [...draft.splits].sort(
    (left, right) =>
      (names.get(left.membershipId) ?? '').localeCompare(names.get(right.membershipId) ?? '') ||
      left.membershipId.localeCompare(right.membershipId),
  );

  return {
    description: draft.description,
    amountMinor: draft.amountMinor,
    date: draft.date,
    payers: draft.payers.map((payer) => ({
      membershipId: payer.membershipId,
      displayName: names.get(payer.membershipId) ?? '',
      amountMinor: payer.amountMinor,
    })),
    participants: byName.map((line) => ({
      membershipId: line.membershipId,
      displayName: names.get(line.membershipId) ?? '',
      included: line.included,
    })),
    splitType: draft.splitType,
    inputs: byName.map((line) => ({
      membershipId: line.membershipId,
      value: line.value,
    })),
    category: draft.category,
    note: draft.note,
  };
}

/**
 * The rows beneath one expense: everyone who paid (in submission order, which the position
 * column preserves), and every member's split line — what they were in the split for, what they
 * typed, and what it came to.
 *
 * The shares are computed here rather than passed in, so the rule and its result are written in
 * the same breath (ADR-0007) and no caller can store a share that does not follow from the
 * expense's own amount and split type.
 */
async function writeExpenseRows(
  tx: Db,
  expenseId: string,
  draft: ExpenseDraft,
  names: ReadonlyMap<string, string>,
): Promise<void> {
  const shares = splitAmount(
    draft.amountMinor,
    draft.splitType,
    draft.splits,
    // The first payer absorbs the rounding remainder; the order they were submitted in is the
    // order the position column keeps.
    draft.payers.map((payer) => payer.membershipId),
  );
  const shareOf = new Map(shares.map((share) => [share.membershipId, share.shareMinor]));

  await tx.insert(expensePayers).values(
    draft.payers.map((payer, index) => ({
      expenseId,
      membershipId: payer.membershipId,
      displayName: names.get(payer.membershipId) ?? '',
      amountMinor: payer.amountMinor,
      position: index,
    })),
  );

  await tx.insert(splitLines).values(
    draft.splits.map((line) => ({
      expenseId,
      membershipId: line.membershipId,
      displayName: names.get(line.membershipId) ?? '',
      included: line.included,
      inputValue: line.value,
      shareMinor: shareOf.get(line.membershipId) ?? 0,
    })),
  );
}

export async function createExpense(
  _previous: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const groupId = field(formData, 'groupId');

  const outcome = await withDb(async (handle): Promise<Outcome> => {
    const access = await guardGroup(handle.db, groupId);
    if (access.status !== 'ok') return { state: refusal(access) };
    if (access.group.archived) return { state: ARCHIVED_STATE };

    const parsed = parseExpenseInput(formData, access.group.currency);
    if (!parsed.ok) {
      return { state: { status: 'error', message: parsed.message, fieldErrors: parsed.fieldErrors } };
    }

    const members = await listMembers(handle.db, access.group.id);
    const names = resolveNames(parsed.draft, members);
    if (!names) return { state: { status: 'error', message: UNKNOWN_MEMBER_MESSAGE } };

    await handle.db.transaction(async (tx) => {
      const [expense] = await tx
        .insert(expenses)
        .values({
          groupId: access.group.id,
          description: parsed.draft.description,
          amountMinor: parsed.draft.amountMinor,
          date: parsed.draft.date,
          category: parsed.draft.category,
          note: parsed.draft.note,
          splitType: parsed.draft.splitType,
        })
        .returning({ id: expenses.id });

      await writeExpenseRows(tx, expense.id, parsed.draft, names);

      // The feed row carries the description as its subject: an expense event is about a thing,
      // not a person, and the thing's name at the moment it happened is what the feed reads.
      await tx.insert(activityEvents).values({
        groupId: access.group.id,
        actorUserId: access.user.id,
        subjectName: parsed.draft.description,
        kind: 'expense-created',
        expenseId: expense.id,
      });
    });

    return {
      state: { status: 'success', message: 'Expense added.' },
      redirectTo: expenseNoticePath(access.group.id, EXPENSE_ADDED),
      groupId: access.group.id,
    };
  });

  revalidateGroup(outcome.groupId);
  return finish(outcome);
}

export async function updateExpense(
  _previous: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const groupId = field(formData, 'groupId');
  const scope = expenseScope.safeParse(field(formData, 'expenseId'));
  // A malformed id is answered before the database sees it, and answered the same way as an id
  // that exists in somebody else's group: there is nothing here that would be true of one and
  // not the other.
  if (!scope.success) return EXPENSE_GONE_STATE;
  const expenseId = scope.data;

  const outcome = await withDb(async (handle): Promise<Outcome> => {
    const access = await guardGroup(handle.db, groupId);
    if (access.status !== 'ok') return { state: refusal(access) };
    if (access.group.archived) return { state: ARCHIVED_STATE };

    const parsed = parseExpenseInput(formData, access.group.currency);
    if (!parsed.ok) {
      return { state: { status: 'error', message: parsed.message, fieldErrors: parsed.fieldErrors } };
    }

    const members = await listMembers(handle.db, access.group.id);

    const result = await handle.db.transaction(async (tx) => {
      // Read inside the transaction the write commits in: the before-half of the activity row
      // and the rows about to be replaced are the same snapshot, so two edits racing cannot
      // each record a before that was already false by the time they committed.
      const record = await loadExpense(tx, access.group.id, expenseId);
      if (!record) return { kind: 'missing' as const };

      const names = resolveNames(parsed.draft, members, storedNames(record));
      if (!names) return { kind: 'unknown-member' as const };

      const before = storedSnapshot(record);
      const after = draftSnapshot(parsed.draft, names);
      const payload = expenseChanges(before, after);

      // A save that changes nothing writes nothing, and above all records nothing: pressing Save
      // twice must not put two "edited" rows in the feed for an edit that happened once.
      if (!payload) return { kind: 'unchanged' as const };

      await tx
        .update(expenses)
        .set({
          description: parsed.draft.description,
          amountMinor: parsed.draft.amountMinor,
          date: parsed.draft.date,
          category: parsed.draft.category,
          note: parsed.draft.note,
          splitType: parsed.draft.splitType,
        })
        .where(eq(expenses.id, expenseId));

      // Replace rather than reconcile: the payers and the split are the expense's whole rule,
      // and a row-by-row merge of two rules is how a stale payer part survives an edit.
      await tx.delete(expensePayers).where(eq(expensePayers.expenseId, expenseId));
      await tx.delete(splitLines).where(eq(splitLines.expenseId, expenseId));
      await writeExpenseRows(tx, expenseId, parsed.draft, names);

      await tx.insert(activityEvents).values({
        groupId: access.group.id,
        actorUserId: access.user.id,
        // The description as it now stands: the payload beside it already carries what it was.
        subjectName: parsed.draft.description,
        kind: 'expense-edited',
        expenseId,
        payload,
      });

      return { kind: 'updated' as const };
    });

    if (result.kind === 'missing') return { state: EXPENSE_GONE_STATE };
    if (result.kind === 'unknown-member') {
      return { state: { status: 'error', message: UNKNOWN_MEMBER_MESSAGE } };
    }

    return {
      state: {
        status: 'success',
        message: result.kind === 'updated' ? 'Expense updated.' : 'Nothing to change.',
      },
      redirectTo: expenseNoticePath(access.group.id, EXPENSE_UPDATED),
      groupId: access.group.id,
    };
  });

  revalidateGroup(outcome.groupId);
  return finish(outcome);
}

export async function deleteExpense(
  _previous: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const groupId = field(formData, 'groupId');
  const scope = expenseScope.safeParse(field(formData, 'expenseId'));
  if (!scope.success) return EXPENSE_GONE_STATE;
  const expenseId = scope.data;

  const outcome = await withDb(async (handle): Promise<Outcome> => {
    const access = await guardGroup(handle.db, groupId);
    if (access.status !== 'ok') return { state: refusal(access) };
    if (access.group.archived) return { state: ARCHIVED_STATE };

    const deleted = await handle.db.transaction(async (tx) => {
      const record = await loadExpense(tx, access.group.id, expenseId);
      if (!record) return null;

      // The payers and the split lines go with it through the cascade, in the same transaction
      // as the expense: there is no window in which the expense is gone and its rows remain.
      await tx.delete(expenses).where(eq(expenses.id, expenseId));

      // Written *after* the delete, and with no expense id, because there is nothing left to
      // point at: the feed row is the record that the expense existed, and the description it
      // carries is what it was called.
      await tx.insert(activityEvents).values({
        groupId: access.group.id,
        actorUserId: access.user.id,
        subjectName: record.description,
        kind: 'expense-deleted',
      });

      return record.description;
    });

    if (deleted === null) return { state: EXPENSE_GONE_STATE };

    return {
      state: { status: 'success', message: `Deleted ${deleted}.` },
      redirectTo: expenseNoticePath(access.group.id, EXPENSE_DELETED),
      groupId: access.group.id,
    };
  });

  revalidateGroup(outcome.groupId);
  return finish(outcome);
}
