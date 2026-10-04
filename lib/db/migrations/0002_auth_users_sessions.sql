-- 0002_auth_users_sessions
-- Accounts and their server-side sessions (TR-6). Hand-reviewed rather than generated: the
-- baseline carries no drizzle journal, so `npm run db:generate` re-emits 0001's ledger table
-- without an `IF NOT EXISTS` guard, and every boot after the first then dies on the
-- already-existing relation (migrate.ts bootstraps the ledger before it reads any file).
--
-- Two rules keep it safe. Every statement below is guarded, so a database that already holds
-- these tables — a second boot, or one created out of band — applies cleanly; and nothing
-- here touches `schema_migrations`, which the runner owns and bootstraps itself.
--
-- An applied filename is immutable. Renaming one makes the ledger forget it and the SQL runs
-- a second time; write a new file instead.
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action
);
