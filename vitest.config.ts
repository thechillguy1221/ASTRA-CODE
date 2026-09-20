import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const repositoryRoot = resolve(import.meta.dirname);

const sourceAliases = {
  '@lyntar/agent-core': resolve(repositoryRoot, 'packages/agent-core/src/index.ts'),
  '@lyntar/api': resolve(repositoryRoot, 'apps/api/src/index.ts'),
  '@lyntar/web': resolve(repositoryRoot, 'apps/web/src/routes.ts'),
  '@lyntar/admin': resolve(repositoryRoot, 'apps/admin/src/access.ts'),
  '@lyntar/auth': resolve(repositoryRoot, 'packages/auth/src/index.ts'),
  '@lyntar/billing': resolve(repositoryRoot, 'packages/billing/src/index.ts'),
  '@lyntar/plans': resolve(repositoryRoot, 'packages/plans/src/index.ts'),
  '@lyntar/skills': resolve(repositoryRoot, 'packages/skills/src/index.ts'),
  '@lyntar/mcp': resolve(repositoryRoot, 'packages/mcp/src/index.ts'),
  '@lyntar/plugins': resolve(repositoryRoot, 'packages/plugins/src/index.ts'),
  '@lyntar/integrations': resolve(repositoryRoot, 'packages/integrations/src/index.ts'),
  '@lyntar/modes': resolve(repositoryRoot, 'packages/modes/src/index.ts'),
  '@lyntar/releases': resolve(repositoryRoot, 'packages/releases/src/index.ts'),
  '@lyntar/email': resolve(repositoryRoot, 'packages/email/src/index.ts'),
  '@lyntar/observability': resolve(repositoryRoot, 'packages/observability/src/index.ts'),
  '@lyntar/marketplace': resolve(repositoryRoot, 'packages/marketplace/src/index.ts'),
  '@lyntar/config': resolve(repositoryRoot, 'packages/config/src/index.ts'),
  '@lyntar/contracts': resolve(repositoryRoot, 'packages/contracts/src/index.ts'),
  '@lyntar/remote-protocol': resolve(repositoryRoot, 'packages/remote-protocol/src/index.ts'),
  '@lyntar/db': resolve(repositoryRoot, 'packages/db/src/index.ts'),
  '@lyntar/model-gateway': resolve(repositoryRoot, 'packages/model-gateway/src/index.ts'),
  '@lyntar/test-utils': resolve(repositoryRoot, 'packages/test-utils/src/index.ts'),
  '@lyntar/workspace': resolve(repositoryRoot, 'packages/workspace/src/index.ts'),
  '@lyntar/codex-runtime': resolve(repositoryRoot, 'packages/codex-runtime/src/index.ts'),
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
