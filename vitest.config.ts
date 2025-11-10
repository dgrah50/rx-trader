import { defineConfig } from 'vitest/config';

const runE2E = process.env.RUN_E2E_TESTS === 'true';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['**/*.test.ts'],
    exclude: ['dist', 'node_modules'],
    coverage: {
      reporter: ['text', 'html']
    },
    poolOptions: runE2E
      ? {
          threads: {
            minThreads: 1,
            maxThreads: 1,
            singleThread: true
          }
        }
      : undefined
  }
});
