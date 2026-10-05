import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { ExpenseEditPayload } from '../expenses/validation';
import type { PaymentSnapshot } from '../settle/validation';

/**
 * The migration ledger — operational bookkeeping, not a domain table. The migration runner
 * both bootstraps this table and records every file it applies in it, which is what makes a
 * second boot a no-op.
 *
 * Domain tables belong to the tickets that give them screens. This file is the single source
 * of truth for all of them — but the baseline carries no drizzle journal, so `npm run
 * db:generate` re-emits this ledger table with no `IF NOT EXISTS` guard and every boot after
 * the first dies on the already-existing relation. Until the journal exists, write the
 * migration by hand beside the schema edit, guard every statement, and never put ledger DDL
 * in a migration file.
 */
export const schemaMigrations = pgTable('schema_migrations', {
  version: text('version').primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Accounts (TR-6). The email is the identity and the sign-in key, so it is unique and stored
 * normalized — `lib/auth/validation.ts` owns that normalization and every read and write goes
 * through it. `currency` is the default the profile edits; the group-currency tickets read it
 * from here. `password_hash` carries its algorithm and cost in the hash itself (ADR-0004), so
 * a future migration to argon2id can re-hash on next sign-in without a second column.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  currency: text('currency').notNull().default('INR'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Server-side sessions (ADR-0003). The row holds a hash of the opaque token, never the token
 * itself — a leaked database yields nothing that can be replayed, because the hash is also
 * peppered with SESSION_SECRET. Sign-out is a row delete, which is the whole reason sessions
 * live here rather than in a JWT. Deleting a user takes their sessions with them.
 */
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Groups (TR-7). `type` is the closed set from the spec (trip/home/couple/other) and stays a
 * text column so widening it is data, not a migration; `currency` is what every amount in the
 * group is formatted and grouped by, and is *not* the same column as the member's default —
 * a group keeps the currency it was created with even if the owner later changes their profile.
 *
 * `invite_token` is nullable-unique on purpose: a group with the link disabled still holds its
 * token (rotating is what replaces it), and Postgres treats every NULL as distinct, so a group
 * can be left without one. The enabled flag, not the constraint, is what a joiner is checked
 * against. `archived` hides the group from the home list and turns its writes off; there is no
 * unarchive in this ticket.
 */
export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  currency: text('currency').notNull().default('INR'),
  type: text('type').notNull().default('other'),
  inviteToken: text('invite_token').unique(),
  inviteEnabled: boolean('invite_enabled').notNull().default(true),
  archived: boolean('archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Membership (TRD "Membership"): the row that links a person to a group, and the only thing the
 * authorization guard reads. A placeholder — somebody recorded by name before they have an
 * account — is the same row with `user_id` null, which is what makes claiming it the join
 * rather than a step before one: the claim sets `user_id` on the row that already exists.
 *
 * `(group_id, user_id)` is unique so one account holds exactly one row per group; it is also
 * what rejects a member claiming a second seat. Because Postgres treats NULLs as distinct, that
 * constraint does not stop a group holding many unclaimed placeholders.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    role: text('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('memberships_group_id_user_id_unique').on(table.groupId, table.userId),
    index('memberships_group_id_idx').on(table.groupId),
  ],
);

/**
 * The rows of the activity feed (TR-10). A row is written in the same transaction as the change
 * it records, so the feed can never disagree with the tables it describes.
 *
 * `actor_user_id` is who did it, `subject_*` is who it happened to: for a join, a claim and a
 * leave they are the same person, but a removal is the owner acting on somebody else, and a
 * feed that stored only the actor could not say who was removed. The subject name is copied
 * rather than joined because the membership row it came from is deleted by the event that
 * records it, and a placeholder being removed has no user id to join to at all.
 *
 * An expense event has no user subject at all — it is about a thing, not a person — so
 * `subject_name` carries the expense's description at the moment of the event and
 * `subject_user_id` stays null. `expense_id` is the link back to what it acted on, and it is
 * `set null` rather than cascading because an expense-deleted row must outlive the delete that
 * produced it: the feed is the record that the expense existed.
 *
 * A payment event is the same shape as an expense one — it is about a thing — except that the
 * thing is a payment, so `payment_id` is its link back (also `set null`, for the same reason)
 * and `subject_name` carries a sentence naming the two endpoints. Its `payload` is the payment
 * snapshot rather than an edit diff: because the link is nulled when the payment is deleted,
 * the snapshot is the only thing left that can render a payment-deleted row (TR-9, TR-10).
 *
 * `payload` is the structured half of TR-10's expense-edited row — the before and after of the
 * fields that changed — and of the two payment kinds, which carry their snapshot; it stays null
 * on every other kind, which needs no more than its actor, subject and timestamp.
 */
export const activityEvents = pgTable(
  'activity_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subjectUserId: uuid('subject_user_id').references(() => users.id, { onDelete: 'set null' }),
    subjectName: text('subject_name').notNull(),
    kind: text('kind').notNull(),
    expenseId: uuid('expense_id').references(() => expenses.id, { onDelete: 'set null' }),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    payload: jsonb('payload').$type<ExpenseEditPayload | PaymentSnapshot>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('activity_event_group_id_created_at_idx').on(table.groupId, table.createdAt)],
);

/**
 * Expenses (TR-8): the ledger everything else derives from. `amount_minor` is the whole, in
 * integer minor units — the only shape money is ever stored in — and `split_type` names the
 * rule that produced the split lines beside it, because ADR-0007 stores the rule with its
 * result rather than trying to recover it from the computed shares.
 *
 * `date` is a `date`, not a timestamp: an expense happens on a day, the viewer's time zone must
 * not move it, and `mode: 'string'` keeps it the `YYYY-MM-DD` a date input speaks rather than a
 * Date object that has to survive JSON, a time zone and a round trip to stay the same day.
 *
 * The index is `(group_id, date, id)` because that is what narrows the group page's "newest
 * first" read to one group's rows, newest day first. It no longer covers that read end to end:
 * two expenses on the same day are ordered by `created_at` (the order they were entered, which
 * a random uuid cannot give) and only then by `id`, so the same-day rows are sorted after the
 * scan rather than by the index.
 */
export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    category: text('category').notNull().default('other'),
    note: text('note'),
    splitType: text('split_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('expenses_group_id_date_id_idx').on(table.groupId, table.date, table.id)],
);

/**
 * What each member paid towards one expense: one row per payer, and the rows sum to the
 * expense's total (validated at the boundary before anything is written).
 *
 * There is deliberately **no foreign key to `memberships`**, which is the ADR-0007 trade: a
 * group that removes a member must not erase who paid for what or rewrite everyone else's
 * balance, so the reference is an id validated inside the same transaction and the name is a
 * snapshot taken at write time. The row outlives the seat, and reads by that seat still find it.
 *
 * `(expense_id, membership_id)` is unique because one member paying twice towards one expense
 * is two parts of the same number, not two rows. `position` is the order they were entered in,
 * which is what "the first payer" means for the rounding remainder and what makes an edit that
 * changes nothing else leave the remainder where it was.
 */
export const expensePayers = pgTable(
  'expense_payers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expenseId: uuid('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id').notNull(),
    displayName: text('display_name').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    position: integer('position').notNull().default(0),
  },
  (table) => [
    unique('expense_payers_expense_id_membership_id_unique').on(
      table.expenseId,
      table.membershipId,
    ),
    index('expense_payers_expense_id_idx').on(table.expenseId),
    index('expense_payers_membership_id_idx').on(table.membershipId),
  ],
);

/**
 * What each member owes: the input they entered, whether they were in the split at all, and the
 * share that input computes to (ADR-0007, TRD "SplitLine").
 *
 * Both halves are stored on purpose. `share_minor` is the result every balance and debt reads —
 * one derived path, never recomputed on read — while `input_value` is what the person typed, in
 * the unit the expense's `split_type` names: minor units for `exact`, basis points for
 * `percentage` (33.33% is 3333), a count for `shares`, and null for `equal`, where there is
 * nothing to type. Reopening the editor from `share_minor` alone could not recover the rule:
 * a typed 33.33% and a typed exact amount can round to the same share, so the form would come
 * back showing a rule nobody entered. `included` is the third thing the person decided — a
 * member can be left out — and it is what makes a zero-share row mean "deliberately out"
 * rather than "missing".
 *
 * No membership foreign key, for the same reason `expense_payers` has none.
 */
export const splitLines = pgTable(
  'split_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expenseId: uuid('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id').notNull(),
    displayName: text('display_name').notNull(),
    included: boolean('included').notNull().default(true),
    inputValue: integer('input_value'),
    shareMinor: integer('share_minor').notNull(),
  },
  (table) => [
    unique('split_lines_expense_id_membership_id_unique').on(table.expenseId, table.membershipId),
    index('split_lines_expense_id_idx').on(table.expenseId),
    index('split_lines_membership_id_idx').on(table.membershipId),
  ],
);

/**
 * Settle-up payments (TR-9): the other half of the ledger balances derive from. A payment is a
 * transfer of value between two seats — the payer's balance rises by the amount, the
 * recipient's falls by it — and it is a *ledger entry*, never an edit to a balance, which is
 * what keeps "balances are derived and never stored" true (TR-9, invariants).
 *
 * Neither endpoint carries a foreign key to `memberships`, for the reason `expense_payers`
 * has none (ADR-0007): a group that removes a member must not erase what was paid, and the
 * stranded net a departed seat can carry is exactly what a payment to that seat exists to
 * clear. Each id is validated inside the write's own transaction against the guarded group's
 * ledger, and the display name is snapshotted beside it so a row outlives the seat it names.
 *
 * `created_at` is the order the feed reads them in, and the only date a payment has — the spec
 * gives a payment no date picker, so when it was recorded is when it happened.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    fromMembershipId: uuid('from_membership_id').notNull(),
    fromDisplayName: text('from_display_name').notNull(),
    toMembershipId: uuid('to_membership_id').notNull(),
    toDisplayName: text('to_display_name').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('payments_group_id_id_idx').on(table.groupId, table.id)],
);
