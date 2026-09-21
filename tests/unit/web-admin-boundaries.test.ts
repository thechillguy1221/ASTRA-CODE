import { describe, expect, it } from 'vitest';
import { publicRoutes, resolvePublicRoute } from '@astra/web';
import { adminPermissions, NO_LIVE_DATA } from '@astra/admin';

describe('web and admin boundaries', () => {
  it('keeps the public route map explicit and resolves unknown routes safely', () => {
    expect(publicRoutes.map((route) => route.path)).toEqual(
      expect.arrayContaining([
        '/download/windows',
        '/pricing',
        '/features/viva',
        '/docs',
        '/security',
      ]),
    );
    expect(resolvePublicRoute('/pricing').title).toMatch(/pricing/i);
    expect(resolvePublicRoute('/not-a-route').status).toBe(404);
  });

  it('makes admin permissions server-readable and marks unavailable live data honestly', () => {
    expect(adminPermissions.SUPER_ADMIN).toContain('adjust_wallet');
    expect(adminPermissions.SUPPORT).not.toContain('adjust_wallet');
    expect(NO_LIVE_DATA).toBe('NO_LIVE_DATA');
  });
});
