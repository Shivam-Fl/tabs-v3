-- 0004_expenses
-- The expense ledger: expenses, what each member paid, what each member owes, and the two
-- columns the activity feed needs to record an expense event (TR-8, TR-10). Hand-written for
-- the same reason 0002 and 0003 are: the baseline carries no drizzle journal, so
-- `npm run db:generate` re-emits 0001's ledger table without an `IF NOT EXISTS` guard and every
-- boot after the first dies on the already-existing relation.
--
-- Every statement is guarded, so a database that already holds these tables applies cleanly, and
-- nothing here touches `schema_migrations` — the runner owns and bootstraps that itself. An
-- applied filename is immutable: renaming one makes the ledger forget it and the SQL runs twice.
--
-- `expense_payers.membership_id` and `split_lines.membership_id` carry no foreign key on
-- purpose (ADR-0007): removing a member must not erase who paid for what or rewrite the other
-- members' balances, so each write validates the id inside its own transaction and snapshots
-- the name beside it. `input_value` is nullable because an equal split has no input to store,
-- and `activity_event.expense_id` is `set null` rather than cascading so an expense-deleted
-- feed row outlives the delete that produced it.
CREATE TABLE IF NOT EXISTS "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"date" date NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"note" text,
	"split_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expense_payers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "expense_payers_expense_id_membership_id_unique" UNIQUE("expense_id","membership_id"),
	CONSTRAINT "expense_payers_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "split_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"included" boolean DEFAULT true NOT NULL,
	"input_value" integer,
	"share_minor" integer NOT NULL,
	CONSTRAINT "split_lines_expense_id_membership_id_unique" UNIQUE("expense_id","membership_id"),
	CONSTRAINT "split_lines_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_group_id_date_id_idx" ON "expenses" ("group_id","date","id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_payers_expense_id_idx" ON "expense_payers" ("expense_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_payers_membership_id_idx" ON "expense_payers" ("membership_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "split_lines_expense_id_idx" ON "split_lines" ("expense_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "split_lines_membership_id_idx" ON "split_lines" ("membership_id");
--> statement-breakpoint
-- The feed's two new columns. `ADD COLUMN IF NOT EXISTS` is idempotent on its own, which the
-- foreign key below is not: Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, so it is guarded by
-- asking the catalogue whether the constraint is already there.
ALTER TABLE "activity_event" ADD COLUMN IF NOT EXISTS "expense_id" uuid;
--> statement-breakpoint
ALTER TABLE "activity_event" ADD COLUMN IF NOT EXISTS "payload" jsonb;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'activity_event_expense_id_expenses_id_fk'
	) THEN
		ALTER TABLE "activity_event"
			ADD CONSTRAINT "activity_event_expense_id_expenses_id_fk"
			FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
