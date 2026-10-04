-- 0001_schema_ledger
-- The ledger the migration runner records itself in. The runner bootstraps this same table
-- before it reads any file, so applying this one is a no-op — it exists so the
-- generate-and-apply loop is exercised end to end from the first migration on.
--
-- An applied filename is immutable. Renaming one makes the ledger forget it and the SQL runs
-- a second time; write a new file instead.
CREATE TABLE IF NOT EXISTS "schema_migrations" (
	"version" text PRIMARY KEY NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
