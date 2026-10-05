import { and, asc, desc, eq, ilike, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { expensePayers, expenses, splitLines } from '../db/schema';
import { listMembers } from '../groups/queries';
import { minorUnitsText, splitValueText, type SplitType } from '../money/splits';
import {
  DEFAULT_EXPENSE_CATEGORY,
  type ExpenseCategory,
  type ExpenseFilters,
} from './validation';

/**
 * The expense reads the group page and the editor render (TR-8).
 *
 * They live beside the boundary rather than inside the pages for the reason the group reads do:
 * "newest first, this group's only" is one query a test can call, not a `where` clause retyped
 * into each screen where a missing `group_id` looks fine on screen until another group's
 * expenses appear in the list.
 *
 * Nothing here decides access. Whether the caller may see the group at all is `guardGroup`'s
 * answer before any of these run, and every one of them takes the group id those reads were
 * authorized for — so the failure mode of forgetting one is an empty list, not a leak.
 */

/** The columns the list and the editor both want, so a field added to one cannot miss the other. */
const EXPENSE_COLUMNS = {
  id: expenses.id,
  description: expenses.description,
  amountMinor: expenses.amountMinor,
  date: expenses.date,
  category: expenses.category,
  note: expenses.note,
  splitType: expenses.splitType,
};

export interface ExpensePayerRow {
  membershipId: string;
  /** The name as it stood when the row was written (ADR-0007) — not a join to the membership. */
  displayName: string;
  amountMinor: number;
  /** Submission order, and what "the first payer" means for the rounding remainder. */
  position: number;
}

export interface ExpenseListRow {
  id: string;
  description: string;
  amountMinor: number;
  date: string;
  category: string;
  splitType: SplitType;
  payers: ExpensePayerRow[];
}

/**
 * One group's expenses, newest day first, with who paid for each.
 *
 * The order is `date desc` with the id breaking a tie, which is exactly the `(group_id, date,
 * id)` index the table carries: two expenses entered on the same day come back in a stable
 * order rather than whatever the planner feels like, which matters because this list is what
 * somebody reads to check yesterday's entry.
 *
 * Payers are a second read rather than a join, because a join would repeat the expense row once
 * per payer and leave the caller to fold them back together. The fold happens here, once, and
 * each expense carries its payers in submission order.
 */
export async function listExpenses(
  db: Db,
  groupId: string,
  filters: ExpenseFilters,
): Promise<ExpenseListRow[]> {
  const conditions = [eq(expenses.groupId, groupId)];

  if (filters.category) conditions.push(eq(expenses.category, filters.category));

  if (filters.search) {
    // The term is data, not a pattern: a description containing `%` is searched for literally
    // rather than matching everything, so the escape character is escaped first.
    const pattern = `%${filters.search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    conditions.push(ilike(expenses.description, pattern));
  }

  if (filters.memberId) {
    const touched = await expenseIdsTouchingMember(db, filters.memberId);
    // Somebody who has paid for nothing and owes nothing is in no expense. Returning early
    // rather than passing an empty list keeps the compiled statement a query with a filter in
    // it, which is the same shape for the planner as any other.
    if (touched.length === 0) return [];
    conditions.push(inArray(expenses.id, touched));
  }

  const rows = await db
    .select(EXPENSE_COLUMNS)
    .from(expenses)
    .where(and(...conditions))
    .orderBy(desc(expenses.date), desc(expenses.id));

  if (rows.length === 0) return [];

  const payerRows = await db
    .select({
      expenseId: expensePayers.expenseId,
      membershipId: expensePayers.membershipId,
      displayName: expensePayers.displayName,
      amountMinor: expensePayers.amountMinor,
      position: expensePayers.position,
    })
    .from(expensePayers)
    .where(
      inArray(
        expensePayers.expenseId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(expensePayers.position));

  const payersByExpense = new Map<string, ExpensePayerRow[]>();
  for (const payer of payerRows) {
    const list = payersByExpense.get(payer.expenseId) ?? [];
    list.push(payer);
    payersByExpense.set(payer.expenseId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    description: row.description,
    amountMinor: row.amountMinor,
    date: row.date,
    category: row.category,
    // The column is text so widening the set is data rather than a migration; the boundary only
    // ever writes a member of the closed set, and the filter only ever matches one.
    splitType: row.splitType as SplitType,
    payers: payersByExpense.get(row.id) ?? [],
  }));
}

/**
 * The expenses one member is part of — the ones they paid towards or were in the split of — as
 * the member filter's id list.
 *
 * Both halves matter: filtering by somebody who paid for everything and owes nothing would show
 * an empty list if only split lines counted, and the point of the filter is "everything I was
 * involved in".
 *
 * `included` is what makes the second half right rather than merely present. Every member the
 * editor offered gets a row, so a row with `included = false` is the record that this member was
 * **left out** of the expense — deliberately, and with a zero share. Counting it as involvement
 * would put an expense on somebody's filter that the group agreed they are not part of, which is
 * the opposite of what the column means. A member who is in the split at zero (an exact part
 * typed as 0.00, a percentage of 0) still counts: they are in it, owing nothing.
 *
 * The list is bounded by the group's own expenses, and the caller intersects it with the group's
 * rows anyway, so ids from anywhere else simply match nothing.
 */
async function expenseIdsTouchingMember(db: Db, membershipId: string): Promise<string[]> {
  const paid = await db
    .select({ id: expensePayers.expenseId })
    .from(expensePayers)
    .where(eq(expensePayers.membershipId, membershipId));

  const inSplit = await db
    .select({ id: splitLines.expenseId })
    .from(splitLines)
    .where(and(eq(splitLines.membershipId, membershipId), eq(splitLines.included, true)));

  return [...new Set([...paid, ...inSplit].map((row) => row.id))];
}

export interface StoredSplitLine {
  membershipId: string;
  displayName: string;
  included: boolean;
  inputValue: number | null;
  shareMinor: number;
}

export interface ExpenseRecord {
  id: string;
  description: string;
  amountMinor: number;
  date: string;
  category: string;
  note: string | null;
  splitType: SplitType;
  payers: ExpensePayerRow[];
  splits: StoredSplitLine[];
}

/**
 * One expense with the rows beneath it, or null when there is no such expense in this group —
 * which is the answer for an id from another group and for a made-up id alike (TR-3).
 *
 * This is the read the edit action loads *inside its transaction* before it writes, so the
 * before-half of the activity row and the row it deletes and replaces are the same snapshot the
 * caller decided against. Read outside the transaction and two edits racing could each record a
 * before that was never true by the time they committed.
 */
export async function loadExpense(
  db: Db,
  groupId: string,
  expenseId: string,
): Promise<ExpenseRecord | null> {
  const [expense] = await db
    .select(EXPENSE_COLUMNS)
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId)))
    .limit(1);

  if (!expense) return null;

  const payers = await db
    .select({
      membershipId: expensePayers.membershipId,
      displayName: expensePayers.displayName,
      amountMinor: expensePayers.amountMinor,
      position: expensePayers.position,
    })
    .from(expensePayers)
    .where(eq(expensePayers.expenseId, expense.id))
    .orderBy(asc(expensePayers.position), asc(expensePayers.membershipId));

  const splits = await db
    .select({
      membershipId: splitLines.membershipId,
      displayName: splitLines.displayName,
      included: splitLines.included,
      inputValue: splitLines.inputValue,
      shareMinor: splitLines.shareMinor,
    })
    .from(splitLines)
    .where(eq(splitLines.expenseId, expense.id))
    .orderBy(asc(splitLines.displayName), asc(splitLines.membershipId));

  return {
    ...expense,
    splitType: expense.splitType as SplitType,
    payers,
    splits,
  };
}

// --- What the editor is handed ---

/**
 * The editor's own shape. Every number is the *text a form field holds* rather than the integer
 * behind it, because the editor is a form: seeding it with "12.50" is what makes reopening an
 * expense show the amount that was typed, and submitting it back sends the same string through
 * the same parser that accepted it the first time.
 */
export interface EditorPayer {
  membershipId: string;
  displayName: string;
  amount: string;
}

export interface EditorParticipant {
  membershipId: string;
  displayName: string;
  included: boolean;
  /** The member's input in the unit their split type names: "12.50", "33.33", "3", or empty. */
  value: string;
}

export interface ExpenseEditorData {
  description: string;
  amount: string;
  date: string;
  category: ExpenseCategory;
  note: string;
  splitType: SplitType;
  payers: EditorPayer[];
  participants: EditorParticipant[];
}

/**
 * Everything the expense editor needs, for a new expense or an existing one.
 *
 * For a **new** expense this is the shape a fresh entry opens on: today's date, the viewer as
 * the one payer, and every member in the split. Most expenses are one person paying for
 * everybody, so the default that needs no edits is the one worth opening on.
 *
 * For an **existing** one it is the stored rule read back into the fields it was entered in:
 * the split type, each member's own input in its own unit, and whether they were in it at all.
 * The order is the group's order, so the rows come back where they were.
 *
 * Two cases need naming. A member who joined *after* the expense was written has no stored line,
 * and comes back **left out** rather than included: including them would silently move money on
 * a save that was supposed to change a note. A participant who is *no longer a member* — ADR-0007
 * keeps them in the ledger — comes back after the current members with the name their row
 * snapshotted, and stays part of the expense until somebody edits them out of it.
 *
 * Null means no such expense in this group, which the edit page turns into a 404.
 */
export async function getExpenseEditorData(
  db: Db,
  groupId: string,
  expenseId: string | null,
  viewerMembershipId: string,
): Promise<ExpenseEditorData | null> {
  const members = await listMembers(db, groupId);

  if (expenseId === null) {
    const viewer = members.find((member) => member.id === viewerMembershipId);

    return {
      description: '',
      amount: '',
      date: today(),
      category: DEFAULT_EXPENSE_CATEGORY,
      note: '',
      splitType: 'equal',
      payers: viewer
        ? [{ membershipId: viewer.id, displayName: viewer.displayName, amount: '' }]
        : [],
      participants: members.map((member) => ({
        membershipId: member.id,
        displayName: member.displayName,
        included: true,
        value: '',
      })),
    };
  }

  const record = await loadExpense(db, groupId, expenseId);
  if (!record) return null;

  const stored = new Map(record.splits.map((line) => [line.membershipId, line]));
  const currentIds = new Set(members.map((member) => member.id));

  /** One row of the split, however much of it there is a stored line for. */
  const asText = (
    membershipId: string,
    displayName: string,
    line: StoredSplitLine | undefined,
  ): EditorParticipant => ({
    membershipId,
    displayName,
    included: line?.included ?? false,
    value: splitValueText(record.splitType, line?.inputValue ?? null),
  });

  return {
    description: record.description,
    amount: minorUnitsText(record.amountMinor),
    date: record.date,
    category: (record.category as ExpenseCategory) ?? DEFAULT_EXPENSE_CATEGORY,
    note: record.note ?? '',
    splitType: record.splitType,
    payers: record.payers.map((payer) => ({
      membershipId: payer.membershipId,
      displayName: payer.displayName,
      amount: minorUnitsText(payer.amountMinor),
    })),
    participants: [
      ...members.map((member) =>
        asText(member.id, member.displayName, stored.get(member.id)),
      ),
      // The seats that are gone: still part of the expense they were in, in the group's own
      // order behind the people who are still here.
      ...record.splits
        .filter((line) => !currentIds.has(line.membershipId))
        .map((line) => asText(line.membershipId, line.displayName, line)),
    ],
  };
}

/** Today, as a date input speaks it. The server's own zone: a group has no time zone to read. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
