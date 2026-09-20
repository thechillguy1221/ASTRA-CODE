import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  RemoteAccessError,
  assertRoomWorkspacePath,
  deviceFingerprint,
  roomRolePermissions,
  type MemberStatus,
  type OrganizationPlanInput,
  type RemoteAccessPort,
  type RemoteDeviceRecord,
  type RemoteOrganization,
  type RemoteRoom,
  type RoomInvitation,
  type RoomInvitationResult,
  type RoomMember,
  type RoomPermission,
  type RoomRole,
} from '@lyntar/remote-protocol';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashInvitationToken(token: string): string {
  // Kept local to avoid exposing raw invitation tokens to any persistence layer.
  return createHash('sha256').update(token).digest('hex');
}

function mapDevice(row: Record<string, unknown>): RemoteDeviceRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    label: String(row.label),
    platform: String(row.platform),
    architecture: String(row.architecture ?? 'unknown'),
    publicKeyFingerprint: String(row.fingerprint),
    credentialVersion: Number(row.credential_version ?? 1),
    createdAt: new Date(String(row.created_at)).toISOString(),
    lastSeenAt: row.last_seen_at ? new Date(String(row.last_seen_at)).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
  };
}

function mapOrganization(row: Record<string, unknown>): RemoteOrganization {
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    planId: String(row.plan_id),
    displayName: String(row.display_name),
    seatLimit: Number(row.seat_limit),
    pooledCredits: String(row.pooled_credits),
    status: row.status === 'SUSPENDED' || row.status === 'CLOSED' ? row.status : 'ACTIVE',
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function mapPermissions(value: unknown, role: RoomRole | 'OWNER'): RoomPermission[] {
  if (Array.isArray(value)) {
    return value.filter((permission): permission is RoomPermission =>
      roomRolePermissions('ADMIN').includes(permission as RoomPermission),
    );
  }
  return roomRolePermissions(role);
}

function mapMember(row: Record<string, unknown>): RoomMember {
  const role =
    row.role === 'OWNER' || row.role === 'EDITOR' || row.role === 'ADMIN' || row.role === 'VIEWER'
      ? row.role
      : 'AGENT_USER';
  const status: MemberStatus =
    row.status === 'SUSPENDED' || row.status === 'REMOVED' ? row.status : 'ACTIVE';
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    userId: String(row.user_id),
    email: String(row.email ?? ''),
    role,
    status,
    permissions: mapPermissions(row.permissions, role),
    joinedAt: row.joined_at ? new Date(String(row.joined_at)).toISOString() : null,
    suspendedAt: row.suspended_at ? new Date(String(row.suspended_at)).toISOString() : null,
    removedAt: row.removed_at ? new Date(String(row.removed_at)).toISOString() : null,
  };
}

function mapRoom(row: Record<string, unknown>): RemoteRoom {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    hostUserId: String(row.host_user_id),
    hostDeviceId: String(row.host_device_id),
    name: String(row.name),
    workspaceRootRelative: String(row.workspace_root_relative),
    status: row.status === 'SUSPENDED' || row.status === 'CLOSED' ? row.status : 'ACTIVE',
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function mapInvitation(row: Record<string, unknown>): RoomInvitation {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    invitedEmail: String(row.invited_email),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    createdBy: String(row.created_by),
    redeemedBy: row.redeemed_by ? String(row.redeemed_by) : null,
    redeemedAt: row.redeemed_at ? new Date(String(row.redeemed_at)).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
  };
}

export class PostgresRemoteAccessService implements RemoteAccessPort {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listDevices(userId: string): Promise<RemoteDeviceRecord[]> {
    const result = await this.pool.query(
      'SELECT * FROM remote_devices WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return result.rows.map((row) => mapDevice(row as Record<string, unknown>));
  }

  async registerDevice(input: {
    userId: string;
    label: string;
    platform: string;
    architecture: string;
    publicKeyPem: string;
  }): Promise<RemoteDeviceRecord> {
    const fingerprint = deviceFingerprint(input.publicKeyPem);
    const existing = await this.pool.query(
      'SELECT * FROM remote_devices WHERE user_id = $1 AND fingerprint = $2',
      [input.userId, fingerprint],
    );
    if (existing.rows[0]) {
      const device = mapDevice(existing.rows[0] as Record<string, unknown>);
      if (device.revokedAt) throw new RemoteAccessError('DEVICE_REVOKED', 'Device is revoked');
      const updated = await this.pool.query(
        'UPDATE remote_devices SET label = $3, platform = $4, architecture = $5 WHERE id = $1 AND user_id = $2 RETURNING *',
        [device.id, input.userId, input.label, input.platform, input.architecture],
      );
      return mapDevice(updated.rows[0] as Record<string, unknown>);
    }
    const createdAt = this.now().toISOString();
    const result = await this.pool.query(
      `INSERT INTO remote_devices
         (id, user_id, label, platform, architecture, public_key_pem, fingerprint, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        randomUUID(),
        input.userId,
        input.label,
        input.platform,
        input.architecture,
        input.publicKeyPem,
        fingerprint,
        createdAt,
      ],
    );
    return mapDevice(result.rows[0] as Record<string, unknown>);
  }

  async heartbeat(userId: string, deviceId: string): Promise<RemoteDeviceRecord> {
    const result = await this.pool.query(
      'UPDATE remote_devices SET last_seen_at = $3 WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING *',
      [deviceId, userId, this.now().toISOString()],
    );
    if (!result.rows[0]) throw new RemoteAccessError('DEVICE_NOT_FOUND', 'Device not found');
    return mapDevice(result.rows[0] as Record<string, unknown>);
  }

  async authorizeOwnDevice(userId: string, deviceId: string): Promise<RemoteDeviceRecord> {
    const result = await this.pool.query(
      'SELECT * FROM remote_devices WHERE id = $1 AND user_id = $2',
      [deviceId, userId],
    );
    if (!result.rows[0]) throw new RemoteAccessError('DEVICE_NOT_FOUND', 'Device not found');
    const device = mapDevice(result.rows[0] as Record<string, unknown>);
    if (device.revokedAt) throw new RemoteAccessError('DEVICE_REVOKED', 'Device is revoked');
    return device;
  }

  async getDevice(deviceId: string): Promise<RemoteDeviceRecord> {
    const result = await this.pool.query('SELECT * FROM remote_devices WHERE id = $1', [deviceId]);
    if (!result.rows[0]) throw new RemoteAccessError('DEVICE_NOT_FOUND', 'Device not found');
    const device = mapDevice(result.rows[0] as Record<string, unknown>);
    if (device.revokedAt) throw new RemoteAccessError('DEVICE_REVOKED', 'Device is revoked');
    return device;
  }

  async revokeDevice(userId: string, deviceId: string): Promise<void> {
    const result = await this.pool.query(
      'UPDATE remote_devices SET revoked_at = COALESCE(revoked_at, $3), credential_version = credential_version + 1 WHERE id = $1 AND user_id = $2 RETURNING id',
      [deviceId, userId, this.now().toISOString()],
    );
    if (!result.rows[0]) throw new RemoteAccessError('DEVICE_NOT_FOUND', 'Device not found');
  }

  async createOrganization(input: {
    ownerUserId: string;
    displayName: string;
    plan: OrganizationPlanInput;
  }): Promise<RemoteOrganization> {
    if (!input.plan.crossPersonRooms || !input.plan.pooledCredits)
      throw new RemoteAccessError(
        'PLAN_NOT_ELIGIBLE',
        'Only Team and Business plans support Rooms',
      );
    const client = await this.pool.connect();
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO organizations(
           id, owner_user_id, plan_id, display_name, seat_limit, pooled_credits, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING *`,
        [
          id,
          input.ownerUserId,
          input.plan.id,
          input.displayName.trim(),
          input.plan.seats,
          input.plan.monthlyCredits,
          createdAt,
        ],
      );
      await client.query(
        `INSERT INTO organization_members
           (id, organization_id, user_id, role, status, permissions, joined_at)
         VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', $4::jsonb, $5)`,
        [
          randomUUID(),
          id,
          input.ownerUserId,
          JSON.stringify(roomRolePermissions('OWNER')),
          createdAt,
        ],
      );
      await client.query('COMMIT');
      return mapOrganization({
        ...(result.rows[0] as Record<string, unknown>),
        seat_limit: input.plan.seats,
        pooled_credits: input.plan.monthlyCredits,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createRoom(input: {
    actorUserId: string;
    organizationId: string;
    hostDeviceId: string;
    name: string;
    workspaceRootRelative: string;
  }): Promise<RemoteRoom> {
    await this.requirePermission(input.actorUserId, input.organizationId, 'room.settings.manage');
    const device = await this.pool.query(
      'SELECT id FROM remote_devices WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
      [input.hostDeviceId, input.actorUserId],
    );
    if (!device.rows[0]) throw new RemoteAccessError('DEVICE_NOT_FOUND', 'Host device not found');
    const result = await this.pool.query(
      `INSERT INTO rooms(id, organization_id, host_user_id, host_device_id, name, workspace_root_relative)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        randomUUID(),
        input.organizationId,
        input.actorUserId,
        input.hostDeviceId,
        input.name.trim(),
        assertRoomWorkspacePath(input.workspaceRootRelative),
      ],
    );
    const room = mapRoom(result.rows[0] as Record<string, unknown>);
    await this.recordAudit(
      input.organizationId,
      room.id,
      input.actorUserId,
      'room.created',
      'room',
      room.id,
    );
    return room;
  }

  async listRoomMembers(actorUserId: string, roomId: string): Promise<RoomMember[]> {
    const room = await this.requireRoom(roomId);
    await this.requirePermission(actorUserId, room.organizationId, 'room.view');
    const result = await this.pool.query(
      `SELECT m.*, u.email
         FROM organization_members m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = $1
        ORDER BY m.joined_at NULLS LAST, m.created_at`,
      [room.organizationId],
    );
    return result.rows.map((row) => mapMember(row as Record<string, unknown>));
  }

  async getRoom(roomId: string): Promise<RemoteRoom> {
    return this.requireRoom(roomId);
  }

  async inviteMember(input: {
    actorUserId: string;
    roomId: string;
    email: string;
    idempotencyKey: string;
  }): Promise<RoomInvitationResult> {
    const room = await this.requireRoom(input.roomId);
    await this.requirePermission(input.actorUserId, room.organizationId, 'members.invite');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        'SELECT * FROM room_invitations WHERE idempotency_key = $1 FOR UPDATE',
        [input.idempotencyKey],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return { invitation: mapInvitation(existing.rows[0] as Record<string, unknown>) };
      }
      const count = await client.query(
        `SELECT COUNT(*)::int AS count FROM organization_members
          WHERE organization_id = $1 AND status <> 'REMOVED'`,
        [room.organizationId],
      );
      const organization = await client.query(
        'SELECT * FROM organizations WHERE id = $1 FOR UPDATE',
        [room.organizationId],
      );
      if (!organization.rows[0])
        throw new RemoteAccessError('ORGANIZATION_NOT_FOUND', 'Organization not found');
      if (Number(count.rows[0]?.count ?? 0) >= Number(organization.rows[0].seat_limit ?? 0))
        throw new RemoteAccessError('SEAT_LIMIT', 'Organization seat limit reached');
      const rawToken = randomBytes(32).toString('base64url');
      const result = await client.query(
        `INSERT INTO room_invitations
           (id, room_id, invited_email, token_hash, idempotency_key, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          randomUUID(),
          room.id,
          normalizeEmail(input.email),
          hashInvitationToken(rawToken),
          input.idempotencyKey,
          new Date(this.now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          input.actorUserId,
        ],
      );
      await client.query('COMMIT');
      await this.recordAudit(
        room.organizationId,
        room.id,
        input.actorUserId,
        'room.invitation.created',
        'invitation',
        String(result.rows[0].id),
      );
      return {
        invitation: mapInvitation(result.rows[0] as Record<string, unknown>),
        token: rawToken,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async redeemInvitation(input: {
    userId: string;
    email: string;
    token: string;
  }): Promise<RoomMember> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const invitation = await client.query(
        'SELECT * FROM room_invitations WHERE token_hash = $1 FOR UPDATE',
        [hashInvitationToken(input.token)],
      );
      if (!invitation.rows[0])
        throw new RemoteAccessError('INVITATION_INVALID', 'Invitation is invalid');
      const row = invitation.rows[0] as Record<string, unknown>;
      if (row.revoked_at)
        throw new RemoteAccessError('INVITATION_REVOKED', 'Invitation is revoked');
      if (new Date(String(row.expires_at)).getTime() <= this.now().getTime())
        throw new RemoteAccessError('INVITATION_EXPIRED', 'Invitation has expired');
      if (normalizeEmail(input.email) !== String(row.invited_email))
        throw new RemoteAccessError(
          'INVITATION_EMAIL_MISMATCH',
          'Invitation email does not match account',
        );
      const room = await this.requireRoom(String(row.room_id), client);
      const existing = await client.query(
        `SELECT m.*, u.email FROM organization_members m JOIN users u ON u.id = m.user_id
          WHERE m.organization_id = $1 AND m.user_id = $2 FOR UPDATE`,
        [room.organizationId, input.userId],
      );
      let member: RoomMember;
      if (existing.rows[0]) {
        member = mapMember(existing.rows[0] as Record<string, unknown>);
        if (member.status === 'REMOVED')
          throw new RemoteAccessError('MEMBER_REMOVED', 'Member was removed');
        if (member.status === 'SUSPENDED')
          throw new RemoteAccessError('MEMBER_SUSPENDED', 'Member is suspended');
        member = mapMember({
          ...(existing.rows[0] as Record<string, unknown>),
          email: input.email,
        });
      } else {
        const created = await client.query(
          `INSERT INTO organization_members
             (id, organization_id, user_id, role, status, permissions, joined_at)
           VALUES ($1, $2, $3, 'AGENT_USER', 'ACTIVE', $4::jsonb, now()) RETURNING *`,
          [
            randomUUID(),
            room.organizationId,
            input.userId,
            JSON.stringify(roomRolePermissions('AGENT_USER')),
          ],
        );
        member = mapMember({ ...(created.rows[0] as Record<string, unknown>), email: input.email });
      }
      await client.query(
        'UPDATE room_invitations SET redeemed_by = $2, redeemed_at = COALESCE(redeemed_at, now()) WHERE id = $1',
        [row.id, input.userId],
      );
      await client.query('COMMIT');
      await this.recordAudit(
        room.organizationId,
        room.id,
        input.userId,
        'room.invitation.redeemed',
        'member',
        member.id,
      );
      return member;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setMemberRole(input: {
    actorUserId: string;
    roomId: string;
    userId: string;
    role: RoomRole;
  }): Promise<RoomMember> {
    const room = await this.requireRoom(input.roomId);
    await this.requirePermission(input.actorUserId, room.organizationId, 'members.manage');
    const target = await this.requireMember(room.organizationId, input.userId);
    if (target.role === 'OWNER')
      throw new RemoteAccessError('LAST_ADMIN', 'The organization owner role cannot be changed');
    const result = await this.pool.query(
      `UPDATE organization_members SET role = $3, permissions = $4::jsonb
        WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [target.id, room.organizationId, input.role, JSON.stringify(roomRolePermissions(input.role))],
    );
    const member = mapMember({
      ...(result.rows[0] as Record<string, unknown>),
      email: target.email,
    });
    await this.recordAudit(
      room.organizationId,
      room.id,
      input.actorUserId,
      'room.member.role_changed',
      'member',
      target.id,
    );
    return member;
  }

  async suspendMember(input: {
    actorUserId: string;
    roomId: string;
    userId: string;
  }): Promise<void> {
    await this.updateMemberStatus(input, 'SUSPENDED');
  }

  async restoreMember(input: {
    actorUserId: string;
    roomId: string;
    userId: string;
  }): Promise<void> {
    await this.updateMemberStatus(input, 'ACTIVE');
  }

  async removeMember(input: {
    actorUserId: string;
    roomId: string;
    userId: string;
  }): Promise<void> {
    await this.updateMemberStatus(input, 'REMOVED');
  }

  async leaveRoom(input: { userId: string; roomId: string }): Promise<void> {
    const room = await this.requireRoom(input.roomId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const memberResult = await client.query(
        `SELECT m.*, u.email
           FROM organization_members m JOIN users u ON u.id = m.user_id
          WHERE m.organization_id = $1 AND m.user_id = $2
          FOR UPDATE`,
        [room.organizationId, input.userId],
      );
      if (!memberResult.rows[0])
        throw new RemoteAccessError('MEMBER_NOT_FOUND', 'Room member not found');
      const member = mapMember(memberResult.rows[0] as Record<string, unknown>);
      if (member.role === 'OWNER') {
        const owners = await client.query(
          `SELECT COUNT(*)::int AS count FROM organization_members
            WHERE organization_id = $1 AND role = 'OWNER' AND status = 'ACTIVE'`,
          [room.organizationId],
        );
        if (Number(owners.rows[0]?.count ?? 0) <= 1)
          throw new RemoteAccessError(
            'LAST_ADMIN',
            'Transfer ownership before leaving the organization',
          );
      }
      await client.query(
        `UPDATE organization_members
            SET status = 'REMOVED', removed_at = now()
          WHERE id = $1`,
        [member.id],
      );
      await client.query('COMMIT');
      await this.recordAudit(
        room.organizationId,
        room.id,
        input.userId,
        'room.member.left',
        'member',
        member.id,
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async authorizeRoomAction(input: {
    actorUserId: string;
    roomId: string;
    permission: RoomPermission;
  }): Promise<RoomMember> {
    const room = await this.requireRoom(input.roomId);
    return this.requirePermission(
      input.actorUserId,
      room.organizationId,
      input.permission,
      room.id,
    );
  }

  private async updateMemberStatus(
    input: { actorUserId: string; roomId: string; userId: string },
    status: MemberStatus,
  ): Promise<void> {
    const room = await this.requireRoom(input.roomId);
    await this.requirePermission(input.actorUserId, room.organizationId, 'members.manage');
    const member = await this.requireMember(room.organizationId, input.userId);
    if (member.role === 'OWNER')
      throw new RemoteAccessError(
        'LAST_ADMIN',
        'The organization owner cannot be suspended or removed',
      );
    await this.pool.query(
      `UPDATE organization_members SET status = $3,
         suspended_at = CASE WHEN $3 = 'SUSPENDED' THEN now() ELSE NULL END,
         removed_at = CASE WHEN $3 = 'REMOVED' THEN now() ELSE NULL END
       WHERE id = $1 AND organization_id = $2`,
      [member.id, room.organizationId, status],
    );
    await this.recordAudit(
      room.organizationId,
      room.id,
      input.actorUserId,
      `room.member.${status.toLowerCase()}`,
      'member',
      member.id,
    );
  }

  private async requirePermission(
    userId: string,
    organizationId: string,
    permission: RoomPermission,
    roomId?: string,
  ): Promise<RoomMember> {
    const member = await this.requireMember(organizationId, userId);
    if (member.status === 'SUSPENDED')
      throw new RemoteAccessError('MEMBER_SUSPENDED', 'Room member is suspended');
    if (member.status === 'REMOVED')
      throw new RemoteAccessError('MEMBER_REMOVED', 'Room member was removed');
    if (!member.permissions.includes(permission))
      throw new RemoteAccessError('PERMISSION_DENIED', `Missing permission: ${permission}`);
    if (roomId) {
      const room = await this.requireRoom(roomId);
      if (room.organizationId !== organizationId)
        throw new RemoteAccessError('PERMISSION_DENIED', 'Room does not belong to organization');
    }
    return member;
  }

  private async requireMember(
    organizationId: string,
    userId: string,
    client?: PoolClient,
  ): Promise<RoomMember> {
    const runner = client ?? this.pool;
    const result = await runner.query(
      `SELECT m.*, u.email FROM organization_members m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = $1 AND m.user_id = $2`,
      [organizationId, userId],
    );
    if (!result.rows[0]) throw new RemoteAccessError('MEMBER_NOT_FOUND', 'Room member not found');
    return mapMember(result.rows[0] as Record<string, unknown>);
  }

  private async requireRoom(roomId: string, client?: PoolClient): Promise<RemoteRoom> {
    const runner = client ?? this.pool;
    const result = await runner.query('SELECT * FROM rooms WHERE id = $1', [roomId]);
    if (!result.rows[0]) throw new RemoteAccessError('ROOM_NOT_FOUND', 'Room not found');
    return mapRoom(result.rows[0] as Record<string, unknown>);
  }

  private async recordAudit(
    organizationId: string,
    roomId: string | null,
    actorUserId: string | null,
    action: string,
    targetType: string,
    targetId: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO room_audit_events(id, organization_id, room_id, actor_user_id, action, target_type, target_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), organizationId, roomId, actorUserId, action, targetType, targetId],
    );
  }
}
