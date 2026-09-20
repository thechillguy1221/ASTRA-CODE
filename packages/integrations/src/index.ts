export type ToolSource = 'native' | 'mcp' | 'plugin' | 'api';
export type ToolRisk = 'safe' | 'sensitive' | 'destructive' | 'prohibited';

export interface UnifiedToolDefinition {
  canonicalId: string;
  source: ToolSource;
  description: string;
  risk: ToolRisk;
  permissions: string[];
  workspace?: 'none' | 'selected' | 'all';
  enabled: boolean;
  trust: 'builtin' | 'official' | 'verified' | 'community' | 'local';
  secretHandle?: string;
}

export interface SecretHandle {
  name: string;
  provider: string;
}

export interface ApiOperationDefinition {
  name: string;
  description: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  risk: ToolRisk;
  permissions: string[];
}

export interface ApiIntegrationDefinition {
  id: string;
  name: string;
  baseUrl: string;
  authSecretHandle?: SecretHandle;
  operations: ApiOperationDefinition[];
}

export class ApiIntegrationRegistry {
  private readonly integrations = new Map<string, ApiIntegrationDefinition>();

  register(integration: ApiIntegrationDefinition): void {
    const url = new URL(integration.baseUrl);
    if (url.protocol !== 'https:') throw new Error('API integrations must use HTTPS');
    if (this.integrations.has(integration.id))
      throw new Error(`API integration already registered: ${integration.id}`);
    this.integrations.set(integration.id, {
      ...integration,
      operations: integration.operations.map((operation) => ({
        ...operation,
        permissions: [...operation.permissions],
      })),
    });
  }

  list(): ApiIntegrationDefinition[] {
    return [...this.integrations.values()].map((integration) => ({
      ...integration,
      operations: integration.operations.map((operation) => ({
        ...operation,
        permissions: [...operation.permissions],
      })),
    }));
  }

  tools(): UnifiedToolDefinition[] {
    return this.list().flatMap((integration) =>
      integration.operations.map((operation) => ({
        canonicalId: `api.${integration.id}.${operation.name}`,
        source: 'api' as const,
        description: operation.description,
        risk: operation.risk,
        permissions: [...operation.permissions],
        enabled: true,
        trust: 'verified' as const,
        ...(integration.authSecretHandle
          ? { secretHandle: integration.authSecretHandle.name }
          : {}),
      })),
    );
  }
}

export class UnifiedToolRegistry {
  private readonly tools = new Map<string, UnifiedToolDefinition>();

  register(tool: UnifiedToolDefinition): void {
    if (this.tools.has(tool.canonicalId))
      throw new Error(`Tool already registered: ${tool.canonicalId}`);
    this.tools.set(tool.canonicalId, { ...tool, permissions: [...tool.permissions] });
  }

  get(canonicalId: string): UnifiedToolDefinition | undefined {
    const tool = this.tools.get(canonicalId);
    return tool ? { ...tool, permissions: [...tool.permissions] } : undefined;
  }

  search(query: string): UnifiedToolDefinition[] {
    const normalized = query.toLowerCase();
    return [...this.tools.values()]
      .filter(
        (tool) =>
          tool.enabled &&
          `${tool.canonicalId} ${tool.description}`.toLowerCase().includes(normalized),
      )
      .map((tool) => ({ ...tool, permissions: [...tool.permissions] }));
  }

  list(): UnifiedToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      ...tool,
      permissions: [...tool.permissions],
    }));
  }
}
