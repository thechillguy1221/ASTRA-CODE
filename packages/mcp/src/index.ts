export type McpTransport = 'stdio' | 'http' | 'streamable-http';
export type McpConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';
export type McpToolRisk = 'safe' | 'sensitive' | 'destructive';

export interface McpScopes {
  network: boolean;
  credentials: string[];
  tools: string[];
  destructiveActions: boolean;
  workspace: 'none' | 'selected' | 'all';
}

export interface McpConnection {
  id: string;
  name: string;
  transport: McpTransport;
  endpoint: string;
  scopes: McpScopes;
  state: McpConnectionState;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  risk: McpToolRisk;
}

export interface NamespacedMcpTool extends McpToolDefinition {
  canonicalName: string;
  serverId: string;
}

export class McpManager {
  private readonly connections = new Map<string, McpConnection>();
  private readonly tools = new Map<string, NamespacedMcpTool>();

  add(input: Omit<McpConnection, 'state'>): McpConnection {
    if (this.connections.has(input.id))
      throw new Error(`MCP connection already exists: ${input.id}`);
    const connection = { ...input, state: 'DISCONNECTED' as const };
    this.connections.set(input.id, connection);
    return {
      ...connection,
      scopes: {
        ...connection.scopes,
        credentials: [...connection.scopes.credentials],
        tools: [...connection.scopes.tools],
      },
    };
  }

  connect(id: string): void {
    const connection = this.require(id);
    this.connections.set(id, { ...connection, state: 'CONNECTED' });
  }

  disconnect(id: string): void {
    const connection = this.require(id);
    this.connections.set(id, { ...connection, state: 'DISCONNECTED' });
  }

  registerTools(serverId: string, definitions: McpToolDefinition[]): void {
    const connection = this.require(serverId);
    if (connection.state !== 'CONNECTED')
      throw new Error('MCP server must be connected before registering tools');
    for (const definition of definitions) {
      if (!connection.scopes.tools.includes(definition.name))
        throw new Error(`Tool ${definition.name} is outside the declared MCP scope`);
      const canonicalName = `${serverId}.${definition.name}`;
      this.tools.set(canonicalName, { ...definition, canonicalName, serverId });
    }
  }

  listTools(): NamespacedMcpTool[] {
    return [...this.tools.values()].map((tool) => ({ ...tool }));
  }

  authorizeTool(canonicalName: string, requestedRisk: McpToolRisk): void {
    const tool = this.tools.get(canonicalName);
    if (!tool) throw new Error('MCP tool not found');
    const connection = this.require(tool.serverId);
    if (requestedRisk === 'destructive' && !connection.scopes.destructiveActions)
      throw new Error('MCP destructive action is outside the connection scope');
    if (
      requestedRisk === 'sensitive' &&
      connection.scopes.credentials.length === 0 &&
      connection.scopes.network === false
    )
      throw new Error('MCP sensitive action lacks a declared scope');
  }

  listConnections(): McpConnection[] {
    return [...this.connections.values()].map((connection) => ({
      ...connection,
      scopes: {
        ...connection.scopes,
        credentials: [...connection.scopes.credentials],
        tools: [...connection.scopes.tools],
      },
    }));
  }

  private require(id: string): McpConnection {
    const connection = this.connections.get(id);
    if (!connection) throw new Error(`MCP connection not found: ${id}`);
    return connection;
  }
}
