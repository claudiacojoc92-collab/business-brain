import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerHealthRoutes } from '../../routes/health.routes';

describe('health routes', () => {
  it('GET /health returns 200 ok', async () => {
    const server = Fastify();
    registerHealthRoutes(server);
    const response = await server.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string }>();
    expect(body.status).toBe('ok');
  });

  it('GET /health/ready returns 200 ready', async () => {
    const server = Fastify();
    registerHealthRoutes(server);
    const response = await server.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string }>();
    expect(body.status).toBe('ready');
  });

  it('GET /health/metrics returns 200 with text/plain', async () => {
    const server = Fastify();
    registerHealthRoutes(server);
    const response = await server.inject({ method: 'GET', url: '/health/metrics' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
  });
});
