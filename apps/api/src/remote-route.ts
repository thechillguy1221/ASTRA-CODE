import type { AuthService } from '@lyntar/auth';
import type { PlanCatalog } from '@lyntar/plans';
import type { EmailService } from '@lyntar/email';
import { randomUUID } from 'node:crypto';
import {
  createRelayGrant,
  RemoteAccessError,
  roomRolePermissions,
  type RemoteAccessPort,
  type RemoteRelayBroker,
  type RoomPermission,
  type RoomRole,
  RoomFileError,
} from '@lyntar/remote-protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const DeviceSchema = z.object({
  label: z.string().min(1).max(120),
  platform: z.string().min(1).max(40),
  architecture: z.string().min(1).max(40),
  publicKeyPem: z.string().min(1).max(20_000),
});
const OrganizationSchema = z.object({
  displayName: z.string().min(1).max(120),
  planId: z.string().min(1).optional(),
});
const RoomSchema = z.object({
  name: z.string().min(1).max(120),
  hostDeviceId: z.string().uuid(),
  workspaceRootRelative: z.string().min(1).max(500),
});
const RoomHandoffSchema = z.object({
  hostDeviceId: z.string().uuid(),
  workspaceRootRelative: z.string().min(1).max(500),
  workspaceFingerprint: z.string().trim().min(1).max(512),
});
const RoomFileUploadSchema = z.object({
  originalName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(120),
  contentBase64: z.string().min(1).max(35_000_000),
  intent: z.enum(['REFERENCE', 'ADD_TO_PROJECT']),
});
const RoomFilePreviewSchema = z.object({
  destinationRelative: z.string().max(500).default(''),
  existingPaths: z.array(z.string().min(1).max(500)).max(10_000).optional(),
});
const RoomFileCompleteSchema = z.object({
  hostDeviceId: z.string().uuid(),
  writtenPaths: z.array(z.string().min(1).max(500)).max(10_000),
});
const InvitationSchema = z.object({
  email: z.string().email(),
  idempotencyKey: z.string().min(1).max(200),
});
const RedeemSchema = z.object({ token: z.string().min(20).max(500) });
const RoleSchema = z.object({ role: z.enum(['VIEWER', 'AGENT_USER', 'EDITOR', 'ADMIN']) });
const RelayGrantSchema = z.object({
  deviceId: z.string().uuid(),
  roomId: z.string().uuid().nullable().optional(),
  role: z.enum(['HOST', 'CLIENT']),
  permissions: z.array(z.string().min(1)).max(32).optional(),
});

function tokenFrom(request: FastifyRequest): string | null {
  const value = request.headers.authorization;
  if (value?.startsWith('Bearer ')) return value.slice(7).trim() || null;
  const cookie = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('astra_access='));
  return cookie ? decodeURIComponent(cookie.slice('astra_access='.length)) : null;
}

function sendRemoteError(reply: FastifyReply, error: unknown) {
  if (error instanceof RoomFileError) {
    const status =
      error.code === 'ROOM_FILE_TOO_LARGE' || error.code === 'ARCHIVE_LIMIT_EXCEEDED'
        ? 413
        : error.code === 'ROOM_FILE_NOT_FOUND'
          ? 404
          : error.code === 'IMPORT_CONFLICT'
            ? 409
            : 400;
    return reply.code(status).send({ error: error.code });
  }
  if (error instanceof RemoteAccessError) {
    const status =
      error.code === 'PERMISSION_DENIED' ||
      error.code === 'PLAN_NOT_ELIGIBLE' ||
      error.code === 'MEMBER_SUSPENDED' ||
      error.code === 'MEMBER_REMOVED' ||
      error.code === 'ORGANIZATION_SUSPENDED' ||
      error.code === 'ORGANIZATION_CLOSED' ||
      error.code === 'ROOM_HOST_INVALID' ||
      error.code === 'ROOM_HOST_OFFLINE' ||
      error.code === 'ROOM_FILE_FORBIDDEN'
        ? 403
        : error.code === 'INVITATION_INVALID' ||
            error.code === 'INVITATION_EXPIRED' ||
            error.code === 'INVITATION_REVOKED'
          ? 400
          : error.code === 'IDEMPOTENCY_CONFLICT' ||
              error.code === 'SEAT_LIMIT' ||
              error.code === 'LAST_ADMIN' ||
              error.code === 'ROOM_IMPORT_CONFLICT'
            ? 409
            : 404;
    return reply.code(status).send({ error: error.code });
  }
  return reply.code(500).send({ error: 'remote_access_failed' });
}

export interface RemoteRouteDependencies {
  auth: AuthService;
  plans: PlanCatalog;
  remote: RemoteAccessPort;
  email?: EmailService;
  publicSiteUrl?: string;
  exposeDevelopmentTokens?: boolean;
  relaySecret?: string;
  relayGrantTtlMs?: number;
  relayBroker?: RemoteRelayBroker;
}

async function requireUser(
  dependencies: RemoteRouteDependencies,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const token = tokenFrom(request);
  if (!token) {
    await reply.code(401).send({ error: 'SESSION_INVALID' });
    return null;
  }
  try {
    return await dependencies.auth.authenticate(token);
  } catch {
    await reply.code(401).send({ error: 'SESSION_INVALID' });
    return null;
  }
}

export async function registerRemoteRoutes(
  app: FastifyInstance,
  dependencies: RemoteRouteDependencies,
): Promise<void> {
  app.get('/v1/devices', async (request, reply) => {
    const identity = await requireUser(dependencies, request, reply);
    if (!identity) return;
    return reply.send({ devices: await dependencies.remote.listDevices(identity.user.id) });
  });

  app.post('/v1/devices/register', async (request, reply) => {
    const identity = await requireUser(dependencies, request, reply);
    if (!identity) return;
    const parsed = DeviceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const device = await dependencies.remote.registerDevice({
        userId: identity.user.id,
        ...parsed.data,
      });
      return reply.code(201).send({ device });
    } catch (error) {
      return sendRemoteError(reply, error);
    }
  });

  app.post<{ Params: { deviceId: string } }>(
    '/v1/devices/:deviceId/heartbeat',
    async (request, reply) => {
      const identity = await requireUser(dependencies, request, reply);
      if (!identity) return;
      try {
        return reply.send({
          device: await dependencies.remote.heartbeat(identity.user.id, request.params.deviceId),
        });
      } catch (error) {
        return sendRemoteError(reply, error);
      }
    },
  );

  app.post('/v1/relay/grants', async (request, reply) => {
    const identity = await requireUser(dependencies, request, reply);
    if (!identity) return;
    if (!dependencies.relaySecret) return reply.code(503).send({ error: 'RELAY_UNAVAILABLE' });
    const parsed = RelayGrantSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const roomId = parsed.data.roomId ?? null;
    try {
      let targetDeviceId = parsed.data.deviceId;
      let permissions: string[];
      if (roomId) {
        const room = await dependencies.remote.getRoom(roomId);
        if (room.hostDeviceId !== targetDeviceId)
          throw new RemoteAccessError(
            'PERMISSION_DENIED',
            'Relay grant target is not the Room host device',
          );
        if (parsed.data.role === 'HOST') {
          const targetDevice = await dependencies.remote.authorizeOwnDevice(
            identity.user.id,
            targetDeviceId,
          );
          targetDeviceId = targetDevice.id;
          if (room.hostUserId !== identity.user.id)
            throw new RemoteAccessError('PERMISSION_DENIED', 'Only the host can open a host grant');
          await dependencies.remote.authorizeRoomAction({
            actorUserId: identity.user.id,
            roomId,
            permission: 'room.view',
          });
          permissions = [];
        } else {
          await dependencies.remote.getDevice(targetDeviceId);
          const member = await dependencies.remote.authorizeRoomAction({
            actorUserId: identity.user.id,
            roomId,
            permission: 'room.view',
          });
          const allowed = new Set(member.permissions);
          const requested = parsed.data.permissions ?? member.permissions;
          for (const permission of requested) {
            if (!ROOM_PERMISSION_SET.has(permission) || !allowed.has(permission as RoomPermission))
              throw new RemoteAccessError(
                'PERMISSION_DENIED',
                `Room grant lacks ${permission} permission`,
              );
          }
          permissions = [...requested];
        }
      } else {
        const targetDevice = await dependencies.remote.authorizeOwnDevice(
          identity.user.id,
          targetDeviceId,
        );
        targetDeviceId = targetDevice.id;
        if (parsed.data.role === 'HOST') permissions = [];
        else {
          const requested = parsed.data.permissions ?? roomRolePermissions('ADMIN');
          if (requested.some((permission) => !ROOM_PERMISSION_SET.has(permission)))
            throw new RemoteAccessError('PERMISSION_DENIED', 'Unknown relay permission');
          permissions = [...requested];
        }
      }
      const grant = createRelayGrant(
        {
          sessionId: randomUUID(),
          userId: identity.user.id,
          deviceId: targetDeviceId,
          roomId,
          role: parsed.data.role,
          permissions,
          ttlMs: dependencies.relayGrantTtlMs ?? 5 * 60 * 1000,
        },
        dependencies.relaySecret,
      );
      return reply.send({
        token: grant.token,
        sessionId: grant.payload.sessionId,
        expiresAt: grant.payload.expiresAt,
        permissions,
      });
    } catch (error) {
      return sendRemoteError(reply, error);
    }
  });

  app.post<{ Params: { deviceId: string } }>(
    '/v1/devices/:deviceId/authorize',
    async (request, reply) => {
      const identity = await requireUser(dependencies, request, reply);
      if (!identity) return;
      try {
        const device = await dependencies.remote.authorizeOwnDevice(
          identity.user.id,
          request.params.deviceId,
        );
        return reply.send({ device, online: device.lastSeenAt !== null });
      } catch (error) {
        return sendRemoteError(reply, error);
      }
    },
  );

  app.post<{ Params: { deviceId: string } }>(
    '/v1/devices/:deviceId/revoke',
    async (request, reply) => {
      const identity = await requireUser(dependencies, request, reply);
      if (!identity) return;
      try {
        await dependencies.remote.revokeDevice(identity.user.id, request.params.deviceId);
        dependencies.relayBroker?.revokeDevice(request.params.deviceId);
        return reply.code(204).send();
      } catch (error) {
        return sendRemoteError(reply, error);
      }
    },
  );

  app.post('/v1/organizations', async (request, reply) => {
    const identity = await requireUser(dependencies, request, reply);
    if (!identity) return;
    const parsed = OrganizationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      // The authenticated account is authoritative. A client-supplied plan ID
      // is accepted only for backwards-compatible request parsing and is never
      // used to elevate Room eligibility.
      const plan = dependencies.plans.get(identity.user.planId);
      const organization = await dependencies.remote.createOrganization({
        ownerUserId: identity.user.id,
        displayName: parsed.data.displayName,
        plan: {
          id: plan.id,
          seats: plan.seats,
          monthlyCredits: plan.monthlyCredits,
          pooledCredits: plan.pooledCredits,
          crossPersonRooms: plan.crossPersonRooms,
        },
      });
      return reply.code(201).send({ organization });
    } catch (error) {
      return sendRemoteError(reply, error);
    }
  });

  app.post<{ Params: { organizationId: string } }>(
    '/v1/organizations/:organizationId/rooms',
    async (request, reply) => {
      const identity = await requireUser(dependencies, request, reply);
      if (!identity) return;
      const parsed = RoomSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const room = await dependencies.remote.createRoom({
          actorUserId: identity.user.id,
          organizationId: request.params.organizationId,
          ...parsed.data,
        });
        return reply.code(201).send({ room });
      } catch (error) {
        return sendRemoteError(reply, error);
      }
    },
  );

  app.get('/v1/rooms', async (request, reply) => {
    const identity = await requireUser(dependencies, request, reply);
    if (!identity) return;
    try {
      return reply.send({ rooms: await dependencies.remote.listRooms(identity.user.id) });
    } catch (error) {
      return sendRemoteError(reply, error);
    }
  });

  app.post<{ Params: { roomId: string } }>(
    '/v1/rooms/:roomId/project/handoff',
    async (request, reply) => {
      const identity = await requireUser(dependencies, request, reply);
      if (!identity) return;
      const parsed = RoomHandoffSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const room = await dependencies.remote.handoffRoom({
          actorUserId: identity.user.id,
          roomId: request.params.roomId,
          ...parsed.data,
        });
        return reply.send({ room });
      } catch (error) {
        return sendRemoteError(reply, error);
      }
    },
  );

  app.get<{ Params: { roomId: string } }>('/v1/rooms/:roomId/files', async (request, reply) => {
    const identity = await requireUser(dependencies, request, reply);
    if (!identity) return;
    try {
      return reply.send({
        files: await dependencies.remote.listRoomFiles(identity.user.id, request.params.roomId),
      });
    } catch (error) {
      return sendRemoteError(reply, error);
    }
  });

  app.post<{ Params: { roomId: string } }>('/v1/rooms/:roomId/files', async (request, reply) => {
    const identity = await requireUser(dependencies, request, reply);
    if (!identity) return;
    const parsed = RoomFileUploadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const file = await dependencies.remote.uploadRoomFile({
        actorUserId: identity.user.id,
        roomId: request.params.roomId,
        originalName: parsed.data.originalName,
        contentType: parsed.data.contentType,
        content: Buffer.from(parsed.data.contentBase64, 'base64'),
        intent: parsed.data.intent,
      });
      return reply.code(201).send({ file });
    } catch (error) {
      return sendRemoteError(reply, error);
    }
  });

  app.get<{ Params: { roomId: string; fileId: string } }>(
    '/v1/rooms/:roomId/files/:fileId/content',
    async (request, reply) => {
      const identity = await requireUser(dependencies, request, reply);
      if (!identity) return;
      try {
        const file = await dependencies.remote.getRoomFile({
          actorUserId: identity.user.id,
          roomId: request.params.roomId,
          fileId: request.params.fileId,
        });
        return reply.send({
          file: file.record,
          contentBase64: file.content.toString('base64'),
        });
      } catch (error) {
        return sendRemoteError(reply, error);
      }
    },
  );

  app.delete<{ Params: { roomId: string; fileId: string } }>(
    '/v1/rooms/:roomId/files/:fileId',
    async (request, reply) => {
      const identity = await requireUser(dependencies, request, reply);
      if (!identity) return;
      try {
        await dependencies.remote.deleteRoomFile({
          actorUserId: identity.user.id,
          roomId: request.params.roomId,
          fileId: request.params.fileId,
        });
        return reply.code(204).send();
      } catch (error) {
        return sendRemoteError(reply, error);
      }
    },
  );

  app.post<{ Params: { roomId: string; fileId: string } }>(
    '/v1/rooms/:roomId/files/:fileId/import-preview',
    async (request, reply) => {
      const identity = await requireUser(dependencies, request, reply);
      if (!identity) return;
      const parsed = RoomFilePreviewSchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const proposal = await dependencies.remote.createRoomFileImport({
          actorUserId: identity.user.id,
          roomId: request.params.roomId,
          fileId: request.params.fileId,
          destinationRelative: parsed.data.destinationRelative,
          ...(parsed.data.existingPaths ? { existingPaths: parsed.data.existingPaths } : {}),
        });
        return reply.code(201).send({ proposal });
      } catch (error) {
        return sendRemoteError(reply, error);
      }
    },
  );

  for (const action of ['approve', 'reject'] as const) {
    app.post<{ Params: { roomId: string; importId: string } }>(
      `/v1/rooms/:roomId/file-imports/:importId/${action}`,
      async (request, reply) => {
        const identity = await requireUser(dependencies, request, reply);
        if (!identity) return;
        try {
          const proposal =
            action === 'approve'
              ? await dependencies.remote.approveRoomFileImport({
                  actorUserId: identity.user.id,
                  roomId: request.params.roomId,
                  importId: request.params.importId,
                })
              : await dependencies.remote.rejectRoomFileImport({
                  actorUserId: identity.user.id,
                  roomId: request.params.roomId,
                  importId: request.params.importId,
                });
          return reply.send({ proposal });
        } catch (error) {
          return sendRemoteError(reply, error);
        }
      },
    );
  }

  app.get<{ Params: { roomId: string } }>(
    '/v1/rooms/:roomId/file-imports',
    async (request, reply) => {
      const identity = await requireUser(dependencies, request, reply);
      if (!identity) return;
      try {
        return reply.send({
          proposals: await dependencies.remote.listRoomFileImports(
            identity.user.id,
            request.params.roomId,
          ),
        });
      } catch (error) {
        return sendRemoteError(reply, error);
      }
    },
  );

  app.post<{ Params: { roomId: string; importId: string } }>(
    '/v1/rooms/:roomId/file-imports/:importId/complete',
    async (request, reply) => {
      const identity = await requireUser(dependencies, request, reply);
      if (!identity) return;
      const parsed = RoomFileCompleteSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const proposal = await dependencies.remote.completeRoomFileImport({
          actorUserId: identity.user.id,
          roomId: request.params.roomId,
          importId: request.params.importId,
          ...parsed.data,
        });
        return reply.send({ proposal });
      } catch (error) {
        return sendRemoteError(reply, error);
      }
    },
  );

  app.get<{ Params: { roomId: string } }>(
    '/v1/rooms/:roomId/security-events',
    async (request, reply) => {
      const identity = await requireUser(dependencies, request, reply);
      if (!identity) return;
      try {
        return reply.send({
          events: await dependencies.remote.listSecurityEvents(
            identity.user.id,
            request.params.roomId,
          ),
        });
      } catch (error) {
        return sendRemoteError(reply, error);
      }
    },
  );

  app.get<{ Params: { roomId: string } }>('/v1/rooms/:roomId/members', async (request, reply) => {
    const identity = await requireUser(dependencies, request, reply);
    if (!identity) return;
    try {
      return reply.send({
        members: await dependencies.remote.listRoomMembers(identity.user.id, request.params.roomId),
      });
    } catch (error) {
      return sendRemoteError(reply, error);
    }
  });

  app.post<{ Params: { roomId: string } }>(
    '/v1/rooms/:roomId/invitations',
    async (request, reply) => {
      const identity = await requireUser(dependencies, request, reply);
      if (!identity) return;
      const parsed = InvitationSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const result = await dependencies.remote.inviteMember({
          actorUserId: identity.user.id,
          roomId: request.params.roomId,
          ...parsed.data,
        });
        if (dependencies.email && dependencies.publicSiteUrl && result.token) {
          await dependencies.email.sendRoomInvitation({
            email: result.invitation.invitedEmail,
            roomName: 'shared Astra Code Room',
            inviteUrl: `${dependencies.publicSiteUrl}/room-invite?token=${encodeURIComponent(result.token)}`,
            eventKey: result.invitation.id,
          });
        }
        return reply.code(201).send({
          invitation: result.invitation,
          ...(dependencies.exposeDevelopmentTokens && result.token ? { token: result.token } : {}),
        });
      } catch (error) {
        return sendRemoteError(reply, error);
      }
    },
  );

  app.post('/v1/rooms/invitations/redeem', async (request, reply) => {
    const identity = await requireUser(dependencies, request, reply);
    if (!identity) return;
    const parsed = RedeemSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const user = await dependencies.auth.getUserById(identity.user.id);
      if (!user) return reply.code(401).send({ error: 'SESSION_INVALID' });
      const member = await dependencies.remote.redeemInvitation({
        userId: user.id,
        email: user.email,
        token: parsed.data.token,
      });
      return reply.send({ member });
    } catch (error) {
      return sendRemoteError(reply, error);
    }
  });

  app.post<{ Params: { roomId: string; userId: string } }>(
    '/v1/rooms/:roomId/members/:userId/role',
    async (request, reply) => {
      const identity = await requireUser(dependencies, request, reply);
      if (!identity) return;
      const parsed = RoleSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const member = await dependencies.remote.setMemberRole({
          actorUserId: identity.user.id,
          roomId: request.params.roomId,
          userId: request.params.userId,
          role: parsed.data.role as RoomRole,
        });
        return reply.send({ member });
      } catch (error) {
        return sendRemoteError(reply, error);
      }
    },
  );

  for (const action of ['suspend', 'restore', 'remove'] as const) {
    app.post<{ Params: { roomId: string; userId: string } }>(
      `/v1/rooms/:roomId/members/:userId/${action}`,
      async (request, reply) => {
        const identity = await requireUser(dependencies, request, reply);
        if (!identity) return;
        try {
          const input = {
            actorUserId: identity.user.id,
            roomId: request.params.roomId,
            userId: request.params.userId,
          };
          if (action === 'suspend') await dependencies.remote.suspendMember(input);
          else if (action === 'restore') await dependencies.remote.restoreMember(input);
          else await dependencies.remote.removeMember(input);
          if (action !== 'restore')
            dependencies.relayBroker?.revokeRoomMember(
              request.params.roomId,
              request.params.userId,
            );
          return reply.code(204).send();
        } catch (error) {
          return sendRemoteError(reply, error);
        }
      },
    );
  }

  app.post<{ Params: { roomId: string } }>('/v1/rooms/:roomId/leave', async (request, reply) => {
    const identity = await requireUser(dependencies, request, reply);
    if (!identity) return;
    try {
      await dependencies.remote.leaveRoom({
        userId: identity.user.id,
        roomId: request.params.roomId,
      });
      dependencies.relayBroker?.revokeRoomMember(request.params.roomId, identity.user.id);
      return reply.code(204).send();
    } catch (error) {
      return sendRemoteError(reply, error);
    }
  });

  app.post<{ Params: { roomId: string; permission: string } }>(
    '/v1/rooms/:roomId/authorize/:permission',
    async (request, reply) => {
      const identity = await requireUser(dependencies, request, reply);
      if (!identity) return;
      if (!ROOM_PERMISSION_SET.has(request.params.permission as RoomPermission))
        return reply.code(400).send({ error: 'invalid_permission' });
      try {
        const member = await dependencies.remote.authorizeRoomAction({
          actorUserId: identity.user.id,
          roomId: request.params.roomId,
          permission: request.params.permission as RoomPermission,
        });
        return reply.send({ allowed: true, member });
      } catch (error) {
        return sendRemoteError(reply, error);
      }
    },
  );
}

const ROOM_PERMISSION_SET = new Set<string>([
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
]);
