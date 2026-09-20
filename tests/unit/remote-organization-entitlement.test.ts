import { describe, expect, it } from 'vitest';
import { RemoteAccessError, RemoteAccessService } from '@lyntar/remote-protocol';

const teamPlan = {
  id: 'TEAM',
  seats: 5,
  monthlyCredits: '6000',
  pooledCredits: true,
  crossPersonRooms: true,
};

const freePlan = {
  id: 'FREE',
  seats: 1,
  monthlyCredits: '25',
  pooledCredits: false,
  crossPersonRooms: false,
};

describe('organization entitlement transitions', () => {
  it('closes Room authorization on cancellation and reopens it only on an active paid plan', () => {
    const remote = new RemoteAccessService();
    const ownerUserId = 'owner-entitlement';
    const device = remote.registerDevice({
      userId: ownerUserId,
      label: 'Owner device',
      platform: 'win32',
      architecture: 'x64',
      publicKeyPem: 'owner-key',
    });
    const organization = remote.createOrganization({
      ownerUserId,
      displayName: 'Entitlement Room',
      plan: teamPlan,
    });
    const room = remote.createRoom({
      actorUserId: ownerUserId,
      organizationId: organization.id,
      hostDeviceId: device.id,
      name: 'Workspace',
      workspaceRootRelative: 'Projects/Workspace',
    });

    remote.setOrganizationEntitlement({
      organizationId: organization.id,
      actorUserId: ownerUserId,
      plan: freePlan,
      status: 'CLOSED',
      reason: 'Subscription cancelled',
    });

    expect(() =>
      remote.authorizeRoomAction({
        actorUserId: ownerUserId,
        roomId: room.id,
        permission: 'room.view',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RemoteAccessError>>({ code: 'ORGANIZATION_CLOSED' }),
    );

    remote.setOrganizationEntitlement({
      organizationId: organization.id,
      actorUserId: ownerUserId,
      plan: teamPlan,
      status: 'ACTIVE',
      reason: 'Subscription renewed',
    });

    expect(
      remote.authorizeRoomAction({
        actorUserId: ownerUserId,
        roomId: room.id,
        permission: 'room.view',
      }).userId,
    ).toBe(ownerUserId);
  });
});
