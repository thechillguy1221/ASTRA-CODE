import type { AdminPermission } from './contracts.js';

export type ControlPlaneAdminRole = 'ADMIN' | 'SUPER_ADMIN' | 'FINANCE' | 'SUPPORT' | 'USER';

const allPermissions: AdminPermission[] = [
  'admin.users',
  'admin.organizations',
  'admin.rooms',
  'admin.billing',
  'admin.models',
  'admin.plans',
  'admin.security',
  'admin.email',
  'admin.features',
  'admin.releases',
  'admin.system',
];

const permissionsByRole: Record<ControlPlaneAdminRole, AdminPermission[]> = {
  SUPER_ADMIN: allPermissions,
  ADMIN: ['admin.users', 'admin.security', 'admin.email', 'admin.system'],
  FINANCE: ['admin.billing', 'admin.plans'],
  SUPPORT: ['admin.users', 'admin.rooms'],
  USER: [],
};

export function resolveAdminPermissions(role: ControlPlaneAdminRole): AdminPermission[] {
  return [...(permissionsByRole[role] ?? [])];
}

export function hasAdminPermission(
  permissions: readonly AdminPermission[],
  required: AdminPermission,
): boolean {
  return permissions.includes(required);
}
