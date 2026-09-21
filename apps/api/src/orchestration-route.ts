import type { AuthService } from '@astra/auth';
import {
  type PlatformOrchestrationService,
  type Spec,
  type SpecDesign,
  type SpecRequirements,
  SpecDesignSchema,
  SpecRequirementsSchema,
  SpecTaskSchema,
} from '@astra/orchestration';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

function tokenFrom(request: FastifyRequest): string | null {
  const value = request.headers.authorization;
  return value?.startsWith('Bearer ') ? value.slice(7).trim() || null : null;
}

async function requireUser(
  auth: AuthService | undefined,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const token = tokenFrom(request);
  if (!token || !auth) {
    await reply.code(401).send({ error: 'SESSION_INVALID' });
    return null;
  }
  try {
    return await auth.authenticate(token);
  } catch {
    await reply.code(401).send({ error: 'SESSION_INVALID' });
    return null;
  }
}

const CreateSpecSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/),
  repositoryId: z.string().min(1).nullable().optional(),
  objective: z.string().min(1).max(20_000),
  requirements: SpecRequirementsSchema.partial().optional(),
  design: SpecDesignSchema.partial().optional(),
});

const TaskInputSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,80}$/),
  title: z.string().min(1).max(200),
  description: z.string().max(20_000),
  ownerAgentRole: z.enum([
    'LEAD',
    'BACKEND',
    'FRONTEND',
    'TEST',
    'RESEARCH',
    'REVIEWER',
    'SECURITY',
    'INTEGRATION',
    'DOCUMENTATION',
  ]),
  dependencies: z.array(z.string()),
  affectedAreas: z.array(z.string()),
  complexity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  budget: z.object({
    maxCredits: z.string().regex(/^\d+(?:\.\d+)?$/),
    maxModelCalls: z.number().int().positive(),
    maxParallelAgents: z.number().int().positive(),
    maxWallTimeMs: z.number().int().positive(),
  }),
});

function errorStatus(error: unknown): number {
  if (error instanceof Error && /version|already exists|cycle|claimable|lease/i.test(error.message))
    return 409;
  if (error instanceof Error && /authorization|owner/i.test(error.message)) return 403;
  return 400;
}

function definedObject<T extends Record<string, unknown>>(value: T | undefined): T | undefined {
  if (!value) return undefined;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

async function requireOwnedSpec(
  orchestration: PlatformOrchestrationService,
  specId: string,
  ownerId: string,
  reply: FastifyReply,
): Promise<Spec | null> {
  try {
    const spec = await orchestration.getSpec(specId);
    if (spec.ownerId !== ownerId) {
      await reply.code(404).send({ error: 'SPEC_NOT_FOUND' });
      return null;
    }
    return spec;
  } catch {
    await reply.code(404).send({ error: 'SPEC_NOT_FOUND' });
    return null;
  }
}

async function requireTaskForSpec(
  orchestration: PlatformOrchestrationService,
  specId: string,
  taskId: string,
  reply: FastifyReply,
): Promise<boolean> {
  const record = await orchestration.get('TASK', taskId);
  if (!record) {
    await reply.code(404).send({ error: 'TASK_NOT_FOUND' });
    return false;
  }
  const task = SpecTaskSchema.parse(record.payload);
  if (task.specId !== specId) {
    await reply.code(404).send({ error: 'TASK_NOT_FOUND' });
    return false;
  }
  return true;
}

export async function registerOrchestrationRoutes(
  app: FastifyInstance,
  dependencies: { auth?: AuthService; orchestration: PlatformOrchestrationService },
): Promise<void> {
  app.post('/v1/specs', async (request, reply) => {
    const identity = await requireUser(dependencies.auth, request, reply);
    if (!identity) return;
    const parsed = CreateSpecSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      return reply.code(201).send({
        spec: await dependencies.orchestration.createSpec({
          ownerId: identity.user.id,
          title: parsed.data.title,
          slug: parsed.data.slug,
          objective: parsed.data.objective,
          correlationId: request.id,
          ...(parsed.data.repositoryId === undefined
            ? {}
            : { repositoryId: parsed.data.repositoryId }),
          ...(definedObject(parsed.data.requirements)
            ? { requirements: definedObject(parsed.data.requirements) as Partial<SpecRequirements> }
            : {}),
          ...(definedObject(parsed.data.design)
            ? { design: definedObject(parsed.data.design) as Partial<SpecDesign> }
            : {}),
        }),
      });
    } catch (error) {
      return reply.code(errorStatus(error)).send({ error: 'SPEC_CREATE_FAILED' });
    }
  });

  app.get<{ Params: { specId: string } }>('/v1/specs/:specId', async (request, reply) => {
    const identity = await requireUser(dependencies.auth, request, reply);
    if (!identity) return;
    try {
      const spec = await dependencies.orchestration.getSpec(request.params.specId);
      if (spec.ownerId !== identity.user.id)
        return reply.code(404).send({ error: 'SPEC_NOT_FOUND' });
      const [tasks, events, verified] = await Promise.all([
        dependencies.orchestration.listTasks(spec.id),
        dependencies.orchestration.listEvents(spec.id),
        dependencies.orchestration.isVerified(spec.id),
      ]);
      return reply.send({ spec, tasks, events, verified });
    } catch (error) {
      return reply.code(errorStatus(error)).send({ error: 'SPEC_READ_FAILED' });
    }
  });

  app.post<{ Params: { specId: string } }>('/v1/specs/:specId/tasks', async (request, reply) => {
    const identity = await requireUser(dependencies.auth, request, reply);
    if (!identity) return;
    const parsed = z
      .object({ tasks: z.array(TaskInputSchema).min(1).max(100) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    if (
      !(await requireOwnedSpec(
        dependencies.orchestration,
        request.params.specId,
        identity.user.id,
        reply,
      ))
    )
      return;
    try {
      return reply.code(201).send({
        tasks: await dependencies.orchestration.addTasks({
          specId: request.params.specId,
          actorId: identity.user.id,
          tasks: parsed.data.tasks,
          correlationId: request.id,
        }),
      });
    } catch (error) {
      return reply.code(errorStatus(error)).send({ error: 'TASK_GRAPH_UPDATE_FAILED' });
    }
  });

  app.get<{ Params: { specId: string } }>('/v1/specs/:specId/ready', async (request, reply) => {
    const identity = await requireUser(dependencies.auth, request, reply);
    if (!identity) return;
    try {
      const spec = await dependencies.orchestration.getSpec(request.params.specId);
      if (spec.ownerId !== identity.user.id)
        return reply.code(404).send({ error: 'SPEC_NOT_FOUND' });
      return reply.send({ tasks: await dependencies.orchestration.readyTasks(spec.id) });
    } catch (error) {
      return reply.code(errorStatus(error)).send({ error: 'TASK_GRAPH_READ_FAILED' });
    }
  });

  app.post<{ Params: { specId: string; taskId: string } }>(
    '/v1/specs/:specId/tasks/:taskId/claim',
    async (request, reply) => {
      const identity = await requireUser(dependencies.auth, request, reply);
      if (!identity) return;
      const parsed = z
        .object({
          agentId: z.string().min(1).max(200),
          leaseMs: z.number().int().min(1_000).max(86_400_000),
        })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      if (
        !(await requireOwnedSpec(
          dependencies.orchestration,
          request.params.specId,
          identity.user.id,
          reply,
        ))
      )
        return;
      if (
        !(await requireTaskForSpec(
          dependencies.orchestration,
          request.params.specId,
          request.params.taskId,
          reply,
        ))
      )
        return;
      try {
        return reply.send({
          task: await dependencies.orchestration.claimTask({
            taskId: request.params.taskId,
            ...parsed.data,
            correlationId: request.id,
          }),
        });
      } catch (error) {
        return reply.code(errorStatus(error)).send({ error: 'TASK_CLAIM_FAILED' });
      }
    },
  );

  app.post<{ Params: { specId: string; taskId: string } }>(
    '/v1/specs/:specId/tasks/:taskId/complete',
    async (request, reply) => {
      const identity = await requireUser(dependencies.auth, request, reply);
      if (!identity) return;
      const parsed = z
        .object({
          agentId: z.string().min(1).max(200),
          status: z.enum(['SUCCEEDED', 'FAILED', 'BLOCKED', 'CANCELLED']),
          error: z.string().max(20_000).nullable().optional(),
        })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      if (
        !(await requireOwnedSpec(
          dependencies.orchestration,
          request.params.specId,
          identity.user.id,
          reply,
        ))
      )
        return;
      if (
        !(await requireTaskForSpec(
          dependencies.orchestration,
          request.params.specId,
          request.params.taskId,
          reply,
        ))
      )
        return;
      try {
        return reply.send({
          task: await dependencies.orchestration.completeTask({
            taskId: request.params.taskId,
            agentId: parsed.data.agentId,
            status: parsed.data.status,
            ...(parsed.data.error === undefined ? {} : { error: parsed.data.error }),
            correlationId: request.id,
          }),
        });
      } catch (error) {
        return reply.code(errorStatus(error)).send({ error: 'TASK_COMPLETE_FAILED' });
      }
    },
  );

  app.post<{ Params: { specId: string } }>(
    '/v1/specs/:specId/checkpoints',
    async (request, reply) => {
      const identity = await requireUser(dependencies.auth, request, reply);
      if (!identity) return;
      const parsed = z
        .object({
          taskId: z.string().nullable(),
          reason: z.string().min(1),
          revision: z.string().nullable(),
          worktreeId: z.string().nullable(),
          state: z.record(z.unknown()),
        })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      if (
        !(await requireOwnedSpec(
          dependencies.orchestration,
          request.params.specId,
          identity.user.id,
          reply,
        ))
      )
        return;
      try {
        return reply.code(201).send({
          checkpoint: await dependencies.orchestration.createCheckpoint({
            specId: request.params.specId,
            actorId: identity.user.id,
            correlationId: request.id,
            ...parsed.data,
          }),
        });
      } catch (error) {
        return reply.code(errorStatus(error)).send({ error: 'CHECKPOINT_CREATE_FAILED' });
      }
    },
  );

  app.post<{ Params: { specId: string } }>('/v1/specs/:specId/reviews', async (request, reply) => {
    const identity = await requireUser(dependencies.auth, request, reply);
    if (!identity) return;
    const parsed = z
      .object({
        taskId: z.string().nullable(),
        reviewerRole: z.enum(['REVIEWER', 'SECURITY']),
        severity: z.enum(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'INFO']),
        title: z.string().min(1),
        evidence: z.string().min(1),
        affectedCode: z.array(z.string()),
        remediation: z.string(),
        status: z.enum(['OPEN', 'RESOLVED', 'WAIVED']),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    if (
      !(await requireOwnedSpec(
        dependencies.orchestration,
        request.params.specId,
        identity.user.id,
        reply,
      ))
    )
      return;
    try {
      return reply.code(201).send({
        finding: await dependencies.orchestration.recordReview({
          specId: request.params.specId,
          actorId: identity.user.id,
          correlationId: request.id,
          ...parsed.data,
        }),
      });
    } catch (error) {
      return reply.code(errorStatus(error)).send({ error: 'REVIEW_CREATE_FAILED' });
    }
  });

  app.post<{ Params: { specId: string } }>(
    '/v1/specs/:specId/verification',
    async (request, reply) => {
      const identity = await requireUser(dependencies.auth, request, reply);
      if (!identity) return;
      const parsed = z
        .object({
          taskId: z.string().nullable(),
          category: z.enum([
            'COMPILE',
            'TYPECHECK',
            'LINT',
            'FORMAT',
            'UNIT',
            'INTEGRATION',
            'DATABASE',
            'BROWSER',
            'ELECTRON',
            'SECURITY',
            'BUILD',
            'DEPLOYMENT',
            'LIVE_SMOKE',
          ]),
          command: z.string(),
          status: z.enum(['PASS', 'FAIL', 'BLOCKED', 'SKIPPED']),
          summary: z.string(),
          output: z.string().max(100_000),
          correlationId: z.string().min(1),
        })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      if (
        !(await requireOwnedSpec(
          dependencies.orchestration,
          request.params.specId,
          identity.user.id,
          reply,
        ))
      )
        return;
      try {
        return reply.code(201).send({
          evidence: await dependencies.orchestration.recordVerification({
            specId: request.params.specId,
            actorId: identity.user.id,
            ...parsed.data,
          }),
        });
      } catch (error) {
        return reply.code(errorStatus(error)).send({ error: 'VERIFICATION_RECORD_FAILED' });
      }
    },
  );

  app.get('/v1/orchestration/health', async (_request, reply) =>
    reply.send({
      status: 'ok',
      persistentStore: true,
      serverAuthoritative: true,
      capabilities: [
        'specs',
        'task_dag',
        'parallel_agents',
        'review',
        'security',
        'verification',
        'steering',
        'memory',
        'hooks',
        'automations',
        'worktrees',
        'model_routing',
      ],
    }),
  );
}
