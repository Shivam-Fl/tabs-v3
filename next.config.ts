import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * The embedded database ships WebAssembly and loads it through Emscripten glue that does not
   * survive bundling — bundled, its first query dies with `instantiateWasm is not a function`
   * and the boot migrations never run. Loaded from node_modules instead, its assets are traced
   * normally and it works exactly as it does in the test suite.
   */
  serverExternalPackages: ['@electric-sql/pglite'],

  /**
   * The migration runner reads `lib/db/migrations/*.sql` at boot, so the SQL has to travel
   * inside the server bundle — a deployment has no source tree to read it from. This is the
   * include that puts it there; `scripts/check-bundle.mjs`-style proof lives in the build
   * artefact (.next/server/**\/*.nft.json), not in this file.
   */
  outputFileTracingIncludes: {
    '/**': ['./lib/db/migrations/**'],
  },
};

export default nextConfig;
