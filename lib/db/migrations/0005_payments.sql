-- 0005_payments
-- The settle-up ledger: the payments members record against each other, and the column the
-- activity feed needs to link a payment event (TR-9, TR-10). Hand-written for the same reason
-- 0002, 0003 and 0004 are: the baseline carries no drizzle journal, so `npm run db:generate`
-- re-emits 0001's ledger table without an `IF NOT EXISTS` guard and every boot after the first
-- dies on the already-existing relation.
--
-- Every statement is guarded, so a database that already holds these tables applies cleanly, and
-- nothing here touches `schema_migrations` — the runner owns and bootstraps that itself. An
-- applied filename is immutable: renaming one makes the ledger forget it and the SQL runs twice.
--
-- `from_membership_id` and `to_membership_id` carry no foreign key on purpose (ADR-0007): a
-- payment made to a seat whose membership row is later deleted must keep moving that seat's
-- balance, so each write validates the ids inside its own transaction and snapshots the names
-- beside them. The row outlives the seat it names, and a payment-deleted feed row outlives the
-- payment, because `activity_event.payment_id` is `set null` rather than cascading.
CREATE TABLE IF NOT EXISTS "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"from_membership_id" uuid NOT NULL,
	"from_display_name" text NOT NULL,
	"to_membership_id" uuid NOT NULL,
	"to_display_name" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_group_id_id_idx" ON "payments" ("group_id","id");
--> statement-breakpoint
-- The feed's new column. `ADD COLUMN IF NOT EXISTS` is idempotent on its own, which the foreign
-- key below is not: Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, so it is guarded by asking
-- the catalogue whether the constraint is already there, exactly as 0004 does for expense_id.
ALTER TABLE "activity_event" ADD COLUMN IF NOT EXISTS "payment_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'activity_event_payment_id_payments_id_fk'
	) THEN
		ALTER TABLE "activity_event"
			ADD CONSTRAINT "activity_event_payment_id_payments_id_fk"
			FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
