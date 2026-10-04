import { defineConfig } from 'vitest/config';

// Unit tests only: no browser, no dev server, no network. scripts/** is included explicitly
// because the seed entry's test lives there and the default include would not reach it.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
