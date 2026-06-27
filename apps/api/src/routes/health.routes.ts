import type { FastifyInstance } from 'fastify';
import { HealthController } from '../controllers/health.controller';

/**
 * Health and metrics routes — no authentication required.
 * Source: API Specification V1 Section 15.
 */
export function registerHealthRoutes(server: FastifyInstance): void {
  const controller = new HealthController();

  server.get('/health',        controller.liveness.bind(controller));
  server.get('/health/ready',  controller.readiness.bind(controller));
  server.get('/health/metrics',controller.metrics.bind(controller));
}
