import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Admin endpoints for system management.
 * Source: API Specification V1 Section 21.
 */
export class AdminController {
  async getSystemStatus(
    _request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    await reply.status(200).send({
      status:    'operational',
      timestamp: new Date().toISOString(),
    });
  }
}
