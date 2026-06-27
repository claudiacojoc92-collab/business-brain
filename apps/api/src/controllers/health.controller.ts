import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Health controller for liveness and readiness probes.
 * Source: Repository Structure V1 Section 07.
 */
export class HealthController {
  async liveness(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await reply.status(200).send({ status: 'ok' });
  }

  async readiness(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await reply.status(200).send({ status: 'ready' });
  }

  async metrics(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // Prometheus metrics endpoint — content served by OTel collector in production
    await reply.status(200)
      .header('content-type', 'text/plain; version=0.0.4')
      .send('# Business Brain metrics\n');
  }
}
