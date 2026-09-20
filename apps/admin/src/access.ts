export const NO_LIVE_DATA = 'NO_LIVE_DATA';

export const adminPermissions = {
  SUPER_ADMIN: ['read_usage', 'adjust_wallet', 'change_model', 'refund_payment', 'revoke_sessions'],
  FINANCE: ['read_usage', 'adjust_wallet', 'refund_payment'],
  SUPPORT: ['read_usage', 'revoke_sessions'],
} as const;

export type AdminRole = keyof typeof adminPermissions;

export function canAdmin(role: AdminRole, action: string): boolean {
  return (adminPermissions[role] as readonly string[]).includes(action);
}
