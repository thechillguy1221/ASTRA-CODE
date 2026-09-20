export type MarketplaceItemType = 'skill' | 'plugin' | 'mcp';
export type MarketplaceTrust = 'Lyntar Official' | 'Verified Publisher' | 'Community' | 'Local';

export interface MarketplaceListing {
  id: string;
  type: MarketplaceItemType;
  name: string;
  publisher: string;
  version: string;
  description: string;
  permissions: string[];
  dependencies: string[];
  license: string;
  compatibility: string;
  trust: MarketplaceTrust;
  checksum: string;
  signature: string;
}

export interface InstalledMarketplaceItem extends MarketplaceListing {
  status: 'INSTALLED';
  approvedPermissions: string[];
  installedAt: string;
}

export class MarketplaceRegistry {
  private readonly listings = new Map<string, MarketplaceListing>();
  private readonly installed = new Map<string, InstalledMarketplaceItem>();

  publish(listing: MarketplaceListing): void {
    if (this.listings.has(listing.id))
      throw new Error(`Marketplace listing already exists: ${listing.id}`);
    if (!listing.checksum || !listing.signature)
      throw new Error('Marketplace packages require checksum and signature');
    this.listings.set(listing.id, {
      ...listing,
      permissions: [...listing.permissions],
      dependencies: [...listing.dependencies],
    });
  }

  list(): MarketplaceListing[] {
    return [...this.listings.values()].map((listing) => ({
      ...listing,
      permissions: [...listing.permissions],
      dependencies: [...listing.dependencies],
    }));
  }

  install(
    id: string,
    input: { checksum: string; signature: string; approvedPermissions: string[] },
  ): InstalledMarketplaceItem {
    const listing = this.listings.get(id);
    if (!listing) throw new Error(`Marketplace listing not found: ${id}`);
    if (input.checksum !== listing.checksum)
      throw new Error('Marketplace checksum verification failed');
    if (input.signature !== listing.signature)
      throw new Error('Marketplace signature verification failed');
    if (listing.permissions.some((permission) => !input.approvedPermissions.includes(permission)))
      throw new Error('Marketplace permissions require explicit approval');
    const installed: InstalledMarketplaceItem = {
      ...listing,
      permissions: [...listing.permissions],
      dependencies: [...listing.dependencies],
      approvedPermissions: [...input.approvedPermissions],
      status: 'INSTALLED',
      installedAt: new Date().toISOString(),
    };
    this.installed.set(id, installed);
    return {
      ...installed,
      permissions: [...installed.permissions],
      dependencies: [...installed.dependencies],
      approvedPermissions: [...installed.approvedPermissions],
    };
  }

  installedItems(): InstalledMarketplaceItem[] {
    return [...this.installed.values()].map((item) => ({
      ...item,
      permissions: [...item.permissions],
      dependencies: [...item.dependencies],
      approvedPermissions: [...item.approvedPermissions],
    }));
  }
}
