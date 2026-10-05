-- 0003_groups_memberships
-- Groups, their memberships and the member rows of the activity feed (TR-7, TR-10). Hand-written
-- for the same reason 0002 is: the baseline carries no drizzle journal, so `npm run db:generate`
-- re-emits 0001's ledger table without an `IF NOT EXISTS` guard and every boot after the first
-- dies on the already-existing relation.
--
-- Every statement is guarded, so a database that already holds these tables applies cleanly, and
-- nothing here touches `schema_migrations` — the runner owns and bootstraps that itself. An
-- applied filename is immutable: renaming one makes the ledger forget it and the SQL runs twice.
--
-- `memberships.user_id` is nullable by design (a placeholder is a row with no account yet) and
-- `(group_id, user_id)` is unique so one account holds one row per group. Postgres treats every
-- NULL as distinct, so that constraint still permits many unclaimed placeholders in one group.
CREATE TABLE IF NOT EXISTS "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"type" text DEFAULT 'other' NOT NULL,
	"invite_token" text,
	"invite_enabled" boolean DEFAULT true NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_invite_token_unique" UNIQUE("invite_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid,
	"display_name" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_group_id_user_id_unique" UNIQUE("group_id","user_id"),
	CONSTRAINT "memberships_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activity_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"subject_user_id" uuid,
	"subject_name" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_event_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "activity_event_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "activity_event_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_group_id_idx" ON "memberships" ("group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_event_group_id_created_at_idx" ON "activity_event" ("group_id","created_at");
