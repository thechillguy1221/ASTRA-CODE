import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  RemoteAccessError,
  assertRoomWorkspacePath,
  deviceFingerprint,
  roomHostAvailability,
  roomSecuritySeverity,
  sanitizeSecurityEvidence,
  roomRolePermissions,
  type RoomSecurityEvent,
  type RoomHostAvailability,
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
} from '@astra/remote-protocol';
import {
  buildRoomFileImportManifest,
  normalizeRoomFileUpload,
  RoomFileError,
  assertSafeProjectRelativePath,
  type RoomFileImportProposal,
  type RoomFileRecord,
  type RoomFileIntent,
} from '@astra/remote-protocol';

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
  if (Array.isArray(value) && value.length > 0) {
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
    roomId: row.room_id ? String(row.room_id) : null,
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
  const hostAvailability: RoomHostAvailability =
    row.host_availability === 'ONLINE' ||
    row.host_availability === 'OFFLINE' ||
    row.host_availability === 'UNAVAILABLE' ||
    row.host_availability === 'REVOKED' ||
    row.host_availability === 'DISCONNECTED'
      ? row.host_availability
      : 'UNKNOWN';
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    hostUserId: String(row.host_user_id),
    hostDeviceId: String(row.host_device_id),
    name: String(row.name),
    workspaceRootRelative: String(row.workspace_root_relative),
    projectId: String(row.primary_project_id ?? row.id),
    workspaceFingerprint: row.workspace_fingerprint ? String(row.workspace_fingerprint) : null,
    hostAvailability,
    hostBindingVersion: Number(row.host_binding_version ?? 1),
    status: row.status === 'SUSPENDED' || row.status === 'CLOSED' ? row.status : 'ACTIVE',
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at ?? row.created_at)).toISOString(),
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

function mapRoomFile(row: Record<string, unknown>): RoomFileRecord {
  const intent: RoomFileIntent = row.intent === 'ADD_TO_PROJECT' ? 'ADD_TO_PROJECT' : 'REFERENCE';
  const state =
    row.security_state === 'REJECTED' ||
    row.security_state === 'DELETED' ||
    row.security_state === 'UPLOADED' ||
    row.security_state === 'VALIDATING'
      ? row.security_state
      : 'SAFE';
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    roomId: String(row.room_id),
    uploaderUserId: String(row.uploader_user_id),
    originalName: String(row.original_name),
    safeName: String(row.safe_name),
    contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes),
    checksumSha256: String(row.checksum_sha256),
    intent,
    securityState: state,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    deletedAt: row.deleted_at ? new Date(String(row.deleted_at)).toISOString() : null,
  };
}

function mapImport(row: Record<string, unknown>): RoomFileImportProposal {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    roomId: String(row.room_id),
    fileId: String(row.file_id),
    requestedBy: String(row.requested_by),
    destinationRelative: String(row.destination_relative),
    status:
      row.status === 'APPROVED' ||
      row.status === 'REJECTED' ||
      row.status === 'IMPORTED' ||
      row.status === 'FAILED'
        ? row.status
        : 'PREVIEW',
    manifest: row.manifest as RoomFileImportProposal['manifest'],
    approvedBy: row.approved_by ? String(row.approved_by) : null,
    approvedAt: row.approved_at ? new Date(String(row.approved_at)).toISOString() : null,
    completedBy: row.completed_by ? String(row.completed_by) : null,
    completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapSecurityEvent(row: Record<string, unknown>): RoomSecurityEvent {
  const severity =
    row.severity === 'LOW' ||
    row.severity === 'MEDIUM' ||
    row.severity === 'HIGH' ||
    row.severity === 'CRITICAL'
      ? row.severity
      : 'INFO';
  const decision =
    row.decision === 'ALLOWED' || row.decision === 'FLAGGED' ? row.decision : 'BLOCKED';
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    roomId: row.room_id ? String(row.room_id) : null,
    actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
    deviceId: row.device_id ? String(row.device_id) : null,
    projectId: row.project_id ? String(row.project_id) : null,
    taskId: row.task_id ? String(row.task_id) : null,
    eventType: String(row.event_type),
    severity,
    requestedAction: String(row.requested_action),
    requestedResource: row.requested_resource ? String(row.requested_resource) : null,
    decision,
    outcome: String(row.outcome),
    evidence: (row.evidence ?? {}) as Record<string, unknown>,
    createdAt: new Date(String(row.created_at)).toISOString(),
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

  async setOrganizationEntitlement(input: {
    organizationId: string;
    actorUserId: string;
    plan: OrganizationPlanInput;
    status: RemoteOrganization['status'];
    reason: string;
  }): Promise<RemoteOrganization> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE organizations
            SET plan_id = $2,
                seat_limit = $3,
                pooled_credits = $4,
                status = $5,
                updated_at = now()
          WHERE id = $1 AND owner_user_id = $6
          RETURNING *`,
        [
          input.organizationId,
          input.plan.id,
          input.plan.seats,
          input.plan.monthlyCredits,
          input.status,
          input.actorUserId,
        ],
      );
      if (!result.rows[0]) {
        const organization = await client.query(
          'SELECT id, owner_user_id FROM organizations WHERE id = $1',
          [input.organizationId],
        );
        if (!organization.rows[0])
          throw new RemoteAccessError('ORGANIZATION_NOT_FOUND', 'Organization not found');
        throw new RemoteAccessError(
          'PERMISSION_DENIED',
          'Only the organization owner can change its entitlement',
        );
      }
      await client.query(
        `INSERT INTO room_audit_events(
           id, organization_id, room_id, actor_user_id, action, target_type, target_id
         ) VALUES ($1, $2, NULL, $3, $4, 'organization', $2)`,
        [
          randomUUID(),
          input.organizationId,
          input.actorUserId,
          `organization.entitlement.changed:${input.reason.slice(0, 240)}`,
        ],
      );
      await client.query('COMMIT');
      return mapOrganization(result.rows[0] as Record<string, unknown>);
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
      'SELECT * FROM remote_devices WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
      [input.hostDeviceId, input.actorUserId],
    );
    if (!device.rows[0]) throw new RemoteAccessError('DEVICE_NOT_FOUND', 'Host device not found');
    const roomId = randomUUID();
    const projectId = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO rooms(
         id, organization_id, host_user_id, host_device_id, name, workspace_root_relative,
         primary_project_id, host_availability, host_binding_version, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9) RETURNING *`,
      [
        roomId,
        input.organizationId,
        input.actorUserId,
        input.hostDeviceId,
        input.name.trim(),
        assertRoomWorkspacePath(input.workspaceRootRelative),
        projectId,
        roomHostAvailability(mapDevice(device.rows[0] as Record<string, unknown>), this.now()),
        this.now().toISOString(),
      ],
    );
    const room = mapRoom(result.rows[0] as Record<string, unknown>);
    await this.pool.query(
      `INSERT INTO room_members
         (id, room_id, organization_id, user_id, role, status, permissions, joined_at)
       VALUES ($1, $2, $3, $4, 'OWNER', 'ACTIVE', $5::jsonb, $6)`,
      [
        randomUUID(),
        room.id,
        room.organizationId,
        input.actorUserId,
        JSON.stringify(roomRolePermissions('OWNER')),
        room.createdAt,
      ],
    );
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
    await this.requirePermission(actorUserId, room.organizationId, 'room.view', room.id);
    const result = await this.pool.query(
      `SELECT m.*, u.email
         FROM room_members m JOIN users u ON u.id = m.user_id
        WHERE m.room_id = $1
        ORDER BY m.joined_at NULLS LAST, m.created_at`,
      [room.id],
    );
    return result.rows.map((row) => mapMember(row as Record<string, unknown>));
  }

  async getRoom(roomId: string): Promise<RemoteRoom> {
    const room = await this.requireRoom(roomId);
    const device = await this.pool.query('SELECT * FROM remote_devices WHERE id = $1', [
      room.hostDeviceId,
    ]);
    room.hostAvailability = device.rows[0]
      ? roomHostAvailability(mapDevice(device.rows[0] as Record<string, unknown>), this.now())
      : 'UNAVAILABLE';
    return room;
  }

  async listRooms(actorUserId: string): Promise<RemoteRoom[]> {
    const result = await this.pool.query(
      `SELECT r.*
         FROM rooms r
         JOIN room_members m ON m.room_id = r.id
        WHERE m.user_id = $1 AND m.status = 'ACTIVE' AND r.status = 'ACTIVE'
        ORDER BY r.created_at DESC`,
      [actorUserId],
    );
    return Promise.all(
      result.rows.map((row) => this.getRoom(String((row as Record<string, unknown>).id))),
    );
  }

  async handoffRoom(input: {
    actorUserId: string;
    roomId: string;
    hostDeviceId: string;
    workspaceRootRelative: string;
    workspaceFingerprint: string;
  }): Promise<RemoteRoom> {
    const room = await this.requireRoom(input.roomId);
    await this.requirePermission(
      input.actorUserId,
      room.organizationId,
      'room.settings.manage',
      room.id,
    );
    const fingerprint = input.workspaceFingerprint.trim();
    if (!fingerprint || fingerprint.length > 512)
      throw new RemoteAccessError('ROOM_HOST_INVALID', 'Workspace fingerprint is invalid');
    const deviceResult = await this.pool.query('SELECT * FROM remote_devices WHERE id = $1', [
      input.hostDeviceId,
    ]);
    if (!deviceResult.rows[0])
      throw new RemoteAccessError('DEVICE_NOT_FOUND', 'Host device not found');
    const device = mapDevice(deviceResult.rows[0] as Record<string, unknown>);
    if (device.revokedAt) throw new RemoteAccessError('DEVICE_REVOKED', 'Host device is revoked');
    const member = await this.requireMember(room.organizationId, device.userId, undefined, room.id);
    if (member.status !== 'ACTIVE')
      throw new RemoteAccessError(
        'ROOM_HOST_INVALID',
        'Destination host is not an active Room member',
      );
    const root = assertRoomWorkspacePath(input.workspaceRootRelative);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE rooms
            SET host_user_id = $2,
                host_device_id = $3,
                workspace_root_relative = $4,
                workspace_fingerprint = $5,
                host_availability = $6,
                host_binding_version = host_binding_version + 1,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [
          input.roomId,
          device.userId,
          device.id,
          root,
          fingerprint,
          roomHostAvailability(device, this.now()),
        ],
      );
      await client.query(
        `INSERT INTO room_audit_events(id, organization_id, room_id, actor_user_id, action, target_type, target_id, metadata)
         VALUES ($1, $2, $3, $4, 'room.project.host_handoff', 'room_project', $5, $6::jsonb)`,
        [
          randomUUID(),
          room.organizationId,
          room.id,
          input.actorUserId,
          room.projectId,
          JSON.stringify({ hostDeviceId: device.id }),
        ],
      );
      await client.query('COMMIT');
      return mapRoom(result.rows[0] as Record<string, unknown>);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async uploadRoomFile(input: {
    actorUserId: string;
    roomId: string;
    originalName: string;
    contentType: string;
    content: Buffer;
    intent: RoomFileIntent;
  }): Promise<RoomFileRecord> {
    const room = await this.requireRoom(input.roomId);
    await this.requirePermission(input.actorUserId, room.organizationId, 'files.write', room.id);
    let normalized;
    try {
      normalized = normalizeRoomFileUpload(input);
    } catch (error) {
      if (error instanceof RoomFileError)
        await this.recordSecurityEvent({
          organizationId: room.organizationId,
          roomId: room.id,
          actorUserId: input.actorUserId,
          projectId: room.projectId,
          eventType: error.code.startsWith('ARCHIVE')
            ? 'SUSPICIOUS_ARCHIVE'
            : 'POLICY_BYPASS_ATTEMPT',
          requestedAction: 'room.file.upload',
          requestedResource: input.originalName,
          decision: 'BLOCKED',
          outcome: error.message,
        });
      throw error;
    }
    const id = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO room_files(
         id, organization_id, room_id, uploader_user_id, original_name, safe_name,
         content_type, size_bytes, checksum_sha256, intent, security_state, content
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'SAFE', $11)
       RETURNING *`,
      [
        id,
        room.organizationId,
        room.id,
        input.actorUserId,
        input.originalName,
        normalized.safeName,
        normalized.contentType,
        normalized.sizeBytes,
        normalized.checksumSha256,
        input.intent,
        input.content,
      ],
    );
    const record = mapRoomFile(result.rows[0] as Record<string, unknown>);
    await this.recordAudit(
      room.organizationId,
      room.id,
      input.actorUserId,
      'room.file.uploaded',
      'room_file',
      id,
    );
    return record;
  }

  async listRoomFiles(actorUserId: string, roomId: string): Promise<RoomFileRecord[]> {
    const room = await this.requireRoom(roomId);
    await this.requirePermission(actorUserId, room.organizationId, 'files.read', room.id);
    const result = await this.pool.query(
      `SELECT * FROM room_files WHERE room_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [room.id],
    );
    return result.rows.map((row) => mapRoomFile(row as Record<string, unknown>));
  }

  async getRoomFile(input: {
    actorUserId: string;
    roomId: string;
    fileId: string;
  }): Promise<{ record: RoomFileRecord; content: Buffer }> {
    const room = await this.requireRoom(input.roomId);
    await this.requirePermission(input.actorUserId, room.organizationId, 'files.read', room.id);
    const result = await this.pool.query(
      `SELECT * FROM room_files WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL`,
      [input.fileId, room.id],
    );
    if (!result.rows[0]) throw new RemoteAccessError('ROOM_FILE_NOT_FOUND', 'Room file not found');
    const row = result.rows[0] as Record<string, unknown>;
    const raw = row.content;
    const content = Buffer.isBuffer(raw) ? Buffer.from(raw) : Buffer.from(String(raw), 'base64');
    return { record: mapRoomFile(row), content };
  }

  async deleteRoomFile(input: {
    actorUserId: string;
    roomId: string;
    fileId: string;
  }): Promise<void> {
    const room = await this.requireRoom(input.roomId);
    await this.requirePermission(input.actorUserId, room.organizationId, 'files.write', room.id);
    const result = await this.pool.query(
      `UPDATE room_files SET security_state = 'DELETED', deleted_at = now(), updated_at = now()
       WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL RETURNING id`,
      [input.fileId, room.id],
    );
    if (!result.rows[0]) throw new RemoteAccessError('ROOM_FILE_NOT_FOUND', 'Room file not found');
    await this.recordAudit(
      room.organizationId,
      room.id,
      input.actorUserId,
      'room.file.deleted',
      'room_file',
      input.fileId,
    );
  }

  async createRoomFileImport(input: {
    actorUserId: string;
    roomId: string;
    fileId: string;
    destinationRelative: string;
    existingPaths?: string[];
  }): Promise<RoomFileImportProposal> {
    const room = await this.requireRoom(input.roomId);
    await this.requirePermission(input.actorUserId, room.organizationId, 'files.write', room.id);
    const file = await this.getRoomFile({
      actorUserId: input.actorUserId,
      roomId: room.id,
      fileId: input.fileId,
    });
    if (file.record.intent !== 'ADD_TO_PROJECT' || file.record.securityState !== 'SAFE')
      throw new RemoteAccessError(
        'ROOM_FILE_STATE_INVALID',
        'Room file is not ready for project import',
      );
    let manifest;
    try {
      manifest = buildRoomFileImportManifest({
        fileId: file.record.id,
        safeName: file.record.safeName,
        contentType: file.record.contentType,
        content: file.content,
        destinationRelative: input.destinationRelative,
        ...(input.existingPaths ? { existingPaths: input.existingPaths } : {}),
      });
    } catch (error) {
      if (error instanceof RoomFileError)
        await this.recordSecurityEvent({
          organizationId: room.organizationId,
          roomId: room.id,
          actorUserId: input.actorUserId,
          projectId: room.projectId,
          eventType: error.code.startsWith('ARCHIVE')
            ? 'SUSPICIOUS_ARCHIVE'
            : 'PATH_ESCAPE_ATTEMPT',
          requestedAction: 'room.file.import.preview',
          requestedResource: input.destinationRelative,
          decision: 'BLOCKED',
          outcome: error.message,
        });
      throw error;
    }
    const id = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO room_file_imports(
         id, organization_id, room_id, file_id, requested_by, destination_relative, status, manifest
       ) VALUES ($1, $2, $3, $4, $5, $6, 'PREVIEW', $7::jsonb) RETURNING *`,
      [
        id,
        room.organizationId,
        room.id,
        input.fileId,
        input.actorUserId,
        assertSafeProjectRelativePath(input.destinationRelative, true),
        JSON.stringify(manifest),
      ],
    );
    await this.recordAudit(
      room.organizationId,
      room.id,
      input.actorUserId,
      'room.file.import.previewed',
      'room_file_import',
      id,
    );
    return mapImport(result.rows[0] as Record<string, unknown>);
  }

  async approveRoomFileImport(input: {
    actorUserId: string;
    roomId: string;
    importId: string;
  }): Promise<RoomFileImportProposal> {
    const proposal = await this.requireImport(input.roomId, input.importId);
    const room = await this.requireRoom(input.roomId);
    await this.requirePermission(input.actorUserId, room.organizationId, 'files.write', room.id);
    if (proposal.status !== 'PREVIEW')
      throw new RemoteAccessError(
        'ROOM_FILE_STATE_INVALID',
        'Import is no longer awaiting approval',
      );
    if (proposal.manifest.rejectedCount > 0)
      throw new RemoteAccessError(
        'ROOM_IMPORT_CONFLICT',
        'Import preview contains rejected entries',
      );
    if (proposal.manifest.overwriteCount > 0)
      await this.requirePermission(
        input.actorUserId,
        room.organizationId,
        'destructive.approve',
        room.id,
      );
    const result = await this.pool.query(
      `UPDATE room_file_imports
          SET status = 'APPROVED', approved_by = $3, approved_at = now(), updated_at = now()
        WHERE id = $1 AND room_id = $2 AND status = 'PREVIEW'
        RETURNING *`,
      [input.importId, room.id, input.actorUserId],
    );
    if (!result.rows[0])
      throw new RemoteAccessError('ROOM_FILE_STATE_INVALID', 'Import state changed');
    await this.recordAudit(
      room.organizationId,
      room.id,
      input.actorUserId,
      'room.file.import.approved',
      'room_file_import',
      input.importId,
    );
    return mapImport(result.rows[0] as Record<string, unknown>);
  }

  async rejectRoomFileImport(input: {
    actorUserId: string;
    roomId: string;
    importId: string;
  }): Promise<RoomFileImportProposal> {
    const proposal = await this.requireImport(input.roomId, input.importId);
    const room = await this.requireRoom(input.roomId);
    await this.requirePermission(input.actorUserId, room.organizationId, 'files.write', room.id);
    if (proposal.status === 'IMPORTED')
      throw new RemoteAccessError('ROOM_FILE_STATE_INVALID', 'Imported content cannot be rejected');
    const result = await this.pool.query(
      `UPDATE room_file_imports SET status = 'REJECTED', updated_at = now()
       WHERE id = $1 AND room_id = $2 RETURNING *`,
      [input.importId, room.id],
    );
    if (!result.rows[0]) throw new RemoteAccessError('ROOM_IMPORT_NOT_FOUND', 'Import not found');
    await this.recordAudit(
      room.organizationId,
      room.id,
      input.actorUserId,
      'room.file.import.rejected',
      'room_file_import',
      input.importId,
    );
    return mapImport(result.rows[0] as Record<string, unknown>);
  }

  async completeRoomFileImport(input: {
    actorUserId: string;
    roomId: string;
    importId: string;
    hostDeviceId: string;
    writtenPaths: string[];
  }): Promise<RoomFileImportProposal> {
    const proposal = await this.requireImport(input.roomId, input.importId);
    const room = await this.requireRoom(input.roomId);
    if (proposal.status !== 'APPROVED')
      throw new RemoteAccessError(
        'ROOM_FILE_STATE_INVALID',
        'Import is not approved for host execution',
      );
    if (room.hostDeviceId !== input.hostDeviceId)
      throw new RemoteAccessError(
        'ROOM_HOST_INVALID',
        'Import host does not match the Room project host',
      );
    const device = await this.authorizeOwnDevice(input.actorUserId, input.hostDeviceId);
    if (roomHostAvailability(device, this.now()) !== 'ONLINE')
      throw new RemoteAccessError('ROOM_HOST_OFFLINE', 'Room project host is not online');
    const expected = new Set(
      proposal.manifest.entries
        .filter((entry) => entry.action !== 'REJECTED')
        .map((entry) => entry.path.toLowerCase()),
    );
    const actual = new Set(
      input.writtenPaths.map((path) => assertSafeProjectRelativePath(path).toLowerCase()),
    );
    if (expected.size !== actual.size || [...expected].some((path) => !actual.has(path)))
      throw new RemoteAccessError(
        'ROOM_IMPORT_CONFLICT',
        'Host import result does not match the approved manifest',
      );
    const result = await this.pool.query(
      `UPDATE room_file_imports
          SET status = 'IMPORTED', completed_by = $3, completed_at = now(), updated_at = now()
        WHERE id = $1 AND room_id = $2 AND status = 'APPROVED'
        RETURNING *`,
      [input.importId, room.id, input.actorUserId],
    );
    if (!result.rows[0])
      throw new RemoteAccessError('ROOM_FILE_STATE_INVALID', 'Import state changed');
    await this.recordAudit(
      room.organizationId,
      room.id,
      input.actorUserId,
      'room.file.import.completed',
      'room_file_import',
      input.importId,
    );
    return mapImport(result.rows[0] as Record<string, unknown>);
  }

  async listRoomFileImports(
    actorUserId: string,
    roomId: string,
  ): Promise<RoomFileImportProposal[]> {
    const room = await this.requireRoom(roomId);
    await this.requirePermission(actorUserId, room.organizationId, 'files.read', room.id);
    const result = await this.pool.query(
      'SELECT * FROM room_file_imports WHERE room_id = $1 ORDER BY created_at DESC',
      [room.id],
    );
    return result.rows.map((row) => mapImport(row as Record<string, unknown>));
  }

  async inviteMember(input: {
    actorUserId: string;
    roomId: string;
    email: string;
    idempotencyKey: string;
  }): Promise<RoomInvitationResult> {
    const room = await this.requireRoom(input.roomId);
    await this.requirePermission(input.actorUserId, room.organizationId, 'members.invite', room.id);
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
      const existingRoom = await client.query(
        `SELECT m.*, u.email FROM room_members m JOIN users u ON u.id = m.user_id
          WHERE m.room_id = $1 AND m.user_id = $2 FOR UPDATE`,
        [room.id, input.userId],
      );
      if (existingRoom.rows[0]) {
        const member = mapMember({
          ...(existingRoom.rows[0] as Record<string, unknown>),
          email: input.email,
        });
        if (member.status === 'REMOVED')
          throw new RemoteAccessError('MEMBER_REMOVED', 'Member was removed');
        if (member.status === 'SUSPENDED')
          throw new RemoteAccessError('MEMBER_SUSPENDED', 'Member is suspended');
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
      }
      const organizationMember = await client.query(
        `SELECT m.*, u.email FROM organization_members m JOIN users u ON u.id = m.user_id
          WHERE m.organization_id = $1 AND m.user_id = $2 FOR UPDATE`,
        [room.organizationId, input.userId],
      );
      if (!organizationMember.rows[0]) {
        await client.query(
          `INSERT INTO organization_members
             (id, organization_id, user_id, role, status, permissions, joined_at)
           VALUES ($1, $2, $3, 'AGENT_USER', 'ACTIVE', $4::jsonb, now())`,
          [
            randomUUID(),
            room.organizationId,
            input.userId,
            JSON.stringify(roomRolePermissions('AGENT_USER')),
          ],
        );
      } else {
        const seat = mapMember({
          ...(organizationMember.rows[0] as Record<string, unknown>),
          email: input.email,
        });
        if (seat.status === 'REMOVED')
          throw new RemoteAccessError('MEMBER_REMOVED', 'Member was removed');
        if (seat.status === 'SUSPENDED')
          throw new RemoteAccessError('MEMBER_SUSPENDED', 'Member is suspended');
      }
      const created = await client.query(
        `INSERT INTO room_members
           (id, room_id, organization_id, user_id, role, status, permissions, joined_at)
         VALUES ($1, $2, $3, $4, 'AGENT_USER', 'ACTIVE', $5::jsonb, now()) RETURNING *`,
        [
          randomUUID(),
          room.id,
          room.organizationId,
          input.userId,
          JSON.stringify(roomRolePermissions('AGENT_USER')),
        ],
      );
      const member = mapMember({
        ...(created.rows[0] as Record<string, unknown>),
        email: input.email,
      });
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
    await this.requirePermission(input.actorUserId, room.organizationId, 'members.manage', room.id);
    const target = await this.requireMember(room.organizationId, input.userId, undefined, room.id);
    if (target.role === 'OWNER')
      throw new RemoteAccessError('LAST_ADMIN', 'The organization owner role cannot be changed');
    const result = await this.pool.query(
      `UPDATE room_members SET role = $3, permissions = $4::jsonb
        WHERE id = $1 AND room_id = $2 RETURNING *`,
      [target.id, room.id, input.role, JSON.stringify(roomRolePermissions(input.role))],
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
           FROM room_members m JOIN users u ON u.id = m.user_id
          WHERE m.room_id = $1 AND m.user_id = $2
          FOR UPDATE`,
        [room.id, input.userId],
      );
      if (!memberResult.rows[0])
        throw new RemoteAccessError('MEMBER_NOT_FOUND', 'Room member not found');
      const member = mapMember(memberResult.rows[0] as Record<string, unknown>);
      if (member.role === 'OWNER') {
        const owners = await client.query(
          `SELECT COUNT(*)::int AS count FROM room_members
            WHERE room_id = $1 AND role = 'OWNER' AND status = 'ACTIVE'`,
          [room.id],
        );
        if (Number(owners.rows[0]?.count ?? 0) <= 1)
          throw new RemoteAccessError(
            'LAST_ADMIN',
            'Transfer ownership before leaving the organization',
          );
      }
      await client.query(
        `UPDATE room_members
            SET status = 'REMOVED', removed_at = now()
          WHERE id = $1 AND room_id = $2`,
        [member.id, room.id],
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

  async recordSecurityEvent(input: {
    organizationId: string;
    roomId?: string | null;
    actorUserId?: string | null;
    deviceId?: string | null;
    projectId?: string | null;
    taskId?: string | null;
    eventType: string;
    requestedAction: string;
    requestedResource?: string | null;
    decision: RoomSecurityEvent['decision'];
    outcome: string;
    evidence?: Record<string, unknown>;
  }): Promise<RoomSecurityEvent> {
    const result = await this.pool.query(
      `INSERT INTO room_security_events(
         id, organization_id, room_id, actor_user_id, device_id, project_id, task_id,
         event_type, severity, requested_action, requested_resource, decision, outcome, evidence
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
       RETURNING *`,
      [
        randomUUID(),
        input.organizationId,
        input.roomId ?? null,
        input.actorUserId ?? null,
        input.deviceId ?? null,
        input.projectId ?? null,
        input.taskId ?? null,
        input.eventType,
        roomSecuritySeverity(input.eventType, input.decision),
        input.requestedAction,
        input.requestedResource ?? null,
        input.decision,
        input.outcome,
        JSON.stringify(sanitizeSecurityEvidence(input.evidence ?? {})),
      ],
    );
    return mapSecurityEvent(result.rows[0] as Record<string, unknown>);
  }

  async listSecurityEvents(actorUserId: string, roomId: string): Promise<RoomSecurityEvent[]> {
    const room = await this.requireRoom(roomId);
    await this.requirePermission(actorUserId, room.organizationId, 'audit.view', room.id);
    const result = await this.pool.query(
      'SELECT * FROM room_security_events WHERE room_id = $1 ORDER BY created_at DESC',
      [room.id],
    );
    return result.rows.map((row) => mapSecurityEvent(row as Record<string, unknown>));
  }

  private async updateMemberStatus(
    input: { actorUserId: string; roomId: string; userId: string },
    status: MemberStatus,
  ): Promise<void> {
    const room = await this.requireRoom(input.roomId);
    await this.requirePermission(input.actorUserId, room.organizationId, 'members.manage', room.id);
    const member = await this.requireMember(room.organizationId, input.userId, undefined, room.id);
    if (member.role === 'OWNER')
      throw new RemoteAccessError(
        'LAST_ADMIN',
        'The organization owner cannot be suspended or removed',
      );
    await this.pool.query(
      `UPDATE room_members SET status = $3,
         suspended_at = CASE WHEN $3 = 'SUSPENDED' THEN now() ELSE NULL END,
         removed_at = CASE WHEN $3 = 'REMOVED' THEN now() ELSE NULL END
       WHERE id = $1 AND room_id = $2`,
      [member.id, room.id, status],
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
    const organization = await this.requireOrganization(organizationId);
    if (organization.status === 'SUSPENDED')
      throw new RemoteAccessError('ORGANIZATION_SUSPENDED', 'Organization access is suspended');
    if (organization.status === 'CLOSED')
      throw new RemoteAccessError('ORGANIZATION_CLOSED', 'Organization access is closed');
    const member = await this.requireMember(organizationId, userId, undefined, roomId);
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

  private async requireOrganization(organizationId: string): Promise<RemoteOrganization> {
    const result = await this.pool.query('SELECT * FROM organizations WHERE id = $1', [
      organizationId,
    ]);
    if (!result.rows[0])
      throw new RemoteAccessError('ORGANIZATION_NOT_FOUND', 'Organization not found');
    return mapOrganization(result.rows[0] as Record<string, unknown>);
  }

  private async requireMember(
    organizationId: string,
    userId: string,
    client?: PoolClient,
    roomId?: string,
  ): Promise<RoomMember> {
    const runner = client ?? this.pool;
    const membershipTable = roomId ? 'room_members' : 'organization_members';
    const scope = roomId ? 'm.organization_id = $1 AND m.room_id = $3' : 'm.organization_id = $1';
    const result = await runner.query(
      `SELECT m.*, u.email FROM ${membershipTable} m JOIN users u ON u.id = m.user_id
        WHERE ${scope} AND m.user_id = $2`,
      roomId ? [organizationId, userId, roomId] : [organizationId, userId],
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

  private async requireImport(roomId: string, importId: string): Promise<RoomFileImportProposal> {
    const result = await this.pool.query(
      'SELECT * FROM room_file_imports WHERE id = $1 AND room_id = $2',
      [importId, roomId],
    );
    if (!result.rows[0])
      throw new RemoteAccessError('ROOM_IMPORT_NOT_FOUND', 'Room file import proposal not found');
    return mapImport(result.rows[0] as Record<string, unknown>);
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
