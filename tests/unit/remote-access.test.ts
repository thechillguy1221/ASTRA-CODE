import { describe, expect, it } from 'vitest';
import {
  assertRoomWorkspacePath,
  RemoteAccessService,
  WorkspaceWriteCoordinator,
} from '@lyntar/remote-protocol';

const TEAM = {
  id: 'TEAM',
  seats: 5,
  monthlyCredits: '6000',
  pooledCredits: true,
  crossPersonRooms: true,
};

describe('personal devices and Team/Business Room authorization', () => {
  it('allows own-device control but denies cross-person personal-device access', () => {
    const access = new RemoteAccessService();
    const device = access.registerDevice({
      userId: 'alice',
      label: 'Alice laptop',
      platform: 'win32',
      architecture: 'x64',
      publicKeyPem: 'alice-public-key',
    });
    expect(access.authorizeOwnDevice('alice', device.id).id).toBe(device.id);
    expect(() => access.authorizeOwnDevice('bob', device.id)).toThrowError(
      expect.objectContaining({ code: 'DEVICE_NOT_FOUND' }),
    );
    access.revokeDevice('alice', device.id);
    expect(() => access.authorizeOwnDevice('alice', device.id)).toThrowError(
      expect.objectContaining({ code: 'DEVICE_REVOKED' }),
    );
  });

  it('enforces Team Room invitation, roles, suspension, removal, and workspace boundaries', () => {
    const access = new RemoteAccessService({ now: () => new Date('2026-09-20T00:00:00.000Z') });
    const host = access.registerDevice({
      userId: 'alice',
      label: 'Alice host',
      platform: 'win32',
      architecture: 'x64',
      publicKeyPem: 'alice-key',
    });
    const organization = access.createOrganization({
      ownerUserId: 'alice',
      displayName: 'Astra team',
      plan: TEAM,
    });
    const room = access.createRoom({
      actorUserId: 'alice',
      organizationId: organization.id,
      hostDeviceId: host.id,
      name: 'Website redesign',
      workspaceRootRelative: 'workspace-website',
    });
    expect(() =>
      access.createRoom({
        actorUserId: 'alice',
        organizationId: organization.id,
        hostDeviceId: host.id,
        name: 'Escape',
        workspaceRootRelative: '../secrets',
      }),
    ).toThrowError(expect.objectContaining({ code: 'ROOM_PATH_INVALID' }));

    const invitation = access.inviteMember({
      actorUserId: 'alice',
      roomId: room.id,
      email: 'bob@example.test',
      idempotencyKey: 'invite-1',
    });
    expect(invitation.token).toBeTruthy();
    const member = access.redeemInvitation({
      userId: 'bob',
      email: 'bob@example.test',
      token: invitation.token ?? '',
    });
    expect(member.role).toBe('AGENT_USER');
    expect(
      access.authorizeRoomAction({
        actorUserId: 'bob',
        roomId: room.id,
        permission: 'agent.prompt',
      }).userId,
    ).toBe('bob');

    access.setMemberRole({ actorUserId: 'alice', roomId: room.id, userId: 'bob', role: 'VIEWER' });
    expect(() =>
      access.authorizeRoomAction({
        actorUserId: 'bob',
        roomId: room.id,
        permission: 'agent.prompt',
      }),
    ).toThrowError(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
    access.setMemberRole({
      actorUserId: 'alice',
      roomId: room.id,
      userId: 'bob',
      role: 'AGENT_USER',
    });
    access.suspendMember({ actorUserId: 'alice', roomId: room.id, userId: 'bob' });
    expect(() =>
      access.authorizeRoomAction({ actorUserId: 'bob', roomId: room.id, permission: 'room.view' }),
    ).toThrowError(expect.objectContaining({ code: 'MEMBER_SUSPENDED' }));
    const secondInvite = access.inviteMember({
      actorUserId: 'alice',
      roomId: room.id,
      email: 'bob@example.test',
      idempotencyKey: 'invite-while-suspended',
    });
    expect(() =>
      access.redeemInvitation({
        userId: 'bob',
        email: 'bob@example.test',
        token: secondInvite.token ?? '',
      }),
    ).toThrowError(expect.objectContaining({ code: 'MEMBER_SUSPENDED' }));
    access.restoreMember({ actorUserId: 'alice', roomId: room.id, userId: 'bob' });
    access.removeMember({ actorUserId: 'alice', roomId: room.id, userId: 'bob' });
    expect(() =>
      access.authorizeRoomAction({ actorUserId: 'bob', roomId: room.id, permission: 'room.view' }),
    ).toThrowError(expect.objectContaining({ code: 'MEMBER_REMOVED' }));
  });

  it('rejects personal plans from creating cross-person Rooms and serializes writes', async () => {
    const access = new RemoteAccessService();
    expect(() =>
      access.createOrganization({
        ownerUserId: 'alice',
        displayName: 'Personal',
        plan: { ...TEAM, id: 'PRO', pooledCredits: false, crossPersonRooms: false },
      }),
    ).toThrowError(expect.objectContaining({ code: 'PLAN_NOT_ELIGIBLE' }));

    const coordinator = new WorkspaceWriteCoordinator();
    const order: string[] = [];
    const first = coordinator.runExclusive('workspace-1', async () => {
      order.push('first-start');
      await Promise.resolve();
      order.push('first-end');
      return 'first';
    });
    const second = coordinator.runExclusive('workspace-1', async () => {
      order.push('second-start');
      order.push('second-end');
      return 'second';
    });
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
  });

  it('keeps invitation redemption bound to the invited identity', () => {
    const access = new RemoteAccessService();
    const host = access.registerDevice({
      userId: 'alice',
      label: 'host',
      platform: 'win32',
      architecture: 'x64',
      publicKeyPem: 'key',
    });
    const org = access.createOrganization({ ownerUserId: 'alice', displayName: 'Org', plan: TEAM });
    const room = access.createRoom({
      actorUserId: 'alice',
      organizationId: org.id,
      hostDeviceId: host.id,
      name: 'Room',
      workspaceRootRelative: 'workspace-1',
    });
    const invite = access.inviteMember({
      actorUserId: 'alice',
      roomId: room.id,
      email: 'bob@example.test',
      idempotencyKey: 'invite-identity',
    });
    expect(() =>
      access.redeemInvitation({
        userId: 'mallory',
        email: 'mallory@example.test',
        token: invite.token ?? '',
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVITATION_EMAIL_MISMATCH' }));
    expect(() =>
      access.redeemInvitation({
        userId: 'bob',
        email: 'bob@example.test',
        token: invite.token ?? '',
      }),
    ).not.toThrow();
  });

  it('rejects Windows path escape syntax and reserved device names', () => {
    expect(assertRoomWorkspacePath('src\\features\\auth.ts')).toBe('src/features/auth.ts');
    for (const candidate of [
      'src/./auth.ts',
      'src/../secrets.txt',
      'src/CON.txt',
      'src/NUL',
      'src/$env:USERPROFILE',
      'src/%USERPROFILE%/secret.txt',
      'src:secret.txt',
    ]) {
      expect(() => assertRoomWorkspacePath(candidate)).toThrowError(
        expect.objectContaining({ code: 'ROOM_PATH_INVALID' }),
      );
    }
  });
});
