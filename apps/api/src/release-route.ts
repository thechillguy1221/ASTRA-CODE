import type { ReleaseManifest } from '@astra/releases';
import type { FastifyInstance } from 'fastify';

export async function registerReleaseRoutes(
  app: FastifyInstance,
  manifest?: ReleaseManifest,
): Promise<void> {
  app.get<{ Params: { channel: string } }>(
    '/v1/releases/windows/:channel',
    async (request, reply) => {
      if (!manifest || manifest.channel !== request.params.channel)
        return reply.code(404).send({ error: 'release_not_found' });
      return reply.send({ release: manifest });
    },
  );
}
