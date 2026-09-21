import type { ReleaseManifest } from '@astra/releases';
import type { PlatformPolicyService } from '@astra/control-plane';
import type { FastifyInstance } from 'fastify';

export async function registerReleaseRoutes(
  app: FastifyInstance,
  manifest?: ReleaseManifest,
  policy?: PlatformPolicyService,
): Promise<void> {
  app.get<{ Params: { channel: string } }>(
    '/v1/releases/windows/:channel',
    async (request, reply) => {
      if (!manifest || manifest.channel !== request.params.channel)
        return reply.code(404).send({ error: 'release_not_found' });
      return reply.send({ release: manifest });
    },
  );
  app.get<{ Params: { channel: string }; Querystring: { currentVersion?: string } }>(
    '/v1/releases/windows/:channel/check',
    async (request, reply) => {
      if (!policy) return reply.code(503).send({ error: 'CONTROL_PLANE_UNAVAILABLE' });
      if (!['stable', 'beta', 'nightly'].includes(request.params.channel))
        return reply.code(400).send({ error: 'invalid_channel' });
      const currentVersion = request.query.currentVersion?.trim();
      if (!currentVersion) return reply.code(400).send({ error: 'current_version_required' });
      try {
        return reply.send({
          release: await policy.resolveRelease(
            request.params.channel as 'stable' | 'beta' | 'nightly',
            currentVersion,
          ),
        });
      } catch (error) {
        return reply
          .code(503)
          .send({ error: error instanceof Error ? error.message : 'release_policy_unavailable' });
      }
    },
  );
}
