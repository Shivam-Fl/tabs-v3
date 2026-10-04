import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
