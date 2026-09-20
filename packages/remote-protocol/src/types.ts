import { z } from 'zod';

// ─── Device Identity ───────────────────────────────────────────────────────

export const RemoteDeviceSchema = z.object({
  deviceId: z.string().uuid(),
  userId: z.string().min(1),
  label: z.string().min(1),
  platform: z.string().min(1),
  publicKeyPem: z.string().min(1),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
});
export type RemoteDevice = z.infer<typeof RemoteDeviceSchema>;

// ─── Pairing ───────────────────────────────────────────────────────────────

export const PairingTokenPayloadSchema = z.object({
  pairingId: z.string().uuid(),
  userId: z.string().min(1),
  relayUrl: z.string().url(),
  expiresAt: z.string().datetime(),
});
export type PairingTokenPayload = z.infer<typeof PairingTokenPayloadSchema>;

export const PairingRequestSchema = z.object({
  pairingToken: z.string().min(1),
  deviceLabel: z.string().min(1),
  platform: z.string().min(1),
  publicKeyPem: z.string().min(1),
});
export type PairingRequest = z.infer<typeof PairingRequestSchema>;

export const PairingResponseSchema = z.object({
  approved: z.boolean(),
  deviceId: z.string().uuid().optional(),
  accessToken: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
});
export type PairingResponse = z.infer<typeof PairingResponseSchema>;

// ─── Remote Messages (Desktop → Mobile) ───────────────────────────────────

const MsgBase = z.object({
  messageId: z.string().uuid(),
  sessionId: z.string().min(1).optional(),
  timestamp: z.string().datetime(),
});

export const SessionListMessageSchema = MsgBase.extend({
  type: z.literal('session.list'),
  payload: z.object({
    sessions: z.array(
      z.object({
        sessionId: z.string().min(1),
        objective: z.string().min(1),
        status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'CRASHED', 'CANCELLED']),
        currentModelId: z.string().min(1),
        workspaceId: z.string().min(1),
        updatedAt: z.string().datetime(),
      }),
    ),
  }),
});

export const SessionStateMessageSchema = MsgBase.extend({
  type: z.literal('session.state'),
  payload: z.object({
    sessionId: z.string().min(1),
    status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'CRASHED', 'CANCELLED']),
    currentModelId: z.string().min(1),
    objective: z.string().min(1),
    structuredState: z.unknown().nullable(),
    creditsUsed: z.string(),
    currentBalance: z.string(),
  }),
});

export const AgentEventMessageSchema = MsgBase.extend({
  type: z.literal('agent.event'),
  payload: z.object({
    eventType: z.string().min(1),
    eventPayload: z.unknown(),
  }),
});

export const TerminalOutputMessageSchema = MsgBase.extend({
  type: z.literal('terminal.output'),
  payload: z.object({
    command: z.string().min(1),
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number().int().nullable(),
    status: z.enum(['running', 'completed', 'error']),
  }),
});

export const ApprovalRequestMessageSchema = MsgBase.extend({
  type: z.literal('approval.request'),
  payload: z.object({
    requestId: z.string().uuid(),
    action: z.string().min(1),
    summary: z.string().min(1),
    risk: z.enum(['low', 'medium', 'high', 'destructive']),
    requiresReauth: z.boolean().optional(),
    details: z.unknown().optional(),
  }),
});

export const CreditStateMessageSchema = MsgBase.extend({
  type: z.literal('credit.state'),
  payload: z.object({
    availableCredits: z.string(),
    reservedCredits: z.string(),
    estimatedTaskCredits: z.string().nullable(),
  }),
});

export const DeviceStatusMessageSchema = MsgBase.extend({
  type: z.literal('device.status'),
  payload: z.object({
    online: z.boolean(),
    lastSeenAt: z.string().datetime().nullable(),
    computerId: z.string().min(1),
    computerLabel: z.string().min(1),
  }),
});

// ─── Remote Messages (Mobile → Desktop) ───────────────────────────────────

export const PromptSubmitMessageSchema = MsgBase.extend({
  type: z.literal('prompt.submit'),
  payload: z.object({
    sessionId: z.string().min(1),
    prompt: z.string().min(1),
    modelId: z.string().min(1),
    authorizedMaxCredits: z.string().optional(),
  }),
});

export const ModelChangeMessageSchema = MsgBase.extend({
  type: z.literal('model.change'),
  payload: z.object({
    sessionId: z.string().min(1),
    modelId: z.string().min(1),
  }),
});

export const SessionControlMessageSchema = MsgBase.extend({
  type: z.enum(['session.pause', 'session.resume', 'session.stop']),
  payload: z.object({
    sessionId: z.string().min(1),
  }),
});

export const ApprovalResponseMessageSchema = MsgBase.extend({
  type: z.literal('approval.response'),
  payload: z.object({
    requestId: z.string().uuid(),
    approved: z.boolean(),
    sessionId: z.string().min(1),
  }),
});

export const TerminalCommandMessageSchema = MsgBase.extend({
  type: z.literal('terminal.command'),
  payload: z.object({
    sessionId: z.string().min(1),
    command: z.string().min(1),
    requiresApproval: z.boolean(),
  }),
});

// ─── Union Types ───────────────────────────────────────────────────────────

export const RemoteMessageSchema = z.discriminatedUnion('type', [
  SessionListMessageSchema,
  SessionStateMessageSchema,
  AgentEventMessageSchema,
  TerminalOutputMessageSchema,
  ApprovalRequestMessageSchema,
  CreditStateMessageSchema,
  DeviceStatusMessageSchema,
  PromptSubmitMessageSchema,
  ModelChangeMessageSchema,
  SessionControlMessageSchema,
  ApprovalResponseMessageSchema,
  TerminalCommandMessageSchema,
]);
export type RemoteMessage = z.infer<typeof RemoteMessageSchema>;

// ─── Permission Tiers for Remote Terminal ─────────────────────────────────

export type RemoteTerminalPermission =
  | 'view-only' // Can only view output, not send commands
  | 'safe-commands' // Can run SAFE-classified commands
  | 'write-commands' // Can run WRITE-classified commands (requires session approval)
  | 'all-commands'; // Can run any approved command (requires re-auth + local confirm)
