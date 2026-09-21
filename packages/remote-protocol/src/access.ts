import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { deviceFingerprint } from './pairing.js';
import {
  assertSafeProjectRelativePath,
  buildRoomFileImportManifest,
  normalizeRoomFileUpload,
  RoomFileError,
  type RoomFileImportManifest,
  type RoomFileImportProposal,
  type RoomFileIntent,
  type RoomFileRecord,
} from './room-files.js';

export const ROOM_PERMISSIONS = [
  'room.view',
  'agent.prompt',
  'files.read',
  'files.write',
  'tests.run',
  'terminal.run',
  'packages.install',
  'git.read',
  'git.write',
  'git.push',
  'mcp.use',
  'plugins.use',
  'web.search',
  'web.fetch',
  'destructive.approve',
  'members.invite',
  'members.manage',
  'room.settings.manage',
  'audit.view',
] as const;
export type RoomPermission = (typeof ROOM_PERMISSIONS)[number];
export type RoomRole = 'VIEWER' | 'AGENT_USER' | 'EDITOR' | 'ADMIN';
export type MemberStatus = 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
export type RoomHostAvailability =
  'ONLINE' | 'OFFLINE' | 'UNAVAILABLE' | 'REVOKED' | 'DISCONNECTED' | 'UNKNOWN';
export type RoomSecuritySeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

const ROLE_PERMISSIONS: Record<RoomRole, readonly RoomPermission[]> = {
  VIEWER: ['room.view', 'files.read', 'git.read'],
  AGENT_USER: [
    'room.view',
    'agent.prompt',
    'files.read',
    'files.write',
    'tests.run',
    'git.read',
    'web.search',
    'web.fetch',
  ],
  EDITOR: [
    'room.view',
    'agent.prompt',
    'files.read',
    'files.write',
    'tests.run',
    'terminal.run',
    'git.read',
    'git.write',
    'web.search',
    'web.fetch',
  ],
  ADMIN: [...ROOM_PERMISSIONS],
};

export interface RemoteDeviceRecord {
  id: string;
  userId: string;
  label: string;
  platform: string;
  architecture: string;
  publicKeyFingerprint: string;
  credentialVersion: number;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export interface RemoteOrganization {
  id: string;
  ownerUserId: string;
  planId: string;
  displayName: string;
  seatLimit: number;
  pooledCredits: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  createdAt: string;
}

export interface RoomMember {
  id: string;
  organizationId: string;
  /** Null for the organization seat record; set for an explicit Room membership. */
  roomId: string | null;
  userId: string;
  email: string;
  role: RoomRole | 'OWNER';
  status: MemberStatus;
  permissions: RoomPermission[];
  joinedAt: string | null;
  suspendedAt: string | null;
  removedAt: string | null;
}

export interface RemoteRoom {
  id: string;
  organizationId: string;
  hostUserId: string;
  hostDeviceId: string;
  name: string;
  workspaceRootRelative: string;
  projectId: string;
  workspaceFingerprint: string | null;
  hostAvailability: RoomHostAvailability;
  hostBindingVersion: number;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  createdAt: string;
  updatedAt: string;
}

export interface RoomInvitation {
  id: string;
  roomId: string;
  invitedEmail: string;
  expiresAt: string;
  createdBy: string;
  redeemedBy: string | null;
  redeemedAt: string | null;
  revokedAt: string | null;
}

export interface RoomAuditEvent {
  id: string;
  organizationId: string;
  roomId: string | null;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface RoomSecurityEvent {
  id: string;
  organizationId: string;
  roomId: string | null;
  actorUserId: string | null;
  deviceId: string | null;
  projectId: string | null;
  taskId: string | null;
  eventType: string;
  severity: RoomSecuritySeverity;
  requestedAction: string;
  requestedResource: string | null;
  decision: 'BLOCKED' | 'ALLOWED' | 'FLAGGED';
  outcome: string;
  evidence: Record<string, unknown>;
  createdAt: string;
}

export interface RoomInvitationResult {
  invitation: RoomInvitation;
  token?: string;
}

/** Adapter boundary used by the API so production can use PostgreSQL instead of Maps. */
export interface RemoteAccessPort {
  listDevices(userId: string): RemoteDeviceRecord[] | Promise<RemoteDeviceRecord[]>;
  listAllDevices(): RemoteDeviceRecord[] | Promise<RemoteDeviceRecord[]>;
  registerDevice(input: {
    userId: string;
    label: string;
    platform: string;
    architecture: string;
    publicKeyPem: string;
  }): RemoteDeviceRecord | Promise<RemoteDeviceRecord>;
  heartbeat(userId: string, deviceId: string): RemoteDeviceRecord | Promise<RemoteDeviceRecord>;
  authorizeOwnDevice(
    userId: string,
    deviceId: string,
  ): RemoteDeviceRecord | Promise<RemoteDeviceRecord>;
  getDevice(deviceId: string): RemoteDeviceRecord | Promise<RemoteDeviceRecord>;
  revokeDevice(userId: string, deviceId: string): void | Promise<void>;
  adminRevokeDevice(deviceId: string, reason: string): void | Promise<void>;
  createOrganization(input: {
    ownerUserId: string;
    displayName: string;
    plan: OrganizationPlanInput;
  }): RemoteOrganization | Promise<RemoteOrganization>;
  getOrganization(organizationId: string): RemoteOrganization | Promise<RemoteOrganization>;
  listOrganizations(): RemoteOrganization[] | Promise<RemoteOrganization[]>;
  setOrganizationEntitlement(input: {
    organizationId: string;
    actorUserId: string;
    plan: OrganizationPlanInput;
    status: RemoteOrganization['status'];
    reason: string;
  }): RemoteOrganization | Promise<RemoteOrganization>;
  adminSetOrganizationStatus(input: {
    organizationId: string;
    status: RemoteOrganization['status'];
    reason: string;
  }): RemoteOrganization | Promise<RemoteOrganization>;
  createRoom(input: {
    actorUserId: string;
    organizationId: string;
    hostDeviceId: string;
    name: string;
    workspaceRootRelative: string;
  }): RemoteRoom | Promise<RemoteRoom>;
  getRoom(roomId: string): RemoteRoom | Promise<RemoteRoom>;
  listRooms(actorUserId: string): RemoteRoom[] | Promise<RemoteRoom[]>;
  listAllRooms(): RemoteRoom[] | Promise<RemoteRoom[]>;
  adminSetRoomStatus(input: {
    roomId: string;
    status: RemoteRoom['status'];
    reason: string;
  }): RemoteRoom | Promise<RemoteRoom>;
  handoffRoom(input: {
    actorUserId: string;
    roomId: string;
    hostDeviceId: string;
    workspaceRootRelative: string;
    workspaceFingerprint: string;
  }): RemoteRoom | Promise<RemoteRoom>;
  uploadRoomFile(input: {
    actorUserId: string;
    roomId: string;
    originalName: string;
    contentType: string;
    content: Buffer;
    intent: RoomFileIntent;
  }): RoomFileRecord | Promise<RoomFileRecord>;
  listRoomFiles(actorUserId: string, roomId: string): RoomFileRecord[] | Promise<RoomFileRecord[]>;
  getRoomFile(input: {
    actorUserId: string;
    roomId: string;
    fileId: string;
  }):
    | { record: RoomFileRecord; content: Buffer }
    | Promise<{ record: RoomFileRecord; content: Buffer }>;
  deleteRoomFile(input: {
    actorUserId: string;
    roomId: string;
    fileId: string;
  }): void | Promise<void>;
  createRoomFileImport(input: {
    actorUserId: string;
    roomId: string;
    fileId: string;
    destinationRelative: string;
    existingPaths?: string[];
  }): RoomFileImportProposal | Promise<RoomFileImportProposal>;
  approveRoomFileImport(input: {
    actorUserId: string;
    roomId: string;
    importId: string;
  }): RoomFileImportProposal | Promise<RoomFileImportProposal>;
  rejectRoomFileImport(input: {
    actorUserId: string;
    roomId: string;
    importId: string;
  }): RoomFileImportProposal | Promise<RoomFileImportProposal>;
  completeRoomFileImport(input: {
    actorUserId: string;
    roomId: string;
    importId: string;
    hostDeviceId: string;
    writtenPaths: string[];
  }): RoomFileImportProposal | Promise<RoomFileImportProposal>;
  listRoomFileImports(
    actorUserId: string,
    roomId: string,
  ): RoomFileImportProposal[] | Promise<RoomFileImportProposal[]>;
  recordSecurityEvent(input: {
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
  }): RoomSecurityEvent | Promise<RoomSecurityEvent>;
  listSecurityEvents(
    actorUserId: string,
    roomId: string,
  ): RoomSecurityEvent[] | Promise<RoomSecurityEvent[]>;
  listRoomMembers(actorUserId: string, roomId: string): RoomMember[] | Promise<RoomMember[]>;
  inviteMember(input: {
    actorUserId: string;
    roomId: string;
    email: string;
    idempotencyKey: string;
  }): RoomInvitationResult | Promise<RoomInvitationResult>;
  redeemInvitation(input: {
    userId: string;
    email: string;
    token: string;
  }): RoomMember | Promise<RoomMember>;
  setMemberRole(input: {
    actorUserId: string;
    roomId: string;
    userId: string;
    role: RoomRole;
  }): RoomMember | Promise<RoomMember>;
  suspendMember(input: {
    actorUserId: string;
    roomId: string;
    userId: string;
  }): void | Promise<void>;
  restoreMember(input: {
    actorUserId: string;
    roomId: string;
    userId: string;
  }): void | Promise<void>;
  removeMember(input: {
    actorUserId: string;
    roomId: string;
    userId: string;
  }): void | Promise<void>;
  leaveRoom(input: { userId: string; roomId: string }): void | Promise<void>;
  authorizeRoomAction(input: {
    actorUserId: string;
    roomId: string;
    permission: RoomPermission;
  }): RoomMember | Promise<RoomMember>;
}

export interface OrganizationPlanInput {
  id: string;
  seats: number;
  monthlyCredits: string;
  pooledCredits: boolean;
  crossPersonRooms: boolean;
}

export class RemoteAccessError extends Error {
  constructor(
    public readonly code:
      | 'PLAN_NOT_ELIGIBLE'
      | 'DEVICE_NOT_FOUND'
      | 'DEVICE_REVOKED'
      | 'DEVICE_OFFLINE'
      | 'ORGANIZATION_NOT_FOUND'
      | 'ORGANIZATION_SUSPENDED'
      | 'ORGANIZATION_CLOSED'
      | 'SEAT_LIMIT'
      | 'ROOM_NOT_FOUND'
      | 'ROOM_PATH_INVALID'
      | 'ROOM_HOST_INVALID'
      | 'ROOM_HOST_OFFLINE'
      | 'ROOM_FILE_NOT_FOUND'
      | 'ROOM_FILE_FORBIDDEN'
      | 'ROOM_FILE_STATE_INVALID'
      | 'ROOM_IMPORT_NOT_FOUND'
      | 'ROOM_IMPORT_CONFLICT'
      | 'MEMBER_NOT_FOUND'
      | 'MEMBER_SUSPENDED'
      | 'MEMBER_REMOVED'
      | 'PERMISSION_DENIED'
      | 'INVITATION_INVALID'
      | 'INVITATION_EXPIRED'
      | 'INVITATION_REVOKED'
      | 'INVITATION_EMAIL_MISMATCH'
      | 'LAST_ADMIN'
      | 'IDEMPOTENCY_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'RemoteAccessError';
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function assertRoomWorkspacePath(value: string): string {
  const normalized = value.trim().replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.startsWith('\\\\') ||
    normalized.startsWith('//') ||
    normalized.startsWith('?/') ||
    normalized.includes('%') ||
    normalized.includes(':') ||
    normalized.includes('$') ||
    normalized.includes('\0') ||
    segments.some(
      (segment) =>
        segment === '..' ||
        segment === '.' ||
        /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(segment),
    )
  ) {
    throw new RemoteAccessError(
      'ROOM_PATH_INVALID',
      'Room workspaces must use a host-approved relative workspace identifier',
    );
  }
  return normalized;
}

export function roomRolePermissions(role: RoomRole | 'OWNER'): RoomPermission[] {
  if (role === 'OWNER') return [...ROLE_PERMISSIONS.ADMIN];
  return [...ROLE_PERMISSIONS[role]];
}

export function roomHostAvailability(
  device: Pick<RemoteDeviceRecord, 'lastSeenAt' | 'revokedAt'>,
  now = new Date(),
): RoomHostAvailability {
  if (device.revokedAt) return 'REVOKED';
  if (!device.lastSeenAt) return 'UNKNOWN';
  const ageMs = now.getTime() - new Date(device.lastSeenAt).getTime();
  if (ageMs <= 2 * 60 * 1000) return 'ONLINE';
  if (ageMs <= 10 * 60 * 1000) return 'DISCONNECTED';
  return 'OFFLINE';
}

export function roomSecuritySeverity(
  eventType: string,
  decision: RoomSecurityEvent['decision'],
): RoomSecuritySeverity {
  if (
    eventType === 'CREDENTIAL_EXFILTRATION_ATTEMPT' ||
    eventType === 'PRIVILEGE_ESCALATION_ATTEMPT'
  )
    return 'CRITICAL';
  if (
    eventType === 'PATH_ESCAPE_ATTEMPT' ||
    eventType === 'UNAUTHORIZED_PROJECT_ACCESS' ||
    eventType === 'UNAUTHORIZED_HOST_CONNECTION' ||
    eventType === 'BILLING_CONTEXT_SPOOF' ||
    eventType === 'POLICY_BYPASS_ATTEMPT' ||
    eventType === 'SUSPICIOUS_ARCHIVE'
  )
    return 'HIGH';
  if (decision === 'BLOCKED') return 'MEDIUM';
  return 'INFO';
}

export function sanitizeSecurityEvidence(value: Record<string, unknown>): Record<string, unknown> {
  const redact = (candidate: unknown): unknown => {
    if (typeof candidate === 'string') {
      if (
        /(?:password|secret|token|api[_-]?key|authorization|cookie|private[_-]?key)/i.test(
          candidate,
        ) ||
        /(?:sk-[A-Za-z0-9]|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/.test(candidate)
      )
        return '[REDACTED]';
      return candidate.slice(0, 2_000);
    }
    if (Array.isArray(candidate)) return candidate.slice(0, 50).map(redact);
    if (candidate && typeof candidate === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(candidate)) {
        result[key] =
          /(?:password|secret|token|api[_-]?key|authorization|cookie|private[_-]?key)/i.test(key)
            ? '[REDACTED]'
            : redact(child);
      }
      return result;
    }
    return candidate;
  };
  return redact(value) as Record<string, unknown>;
}

export class RemoteAccessService {
  private readonly devices = new Map<string, RemoteDeviceRecord>();
  private readonly organizations = new Map<string, RemoteOrganization>();
  private readonly members = new Map<string, RoomMember>();
  private readonly rooms = new Map<string, RemoteRoom>();
  private readonly invitations = new Map<string, { record: RoomInvitation; tokenHash: string }>();
  private readonly invitationByIdempotency = new Map<string, string>();
  private readonly audit: RoomAuditEvent[] = [];
  private readonly roomFiles = new Map<string, { record: RoomFileRecord; content: Buffer }>();
  private readonly roomImports = new Map<string, RoomFileImportProposal>();
  private readonly securityEvents: RoomSecurityEvent[] = [];
  private readonly now: () => Date;
  private readonly invitationTtlMs: number;

  constructor(options: { now?: () => Date; invitationTtlMs?: number } = {}) {
    this.now = options.now ?? (() => new Date());
    this.invitationTtlMs = options.invitationTtlMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  registerDevice(input: {
    userId: string;
    label: string;
    platform: string;
    architecture: string;
    publicKeyPem: string;
  }): RemoteDeviceRecord {
    const fingerprint = deviceFingerprint(input.publicKeyPem);
    const existing = [...this.devices.values()].find(
      (device) => device.userId === input.userId && device.publicKeyFingerprint === fingerprint,
    );
    if (existing) {
      if (existing.revokedAt) throw new RemoteAccessError('DEVICE_REVOKED', 'Device is revoked');
      existing.label = input.label;
      existing.platform = input.platform;
      existing.architecture = input.architecture;
      return { ...existing };
    }
    const createdAt = this.now().toISOString();
    const device: RemoteDeviceRecord = {
      id: randomUUID(),
      userId: input.userId,
      label: input.label,
      platform: input.platform,
      architecture: input.architecture,
      publicKeyFingerprint: fingerprint,
      credentialVersion: 1,
      createdAt,
      lastSeenAt: null,
      revokedAt: null,
    };
    this.devices.set(device.id, device);
    return { ...device };
  }

  listDevices(userId: string): RemoteDeviceRecord[] {
    return [...this.devices.values()]
      .filter((device) => device.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((device) => ({ ...device }));
  }

  listAllDevices(): RemoteDeviceRecord[] {
    return [...this.devices.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((device) => ({ ...device }));
  }

  heartbeat(userId: string, deviceId: string): RemoteDeviceRecord {
    const device = this.requireDevice(deviceId);
    this.assertDeviceOwner(device, userId);
    if (device.revokedAt) throw new RemoteAccessError('DEVICE_REVOKED', 'Device is revoked');
    device.lastSeenAt = this.now().toISOString();
    return { ...device };
  }

  authorizeOwnDevice(userId: string, deviceId: string): RemoteDeviceRecord {
    const device = this.requireDevice(deviceId);
    this.assertDeviceOwner(device, userId);
    if (device.revokedAt) throw new RemoteAccessError('DEVICE_REVOKED', 'Device is revoked');
    return { ...device };
  }

  getDevice(deviceId: string): RemoteDeviceRecord {
    const device = this.requireDevice(deviceId);
    if (device.revokedAt) throw new RemoteAccessError('DEVICE_REVOKED', 'Device is revoked');
    return { ...device };
  }

  revokeDevice(userId: string, deviceId: string): void {
    const device = this.requireDevice(deviceId);
    this.assertDeviceOwner(device, userId);
    device.revokedAt = this.now().toISOString();
    device.credentialVersion += 1;
  }

  adminRevokeDevice(deviceId: string, reason: string): void {
    const device = this.requireDevice(deviceId);
    device.revokedAt = this.now().toISOString();
    device.credentialVersion += 1;
    this.recordAudit(device.userId, null, null, 'device.revoked_by_admin', 'device', deviceId, {
      reason,
    });
  }

  createOrganization(input: {
    ownerUserId: string;
    displayName: string;
    plan: OrganizationPlanInput;
  }): RemoteOrganization {
    if (!input.plan.crossPersonRooms || !input.plan.pooledCredits)
      throw new RemoteAccessError(
        'PLAN_NOT_ELIGIBLE',
        'Only Team and Business plans support Rooms',
      );
    const organization: RemoteOrganization = {
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      planId: input.plan.id,
      displayName: input.displayName.trim(),
      seatLimit: input.plan.seats,
      pooledCredits: input.plan.monthlyCredits,
      status: 'ACTIVE',
      createdAt: this.now().toISOString(),
    };
    this.organizations.set(organization.id, organization);
    const owner: RoomMember = {
      id: randomUUID(),
      organizationId: organization.id,
      roomId: null,
      userId: input.ownerUserId,
      email: '',
      role: 'OWNER',
      status: 'ACTIVE',
      permissions: roomRolePermissions('OWNER'),
      joinedAt: organization.createdAt,
      suspendedAt: null,
      removedAt: null,
    };
    this.members.set(owner.id, owner);
    this.recordAudit(
      organization.id,
      null,
      input.ownerUserId,
      'organization.created',
      'organization',
      organization.id,
    );
    return { ...organization };
  }

  getOrganization(organizationId: string): RemoteOrganization {
    return { ...this.requireOrganization(organizationId) };
  }

  listOrganizations(): RemoteOrganization[] {
    return [...this.organizations.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((organization) => ({ ...organization }));
  }

  setOrganizationEntitlement(input: {
    organizationId: string;
    actorUserId: string;
    plan: OrganizationPlanInput;
    status: RemoteOrganization['status'];
    reason: string;
  }): RemoteOrganization {
    const organization = this.requireOrganization(input.organizationId);
    if (organization.ownerUserId !== input.actorUserId)
      throw new RemoteAccessError(
        'PERMISSION_DENIED',
        'Only the organization owner can change its entitlement',
      );
    organization.planId = input.plan.id;
    organization.seatLimit = input.plan.seats;
    organization.pooledCredits = input.plan.monthlyCredits;
    organization.status = input.status;
    this.recordAudit(
      organization.id,
      null,
      input.actorUserId,
      'organization.entitlement.changed',
      'organization',
      organization.id,
    );
    return { ...organization };
  }

  adminSetOrganizationStatus(input: {
    organizationId: string;
    status: RemoteOrganization['status'];
    reason: string;
  }): RemoteOrganization {
    const organization = this.requireOrganization(input.organizationId);
    organization.status = input.status;
    this.recordAudit(
      organization.id,
      null,
      null,
      'organization.status.changed_by_admin',
      'organization',
      organization.id,
      { reason: input.reason },
    );
    return { ...organization };
  }

  createRoom(input: {
    actorUserId: string;
    organizationId: string;
    hostDeviceId: string;
    name: string;
    workspaceRootRelative: string;
  }): RemoteRoom {
    const organization = this.requireOrganization(input.organizationId);
    this.assertPermission(input.actorUserId, organization.id, 'room.settings.manage');
    const hostDevice = this.requireDevice(input.hostDeviceId);
    this.assertDeviceOwner(hostDevice, input.actorUserId);
    const room: RemoteRoom = {
      id: randomUUID(),
      organizationId: organization.id,
      hostUserId: input.actorUserId,
      hostDeviceId: input.hostDeviceId,
      name: input.name.trim(),
      workspaceRootRelative: assertRoomWorkspacePath(input.workspaceRootRelative),
      projectId: randomUUID(),
      workspaceFingerprint: null,
      hostAvailability: roomHostAvailability(hostDevice, this.now()),
      hostBindingVersion: 1,
      status: 'ACTIVE',
      createdAt: this.now().toISOString(),
      updatedAt: this.now().toISOString(),
    };
    this.rooms.set(room.id, room);
    const ownerSeat = this.findMember(organization.id, input.actorUserId, null);
    if (!ownerSeat)
      throw new RemoteAccessError('MEMBER_NOT_FOUND', 'Organization owner seat is unavailable');
    const roomOwner: RoomMember = {
      ...ownerSeat,
      id: randomUUID(),
      roomId: room.id,
      permissions: roomRolePermissions('OWNER'),
      joinedAt: room.createdAt,
      suspendedAt: null,
      removedAt: null,
    };
    this.members.set(roomOwner.id, roomOwner);
    this.recordAudit(organization.id, room.id, input.actorUserId, 'room.created', 'room', room.id);
    return { ...room };
  }

  inviteMember(input: {
    actorUserId: string;
    roomId: string;
    email: string;
    idempotencyKey: string;
    role?: RoomRole;
  }): { invitation: RoomInvitation; token?: string } {
    const room = this.requireRoom(input.roomId);
    this.assertPermission(input.actorUserId, room.organizationId, 'members.invite', room.id);
    const existingId = this.invitationByIdempotency.get(input.idempotencyKey);
    if (existingId) {
      const existing = this.invitations.get(existingId);
      if (!existing)
        throw new RemoteAccessError('IDEMPOTENCY_CONFLICT', 'Invitation is unavailable');
      return { invitation: { ...existing.record } };
    }
    const organization = this.requireOrganization(room.organizationId);
    const activeMemberCount = this.activeMembers(organization.id).length;
    if (activeMemberCount >= organization.seatLimit)
      throw new RemoteAccessError('SEAT_LIMIT', 'Organization seat limit reached');
    const rawToken = randomBytes(32).toString('base64url');
    const createdAt = this.now();
    const record: RoomInvitation = {
      id: randomUUID(),
      roomId: room.id,
      invitedEmail: normalizeEmail(input.email),
      expiresAt: new Date(createdAt.getTime() + this.invitationTtlMs).toISOString(),
      createdBy: input.actorUserId,
      redeemedBy: null,
      redeemedAt: null,
      revokedAt: null,
    };
    this.invitations.set(record.id, { record, tokenHash: hashInvitationToken(rawToken) });
    this.invitationByIdempotency.set(input.idempotencyKey, record.id);
    this.recordAudit(
      room.organizationId,
      room.id,
      input.actorUserId,
      'room.invitation.created',
      'invitation',
      record.id,
    );
    return { invitation: { ...record }, token: rawToken };
  }

  redeemInvitation(input: { userId: string; email: string; token: string }): RoomMember {
    const entry = [...this.invitations.values()].find(
      (candidate) => candidate.tokenHash === hashInvitationToken(input.token),
    );
    if (!entry) throw new RemoteAccessError('INVITATION_INVALID', 'Invitation is invalid');
    const invitation = entry.record;
    if (invitation.revokedAt)
      throw new RemoteAccessError('INVITATION_REVOKED', 'Invitation is revoked');
    if (new Date(invitation.expiresAt).getTime() <= this.now().getTime())
      throw new RemoteAccessError('INVITATION_EXPIRED', 'Invitation has expired');
    if (normalizeEmail(input.email) !== invitation.invitedEmail)
      throw new RemoteAccessError(
        'INVITATION_EMAIL_MISMATCH',
        'Invitation email does not match account',
      );
    const room = this.requireRoom(invitation.roomId);
    this.assertOrganizationActive(room.organizationId);
    const existingRoomMember = this.findMember(room.organizationId, input.userId, room.id);
    if (existingRoomMember) {
      if (existingRoomMember.status === 'REMOVED')
        throw new RemoteAccessError('MEMBER_REMOVED', 'Member was removed');
      if (existingRoomMember.status === 'SUSPENDED')
        throw new RemoteAccessError('MEMBER_SUSPENDED', 'Member is suspended');
      invitation.redeemedBy = input.userId;
      invitation.redeemedAt ??= this.now().toISOString();
      return { ...existingRoomMember, permissions: [...existingRoomMember.permissions] };
    }
    let organizationMember = this.findMember(room.organizationId, input.userId, null);
    if (!organizationMember) {
      organizationMember = {
        id: randomUUID(),
        organizationId: room.organizationId,
        roomId: null,
        userId: input.userId,
        email: invitation.invitedEmail,
        role: 'AGENT_USER',
        status: 'ACTIVE',
        permissions: roomRolePermissions('AGENT_USER'),
        joinedAt: this.now().toISOString(),
        suspendedAt: null,
        removedAt: null,
      };
      this.members.set(organizationMember.id, organizationMember);
    }
    const member: RoomMember = {
      id: randomUUID(),
      organizationId: room.organizationId,
      roomId: room.id,
      userId: input.userId,
      email: invitation.invitedEmail,
      role: 'AGENT_USER',
      status: 'ACTIVE',
      permissions: roomRolePermissions('AGENT_USER'),
      joinedAt: this.now().toISOString(),
      suspendedAt: null,
      removedAt: null,
    };
    this.members.set(member.id, member);
    invitation.redeemedBy = input.userId;
    invitation.redeemedAt = this.now().toISOString();
    this.recordAudit(
      room.organizationId,
      room.id,
      input.userId,
      'room.invitation.redeemed',
      'member',
      member.id,
    );
    return { ...member, permissions: [...member.permissions] };
  }

  listRoomMembers(actorUserId: string, roomId: string): RoomMember[] {
    const room = this.requireRoom(roomId);
    this.assertPermission(actorUserId, room.organizationId, 'room.view', room.id);
    return [...this.members.values()]
      .filter(
        (member) => member.organizationId === room.organizationId && member.roomId === room.id,
      )
      .map((member) => ({ ...member, permissions: [...member.permissions] }));
  }

  setMemberRole(input: {
    actorUserId: string;
    roomId: string;
    userId: string;
    role: RoomRole;
  }): RoomMember {
    const room = this.requireRoom(input.roomId);
    this.assertPermission(input.actorUserId, room.organizationId, 'members.manage', room.id);
    const member = this.requireMember(room.organizationId, input.userId, room.id);
    if (member.status === 'REMOVED')
      throw new RemoteAccessError('MEMBER_REMOVED', 'Member was removed');
    member.role = input.role;
    member.permissions = roomRolePermissions(input.role);
    this.recordAudit(
      room.organizationId,
      room.id,
      input.actorUserId,
      'room.member.role_changed',
      'member',
      member.id,
    );
    return { ...member, permissions: [...member.permissions] };
  }

  suspendMember(input: { actorUserId: string; roomId: string; userId: string }): void {
    this.updateMemberStatus(input, 'SUSPENDED');
  }

  restoreMember(input: { actorUserId: string; roomId: string; userId: string }): void {
    this.updateMemberStatus(input, 'ACTIVE');
  }

  removeMember(input: { actorUserId: string; roomId: string; userId: string }): void {
    this.updateMemberStatus(input, 'REMOVED');
  }

  leaveRoom(input: { userId: string; roomId: string }): void {
    const room = this.requireRoom(input.roomId);
    const member = this.requireMember(room.organizationId, input.userId, room.id);
    if (
      member.role === 'OWNER' &&
      this.roomMembers(room.id).filter((item) => item.role === 'OWNER' && item.status === 'ACTIVE')
        .length <= 1
    )
      throw new RemoteAccessError(
        'LAST_ADMIN',
        'Transfer ownership before leaving the organization',
      );
    member.status = 'REMOVED';
    member.removedAt = this.now().toISOString();
    this.recordAudit(
      room.organizationId,
      room.id,
      input.userId,
      'room.member.left',
      'member',
      member.id,
    );
  }

  authorizeRoomAction(input: {
    actorUserId: string;
    roomId: string;
    permission: RoomPermission;
  }): RoomMember {
    const room = this.requireRoom(input.roomId);
    return this.assertPermission(input.actorUserId, room.organizationId, input.permission, room.id);
  }

  handoffRoom(input: {
    actorUserId: string;
    roomId: string;
    hostDeviceId: string;
    workspaceRootRelative: string;
    workspaceFingerprint: string;
  }): RemoteRoom {
    const room = this.requireRoom(input.roomId);
    this.assertPermission(input.actorUserId, room.organizationId, 'room.settings.manage', room.id);
    const device = this.requireDevice(input.hostDeviceId);
    if (device.revokedAt) throw new RemoteAccessError('DEVICE_REVOKED', 'Host device is revoked');
    const member = this.findMember(room.organizationId, device.userId, room.id);
    if (!member || member.status !== 'ACTIVE')
      throw new RemoteAccessError(
        'ROOM_HOST_INVALID',
        'Destination host is not an active Room member',
      );
    const workspaceFingerprint = input.workspaceFingerprint.trim();
    if (!workspaceFingerprint || workspaceFingerprint.length > 512)
      throw new RemoteAccessError('ROOM_HOST_INVALID', 'Workspace fingerprint is invalid');
    room.hostUserId = device.userId;
    room.hostDeviceId = device.id;
    room.workspaceRootRelative = assertRoomWorkspacePath(input.workspaceRootRelative);
    room.workspaceFingerprint = workspaceFingerprint;
    room.hostBindingVersion += 1;
    room.hostAvailability = roomHostAvailability(device, this.now());
    room.updatedAt = this.now().toISOString();
    this.recordAudit(
      room.organizationId,
      room.id,
      input.actorUserId,
      'room.project.host_handoff',
      'room_project',
      room.projectId,
    );
    return { ...room };
  }

  uploadRoomFile(input: {
    actorUserId: string;
    roomId: string;
    originalName: string;
    contentType: string;
    content: Buffer;
    intent: RoomFileIntent;
  }): RoomFileRecord {
    const room = this.requireRoom(input.roomId);
    this.assertPermission(input.actorUserId, room.organizationId, 'files.write', room.id);
    let normalized;
    try {
      normalized = normalizeRoomFileUpload(input);
    } catch (error) {
      if (error instanceof RoomFileError) {
        void this.recordSecurityEvent({
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
      }
      throw error;
    }
    const now = this.now().toISOString();
    const record: RoomFileRecord = {
      id: randomUUID(),
      organizationId: room.organizationId,
      roomId: room.id,
      uploaderUserId: input.actorUserId,
      originalName: input.originalName,
      safeName: normalized.safeName,
      contentType: normalized.contentType,
      sizeBytes: normalized.sizeBytes,
      checksumSha256: normalized.checksumSha256,
      intent: input.intent,
      securityState: 'SAFE',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.roomFiles.set(record.id, { record, content: Buffer.from(input.content) });
    this.recordAudit(
      room.organizationId,
      room.id,
      input.actorUserId,
      'room.file.uploaded',
      'room_file',
      record.id,
    );
    return { ...record };
  }

  listRoomFiles(actorUserId: string, roomId: string): RoomFileRecord[] {
    const room = this.requireRoom(roomId);
    this.assertPermission(actorUserId, room.organizationId, 'files.read', room.id);
    return [...this.roomFiles.values()]
      .filter(({ record }) => record.roomId === room.id && record.deletedAt === null)
      .map(({ record }) => ({ ...record }));
  }

  getRoomFile(input: { actorUserId: string; roomId: string; fileId: string }): {
    record: RoomFileRecord;
    content: Buffer;
  } {
    const room = this.requireRoom(input.roomId);
    this.assertPermission(input.actorUserId, room.organizationId, 'files.read', room.id);
    const entry = this.roomFiles.get(input.fileId);
    if (!entry || entry.record.roomId !== room.id || entry.record.deletedAt)
      throw new RemoteAccessError('ROOM_FILE_NOT_FOUND', 'Room file not found');
    return { record: { ...entry.record }, content: Buffer.from(entry.content) };
  }

  deleteRoomFile(input: { actorUserId: string; roomId: string; fileId: string }): void {
    const room = this.requireRoom(input.roomId);
    this.assertPermission(input.actorUserId, room.organizationId, 'files.write', room.id);
    const entry = this.roomFiles.get(input.fileId);
    if (!entry || entry.record.roomId !== room.id || entry.record.deletedAt)
      throw new RemoteAccessError('ROOM_FILE_NOT_FOUND', 'Room file not found');
    entry.record.securityState = 'DELETED';
    entry.record.deletedAt = this.now().toISOString();
    entry.record.updatedAt = entry.record.deletedAt;
    this.recordAudit(
      room.organizationId,
      room.id,
      input.actorUserId,
      'room.file.deleted',
      'room_file',
      input.fileId,
    );
  }

  createRoomFileImport(input: {
    actorUserId: string;
    roomId: string;
    fileId: string;
    destinationRelative: string;
    existingPaths?: string[];
  }): RoomFileImportProposal {
    const room = this.requireRoom(input.roomId);
    this.assertPermission(input.actorUserId, room.organizationId, 'files.write', room.id);
    const file = this.getRoomFile({
      actorUserId: input.actorUserId,
      roomId: room.id,
      fileId: input.fileId,
    });
    if (file.record.intent !== 'ADD_TO_PROJECT' || file.record.securityState !== 'SAFE')
      throw new RemoteAccessError(
        'ROOM_FILE_STATE_INVALID',
        'Room file is not ready for project import',
      );
    let manifest: RoomFileImportManifest;
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
      if (error instanceof RoomFileError) {
        void this.recordSecurityEvent({
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
      }
      throw error;
    }
    const now = this.now().toISOString();
    const proposal: RoomFileImportProposal = {
      id: randomUUID(),
      organizationId: room.organizationId,
      roomId: room.id,
      fileId: file.record.id,
      requestedBy: input.actorUserId,
      destinationRelative: assertSafeProjectRelativePath(input.destinationRelative, true),
      status: 'PREVIEW',
      manifest,
      approvedBy: null,
      approvedAt: null,
      completedBy: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.roomImports.set(proposal.id, proposal);
    this.recordAudit(
      room.organizationId,
      room.id,
      input.actorUserId,
      'room.file.import.previewed',
      'room_file_import',
      proposal.id,
    );
    return this.cloneImport(proposal);
  }

  approveRoomFileImport(input: {
    actorUserId: string;
    roomId: string;
    importId: string;
  }): RoomFileImportProposal {
    const proposal = this.requireImport(input.roomId, input.importId);
    const room = this.requireRoom(input.roomId);
    this.assertPermission(input.actorUserId, room.organizationId, 'files.write', room.id);
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
      this.assertPermission(input.actorUserId, room.organizationId, 'destructive.approve', room.id);
    proposal.status = 'APPROVED';
    proposal.approvedBy = input.actorUserId;
    proposal.approvedAt = this.now().toISOString();
    proposal.updatedAt = proposal.approvedAt;
    this.recordAudit(
      room.organizationId,
      room.id,
      input.actorUserId,
      'room.file.import.approved',
      'room_file_import',
      proposal.id,
    );
    return this.cloneImport(proposal);
  }

  rejectRoomFileImport(input: {
    actorUserId: string;
    roomId: string;
    importId: string;
  }): RoomFileImportProposal {
    const proposal = this.requireImport(input.roomId, input.importId);
    const room = this.requireRoom(input.roomId);
    this.assertPermission(input.actorUserId, room.organizationId, 'files.write', room.id);
    if (proposal.status === 'IMPORTED')
      throw new RemoteAccessError('ROOM_FILE_STATE_INVALID', 'Imported content cannot be rejected');
    proposal.status = 'REJECTED';
    proposal.updatedAt = this.now().toISOString();
    this.recordAudit(
      room.organizationId,
      room.id,
      input.actorUserId,
      'room.file.import.rejected',
      'room_file_import',
      proposal.id,
    );
    return this.cloneImport(proposal);
  }

  completeRoomFileImport(input: {
    actorUserId: string;
    roomId: string;
    importId: string;
    hostDeviceId: string;
    writtenPaths: string[];
  }): RoomFileImportProposal {
    const proposal = this.requireImport(input.roomId, input.importId);
    const room = this.requireRoom(input.roomId);
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
    const device = this.requireDevice(input.hostDeviceId);
    this.assertDeviceOwner(device, input.actorUserId);
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
    proposal.status = 'IMPORTED';
    proposal.completedBy = input.actorUserId;
    proposal.completedAt = this.now().toISOString();
    proposal.updatedAt = proposal.completedAt;
    this.recordAudit(
      room.organizationId,
      room.id,
      input.actorUserId,
      'room.file.import.completed',
      'room_file_import',
      proposal.id,
    );
    return this.cloneImport(proposal);
  }

  listRoomFileImports(actorUserId: string, roomId: string): RoomFileImportProposal[] {
    const room = this.requireRoom(roomId);
    this.assertPermission(actorUserId, room.organizationId, 'files.read', room.id);
    return [...this.roomImports.values()]
      .filter((proposal) => proposal.roomId === room.id)
      .map((proposal) => this.cloneImport(proposal));
  }

  recordSecurityEvent(input: {
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
  }): RoomSecurityEvent {
    const event: RoomSecurityEvent = {
      id: randomUUID(),
      organizationId: input.organizationId,
      roomId: input.roomId ?? null,
      actorUserId: input.actorUserId ?? null,
      deviceId: input.deviceId ?? null,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      eventType: input.eventType,
      severity: roomSecuritySeverity(input.eventType, input.decision),
      requestedAction: input.requestedAction,
      requestedResource: input.requestedResource ?? null,
      decision: input.decision,
      outcome: input.outcome,
      evidence: sanitizeSecurityEvidence(input.evidence ?? {}),
      createdAt: this.now().toISOString(),
    };
    this.securityEvents.push(event);
    return { ...event, evidence: { ...event.evidence } };
  }

  listSecurityEvents(actorUserId: string, roomId: string): RoomSecurityEvent[] {
    const room = this.requireRoom(roomId);
    this.assertPermission(actorUserId, room.organizationId, 'audit.view', room.id);
    return this.securityEvents
      .filter((event) => event.roomId === room.id)
      .map((event) => ({ ...event, evidence: { ...event.evidence } }));
  }

  getRoom(roomId: string): RemoteRoom {
    const room = this.requireRoom(roomId);
    const device = this.devices.get(room.hostDeviceId);
    room.hostAvailability = device ? roomHostAvailability(device, this.now()) : 'UNAVAILABLE';
    return { ...room };
  }

  listRooms(actorUserId: string): RemoteRoom[] {
    return [...this.rooms.values()]
      .filter((room) => {
        try {
          this.assertPermission(actorUserId, room.organizationId, 'room.view', room.id);
          return room.status === 'ACTIVE';
        } catch {
          return false;
        }
      })
      .map((room) => this.getRoom(room.id));
  }

  listAllRooms(): RemoteRoom[] {
    return [...this.rooms.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((room) => this.getRoom(room.id));
  }

  adminSetRoomStatus(input: {
    roomId: string;
    status: RemoteRoom['status'];
    reason: string;
  }): RemoteRoom {
    const room = this.requireRoom(input.roomId);
    room.status = input.status;
    room.updatedAt = this.now().toISOString();
    this.recordAudit(
      room.organizationId,
      room.id,
      null,
      'room.status.changed_by_admin',
      'room',
      room.id,
      { reason: input.reason },
    );
    return { ...room };
  }

  listAudit(organizationId: string): RoomAuditEvent[] {
    return this.audit
      .filter((event) => event.organizationId === organizationId)
      .map((event) => ({ ...event }));
  }

  private requireImport(roomId: string, importId: string): RoomFileImportProposal {
    const proposal = this.roomImports.get(importId);
    if (!proposal || proposal.roomId !== roomId)
      throw new RemoteAccessError('ROOM_IMPORT_NOT_FOUND', 'Room file import proposal not found');
    return proposal;
  }

  private cloneImport(proposal: RoomFileImportProposal): RoomFileImportProposal {
    return {
      ...proposal,
      manifest: {
        ...proposal.manifest,
        entries: proposal.manifest.entries.map((entry) => ({ ...entry })),
      },
    };
  }

  private updateMemberStatus(
    input: { actorUserId: string; roomId: string; userId: string },
    status: MemberStatus,
  ): void {
    const room = this.requireRoom(input.roomId);
    this.assertPermission(input.actorUserId, room.organizationId, 'members.manage', room.id);
    const member = this.requireMember(room.organizationId, input.userId, room.id);
    if (member.role === 'OWNER')
      throw new RemoteAccessError(
        'LAST_ADMIN',
        'The organization owner cannot be suspended or removed',
      );
    member.status = status;
    member.suspendedAt = status === 'SUSPENDED' ? this.now().toISOString() : null;
    member.removedAt = status === 'REMOVED' ? this.now().toISOString() : null;
    this.recordAudit(
      room.organizationId,
      room.id,
      input.actorUserId,
      `room.member.${status.toLowerCase()}`,
      'member',
      member.id,
    );
  }

  private assertPermission(
    userId: string,
    organizationId: string,
    permission: RoomPermission,
    roomId?: string,
  ): RoomMember {
    this.assertOrganizationActive(organizationId);
    const member = this.requireMember(organizationId, userId, roomId);
    if (member.status === 'SUSPENDED')
      throw new RemoteAccessError('MEMBER_SUSPENDED', 'Room member is suspended');
    if (member.status === 'REMOVED')
      throw new RemoteAccessError('MEMBER_REMOVED', 'Room member was removed');
    if (!member.permissions.includes(permission))
      throw new RemoteAccessError('PERMISSION_DENIED', `Missing permission: ${permission}`);
    if (roomId) {
      const room = this.requireRoom(roomId);
      if (room.organizationId !== organizationId)
        throw new RemoteAccessError('PERMISSION_DENIED', 'Room does not belong to organization');
    }
    return member;
  }

  private activeMembers(organizationId: string): RoomMember[] {
    return [...this.members.values()].filter(
      (member) =>
        member.organizationId === organizationId &&
        member.roomId === null &&
        member.status !== 'REMOVED',
    );
  }

  private roomMembers(roomId: string): RoomMember[] {
    return [...this.members.values()].filter((member) => member.roomId === roomId);
  }

  private findMember(
    organizationId: string,
    userId: string,
    roomId: string | null,
  ): RoomMember | undefined {
    return [...this.members.values()].find(
      (member) =>
        member.organizationId === organizationId &&
        member.userId === userId &&
        member.roomId === roomId,
    );
  }

  private requireMember(
    organizationId: string,
    userId: string,
    roomId: string | null = null,
  ): RoomMember {
    const member = this.findMember(organizationId, userId, roomId);
    if (!member) throw new RemoteAccessError('MEMBER_NOT_FOUND', 'Room member not found');
    return member;
  }

  private requireDevice(deviceId: string): RemoteDeviceRecord {
    const device = this.devices.get(deviceId);
    if (!device) throw new RemoteAccessError('DEVICE_NOT_FOUND', 'Device not found');
    return device;
  }

  private assertDeviceOwner(device: RemoteDeviceRecord, userId: string): void {
    if (device.userId !== userId)
      throw new RemoteAccessError('DEVICE_NOT_FOUND', 'Device not found');
  }

  private requireOrganization(organizationId: string): RemoteOrganization {
    const organization = this.organizations.get(organizationId);
    if (!organization)
      throw new RemoteAccessError('ORGANIZATION_NOT_FOUND', 'Organization not found');
    return organization;
  }

  private assertOrganizationActive(organizationId: string): void {
    const organization = this.requireOrganization(organizationId);
    if (organization.status === 'SUSPENDED')
      throw new RemoteAccessError('ORGANIZATION_SUSPENDED', 'Organization access is suspended');
    if (organization.status === 'CLOSED')
      throw new RemoteAccessError('ORGANIZATION_CLOSED', 'Organization access is closed');
  }

  private requireRoom(roomId: string): RemoteRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw new RemoteAccessError('ROOM_NOT_FOUND', 'Room not found');
    return room;
  }

  private recordAudit(
    organizationId: string,
    roomId: string | null,
    actorUserId: string | null,
    action: string,
    targetType: string,
    targetId: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.audit.push({
      id: randomUUID(),
      organizationId,
      roomId,
      actorUserId,
      action,
      targetType,
      targetId,
      ...(metadata ? { metadata } : {}),
      createdAt: this.now().toISOString(),
    });
  }
}

/** Serializes writes for a shared host workspace; viewers remain concurrent. */
export class WorkspaceWriteCoordinator {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(workspaceId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.tails.set(workspaceId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(workspaceId) === queued) this.tails.delete(workspaceId);
    }
  }
}
