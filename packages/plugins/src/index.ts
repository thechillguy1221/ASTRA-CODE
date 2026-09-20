export type PluginPermission =
  'read_workspace' | 'write_workspace' | 'execute_commands' | 'network' | 'secrets' | 'ui';

export interface PluginManifest {
  id: string;
  name: string;
  publisher: string;
  version: string;
  compatibility: string;
  permissions: PluginPermission[];
  capabilities: string[];
  networkHosts: string[];
  checksum: string;
  signature: string;
  license: string;
  dependencies?: string[];
  bundledSkills?: string[];
  bundledMcp?: string[];
}

export interface InstalledPlugin extends PluginManifest {
  status: 'INSTALLED' | 'ENABLED' | 'DISABLED';
  approvedPermissions: PluginPermission[];
}

export class PluginManager {
  private readonly plugins = new Map<string, InstalledPlugin>();

  install(manifest: PluginManifest): InstalledPlugin {
    if (this.plugins.has(manifest.id)) throw new Error(`Plugin already installed: ${manifest.id}`);
    const plugin = {
      ...manifest,
      permissions: [...manifest.permissions],
      capabilities: [...manifest.capabilities],
      networkHosts: [...manifest.networkHosts],
      ...(manifest.dependencies ? { dependencies: [...manifest.dependencies] } : {}),
      ...(manifest.bundledSkills ? { bundledSkills: [...manifest.bundledSkills] } : {}),
      ...(manifest.bundledMcp ? { bundledMcp: [...manifest.bundledMcp] } : {}),
      status: 'INSTALLED' as const,
      approvedPermissions: [],
    };
    this.plugins.set(plugin.id, plugin);
    return { ...plugin };
  }

  enable(id: string, approvedPermissions: PluginPermission[]): void {
    const plugin = this.require(id);
    if (plugin.permissions.some((permission) => !approvedPermissions.includes(permission)))
      throw new Error('Plugin permissions require explicit approval');
    this.plugins.set(id, {
      ...plugin,
      status: 'ENABLED',
      approvedPermissions: [...approvedPermissions],
    });
  }

  disable(id: string): void {
    this.plugins.set(id, { ...this.require(id), status: 'DISABLED' });
  }

  get(id: string): InstalledPlugin {
    return {
      ...this.require(id),
      permissions: [...this.require(id).permissions],
      capabilities: [...this.require(id).capabilities],
      networkHosts: [...this.require(id).networkHosts],
      approvedPermissions: [...this.require(id).approvedPermissions],
    };
  }

  list(): InstalledPlugin[] {
    return [...this.plugins.keys()].map((id) => this.get(id));
  }

  private require(id: string): InstalledPlugin {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`Plugin not found: ${id}`);
    return plugin;
  }
}
