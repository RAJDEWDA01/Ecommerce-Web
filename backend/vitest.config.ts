import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup-env.ts', './tests/setup-db.ts'],
    testTimeout: 120000,
    hookTimeout: 300000,
  },
});
