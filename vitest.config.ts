import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/examples/**',
        '**/__tests__/test-utils.ts',
      ],
    },
    globals: true,
    setupFiles: ['src/__tests__/setup.ts'],
  },
});
