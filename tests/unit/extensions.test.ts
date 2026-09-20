import { describe, expect, it } from 'vitest';
import { createEssentialsRegistry, SkillRouter } from '@lyntar/skills';
import { McpManager } from '@lyntar/mcp';
import { PluginManager } from '@lyntar/plugins';
import { ApiIntegrationRegistry, UnifiedToolRegistry } from '@lyntar/integrations';

describe('extension boundaries', () => {
  it('routes only relevant built-in Skills and loads instructions progressively', () => {
    const registry = createEssentialsRegistry();
    const router = new SkillRouter(registry);
    expect(router.list().every((skill) => skill.instruction === undefined)).toBe(true);
    const selected = router.route(
      'Review the authentication and payment security before completion',
    );
    expect(selected.map((skill) => skill.id)).toEqual(
      expect.arrayContaining(['security-review', 'verification']),
    );
    expect(selected[0]?.instruction).toBeUndefined();
    expect(router.load(selected[0]?.id ?? '').instruction).toMatch(/security/i);
    expect(
      router.load('security-review').resources.some((resource) => resource.path === 'SKILL.md'),
    ).toBe(true);
  });

  it('namespaces MCP tools and requires a scoped connection', () => {
    const manager = new McpManager();
    const connection = manager.add({
      id: 'github',
      name: 'GitHub',
      transport: 'http',
      endpoint: 'https://mcp.example.test',
      scopes: {
        network: true,
        credentials: ['github-production'],
        tools: ['create_issue'],
        destructiveActions: false,
        workspace: 'none',
      },
    });
    expect(connection.state).toBe('DISCONNECTED');
    manager.connect('github');
    manager.registerTools('github', [
      { name: 'create_issue', description: 'Create issue', risk: 'sensitive' },
    ]);
    expect(manager.listTools()[0]?.canonicalName).toBe('github.create_issue');
    expect(() => manager.authorizeTool('github.create_issue', 'destructive')).toThrow('scope');
  });

  it('does not enable a Plugin until declared permissions are explicitly approved', () => {
    const manager = new PluginManager();
    manager.install({
      id: 'test.plugin',
      name: 'Test',
      publisher: 'Astra AI',
      version: '1.0.0',
      compatibility: '^0.1.0',
      permissions: ['read_workspace', 'network'],
      capabilities: ['tools'],
      networkHosts: ['api.example.test'],
      checksum: 'sha256:test',
      signature: 'sig:test',
      license: 'UNLICENSED',
    });
    expect(() => manager.enable('test.plugin', ['read_workspace'])).toThrow('permissions');
    manager.enable('test.plugin', ['read_workspace', 'network']);
    expect(manager.get('test.plugin').status).toBe('ENABLED');
  });

  it('provides a searchable unified registry without exposing raw secrets', () => {
    const registry = new UnifiedToolRegistry();
    registry.register({
      canonicalId: 'native.workspace.readFile',
      source: 'native',
      description: 'Read a workspace file',
      risk: 'safe',
      permissions: ['read_workspace'],
      enabled: true,
      trust: 'builtin',
    });
    registry.register({
      canonicalId: 'github.create_issue',
      source: 'mcp',
      description: 'Create a GitHub issue',
      risk: 'sensitive',
      permissions: ['network'],
      enabled: true,
      trust: 'verified',
      secretHandle: 'github-production',
    });
    expect(registry.search('github')).toHaveLength(1);
    expect(JSON.stringify(registry.search('github'))).not.toContain('token');
    expect(registry.get('github.create_issue')?.secretHandle).toBe('github-production');
  });

  it('turns HTTPS API integrations into controlled tools with secret handles', () => {
    const integrations = new ApiIntegrationRegistry();
    integrations.register({
      id: 'github',
      name: 'GitHub',
      baseUrl: 'https://api.github.com',
      authSecretHandle: { name: 'github-production', provider: 'secret-store' },
      operations: [
        {
          name: 'create_issue',
          description: 'Create a GitHub issue',
          method: 'POST',
          path: '/repos/{owner}/{repo}/issues',
          risk: 'sensitive',
          permissions: ['network'],
        },
      ],
    });
    expect(integrations.tools()[0]?.canonicalId).toBe('api.github.create_issue');
    expect(integrations.tools()[0]?.secretHandle).toBe('github-production');
    expect(JSON.stringify(integrations.tools())).not.toContain('token');
    expect(() =>
      integrations.register({
        id: 'insecure',
        name: 'Insecure',
        baseUrl: 'http://api.example.test',
        operations: [],
      }),
    ).toThrow('HTTPS');
  });
});
