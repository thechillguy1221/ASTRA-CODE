import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const repositoryRoot = resolve(import.meta.dirname);

const sourceAliases = {
  '@lyntar/agent-core': resolve(repositoryRoot, 'packages/agent-core/src/index.ts'),
  '@lyntar/api': resolve(repositoryRoot, 'apps/api/src/index.ts'),
  '@lyntar/config': resolve(repositoryRoot, 'packages/config/src/index.ts'),
  '@lyntar/contracts': resolve(repositoryRoot, 'packages/contracts/src/index.ts'),
  '@lyntar/db': resolve(repositoryRoot, 'packages/db/src/index.ts'),
  '@lyntar/model-gateway': resolve(repositoryRoot, 'packages/model-gateway/src/index.ts'),
  '@lyntar/test-utils': resolve(repositoryRoot, 'packages/test-utils/src/index.ts'),
  '@lyntar/workspace': resolve(repositoryRoot, 'packages/workspace/src/index.ts'),
};

export default defineConfig({
  resolve: { alias: sourceAliases },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/live/**'],
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    passWithNoTests: false,
  },
});
