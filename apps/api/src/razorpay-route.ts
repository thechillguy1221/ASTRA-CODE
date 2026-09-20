import { RazorpayWebhookService } from '@lyntar/billing';
import type { FastifyInstance, FastifyRequest } from 'fastify';

type RawBodyRequest = FastifyRequest & { rawBody?: string };

export interface RazorpayRouteDependencies {
  webhook?: RazorpayWebhookService;
}

export async function registerRazorpayRoutes(
  app: FastifyInstance,
  dependencies: RazorpayRouteDependencies,
): Promise<void> {
  app.post('/v1/payments/razorpay/webhook', async (request, reply) => {
    if (!dependencies.webhook) return reply.code(503).send({ error: 'razorpay_not_configured' });
    const signature = request.headers['x-razorpay-signature'];
    if (typeof signature !== 'string' || !signature)
      return reply.code(400).send({ error: 'missing_signature' });
    const rawBody =
      (request as RawBodyRequest).rawBody ??
      (typeof request.body === 'string' ? request.body : JSON.stringify(request.body));
    try {
      const result = await dependencies.webhook.handle(rawBody, signature);
      return reply.send(result);
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : 'webhook_rejected' });
    }
  });
}
