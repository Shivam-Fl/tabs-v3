import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The migration ledger — operational bookkeeping, not a domain table. The migration runner
 * both bootstraps this table and records every file it applies in it, which is what makes a
 * second boot a no-op.
 *
 * Domain tables (users, groups, expenses, payments, activity) belong to the tickets that
 * give them screens. This file is the single source of truth for all of them: edit it, then
 * run `npm run db:generate` rather than hand-writing SQL.
 */
export const schemaMigrations = pgTable('schema_migrations', {
  version: text('version').primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
});
