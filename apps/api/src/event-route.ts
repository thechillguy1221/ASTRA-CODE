import { AgentEventSchema } from '@astra/contracts';
import type { AgentEventStore } from '@astra/db';
import type { FastifyInstance } from 'fastify';

export async function registerAgentEventRoutes(
  app: FastifyInstance,
  events: AgentEventStore,
): Promise<void> {
  app.post('/v1/agent-events', async (request, reply) => {
    const parsed = AgentEventSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_event', details: parsed.error.flatten() });
    await events.append(parsed.data);
    return reply.code(204).send();
  });
}
