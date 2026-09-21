import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const repositoryRoot = resolve(import.meta.dirname);

const sourceAliases = {
  '@astra/agent-core': resolve(repositoryRoot, 'packages/agent-core/src/index.ts'),
  '@astra/api': resolve(repositoryRoot, 'apps/api/src/index.ts'),
  '@astra/web': resolve(repositoryRoot, 'apps/web/src/routes.ts'),
  '@astra/admin': resolve(repositoryRoot, 'apps/admin/src/access.ts'),
  '@astra/auth': resolve(repositoryRoot, 'packages/auth/src/index.ts'),
  '@astra/billing': resolve(repositoryRoot, 'packages/billing/src/index.ts'),
  '@astra/plans': resolve(repositoryRoot, 'packages/plans/src/index.ts'),
  '@astra/skills': resolve(repositoryRoot, 'packages/skills/src/index.ts'),
  '@astra/mcp': resolve(repositoryRoot, 'packages/mcp/src/index.ts'),
  '@astra/plugins': resolve(repositoryRoot, 'packages/plugins/src/index.ts'),
  '@astra/integrations': resolve(repositoryRoot, 'packages/integrations/src/index.ts'),
  '@astra/modes': resolve(repositoryRoot, 'packages/modes/src/index.ts'),
  '@astra/releases': resolve(repositoryRoot, 'packages/releases/src/index.ts'),
  '@astra/email': resolve(repositoryRoot, 'packages/email/src/index.ts'),
  '@astra/observability': resolve(repositoryRoot, 'packages/observability/src/index.ts'),
  '@astra/marketplace': resolve(repositoryRoot, 'packages/marketplace/src/index.ts'),
  '@astra/config': resolve(repositoryRoot, 'packages/config/src/index.ts'),
  '@astra/contracts': resolve(repositoryRoot, 'packages/contracts/src/index.ts'),
  '@astra/remote-protocol': resolve(repositoryRoot, 'packages/remote-protocol/src/index.ts'),
  '@astra/db': resolve(repositoryRoot, 'packages/db/src/index.ts'),
  '@astra/model-gateway': resolve(repositoryRoot, 'packages/model-gateway/src/index.ts'),
  '@astra/test-utils': resolve(repositoryRoot, 'packages/test-utils/src/index.ts'),
  '@astra/workspace': resolve(repositoryRoot, 'packages/workspace/src/index.ts'),
  '@astra/codex-runtime': resolve(repositoryRoot, 'packages/codex-runtime/src/index.ts'),
  '@astra/web-research': resolve(repositoryRoot, 'packages/web-research/src/index.ts'),
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
