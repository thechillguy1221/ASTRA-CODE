import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/live/**/*.test.ts'],
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    passWithNoTests: false,
  },
});
