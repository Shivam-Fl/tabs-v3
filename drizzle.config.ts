import { defineConfig } from 'drizzle-kit';
import { connectionString } from './lib/db/client';

/**
 * Generate only. Applying SQL is the migration runner's job at boot and in `npm run db:migrate`,
 * so this file never becomes a second place that decides which backend is active — it asks the
 * database client for the connection string the same way everything else does, and works with
 * none configured (`generate` needs no connection).
 */
const url = connectionString();

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  ...(url ? { dbCredentials: { url } } : {}),
});
