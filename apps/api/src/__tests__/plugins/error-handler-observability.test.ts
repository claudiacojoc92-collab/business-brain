import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';
import { GenerationError } from '../../business-model/generation-errors';

/**
 * RJ-1 C1 — the diagnosis blind spot. Production logged `error={}` for every failure because pino's
 * std serializer only recognises the `err` key; `{ error }` dropped class/message/stack. That hid the
 * invalid-model-output P0 for a full cycle. This pins the fix and the redaction rules.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const capture = () => { const recs: any[] = []; return { recs, logger: { info: vi.fn(), warn: (o: any, m?: string) => recs.push({ ...o, msg: m }), error: vi.fn(), debug: vi.fn() } as any }; };

async function appThatThrows(err: Error, logger: unknown) {
  const app = Fastify();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerErrorHandler(app, logger as any);
  app.get('/boom', async () => { throw err; });
  await app.ready();
  return app;
}

describe('error handler — pino `err` serialization (RJ-1 C1)', () => {
  it('logs under `err` (class + message survive) — never the bare `error` key', async () => {
    const { recs, logger } = capture();
    const app = await appThatThrows(new Error('the real cause'), logger);
    await app.inject({ method: 'GET', url: '/boom' });
    await app.close();

    expect(recs).toHaveLength(1);
    expect(recs[0].err).toBeInstanceOf(Error);
    expect((recs[0].err as Error).message).toBe('the real cause'); // was invisible as error={}
    expect(recs[0].error).toBeUndefined();                          // the old, blind key is gone
    expect(recs[0].traceId).toBeDefined();
  });

  it('carries `stage` when the thrower knows it (GenerationError)', async () => {
    const { recs, logger } = capture();
    const app = await appThatThrows(new GenerationError('invalid_model_output', 'envelope_gate', 'gate reject'), logger);
    await app.inject({ method: 'GET', url: '/boom' });
    await app.close();
    expect(recs[0].stage).toBe('envelope_gate');
  });

  it('production still MASKS the message to the founder (response unchanged)', async () => {
    const prev = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    const { logger } = capture();
    const app = await appThatThrows(new Error('internal detail leak'), logger);
    const res = await app.inject({ method: 'GET', url: '/boom' });
    await app.close();
    if (prev === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prev;
    expect(res.statusCode).toBe(500);
    expect(res.body).toContain('An error occurred.');
    expect(res.body).not.toContain('internal detail leak');
  });

  it('the log record carries no founder evidence / secret material', async () => {
    const { recs, logger } = capture();
    const app = await appThatThrows(new GenerationError('invalid_model_output', 'tool_input', 'engine returned no business_model tool call'), logger);
    await app.inject({ method: 'GET', url: '/boom' });
    await app.close();
    const s = JSON.stringify({ ...recs[0], err: { m: (recs[0].err as Error).message } });
    for (const forbidden of ['sk-ant', 're_', 'Bearer', 'authorization', 'evidenceRefs', 'fragment']) {
      expect(s.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
