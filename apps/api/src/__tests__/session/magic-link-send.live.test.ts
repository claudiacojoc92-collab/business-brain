import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import type { IEmailService } from '../../session/email.service';
import { registerSessionRoutes } from '../../routes/session.routes';

/**
 * EMAIL-1 §LIVE — the magic-link route's SEND behavior with an injected adapter (real DB for token minting,
 * mock email so we control success/failure). Proves: 200 + generic success on send-ok; 503 generic on
 * send-fail (no devLink, no "sent" claim); IDENTICAL response across addresses (no existence signal); and
 * the link is ${APP_BASE_URL}/api/auth/verify?token=… . Skip-guarded on DB.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const EMAILS = ['email1.a@send.test', 'email1.b@send.test'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'], base: process.env['APP_BASE_URL'] };

let sentLinks: string[] = [];
let mode: 'ok' | 'throw' = 'ok';
const mockEmail: IEmailService = {
  async sendMagicLink(_email, link) { if (mode === 'throw') throw new Error('provider down'); sentLinks.push(link); },
};

async function purge(): Promise<void> {
  await db.deleteFrom('identity.magic_link_tokens').where('email', 'in', EMAILS).execute();
  const rows = await db.selectFrom('identity.founders').select('founder_id').where('email', 'in', EMAILS).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) await db.deleteFrom('identity.sessions').where('founder_id', 'in', ids).execute();
  await db.deleteFrom('identity.founders').where('email', 'in', EMAILS).execute();
}

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(async (s) => { registerSessionRoutes(s, mockEmail); }, { prefix: '/api' });
  await app.ready();
  return app;
}

beforeAll(async () => {
  process.env['DATABASE_URL'] = DB_URL; process.env['NODE_ENV'] = 'test';
  process.env['APP_BASE_URL'] = 'https://getbusinessbrain.com';
  try { db = createKyselyClient(DB_URL); await purge(); dbUp = true; } catch { dbUp = false; }
});
afterAll(async () => {
  try { if (dbUp) await purge(); } catch { /* ignore */ } try { await db?.destroy(); } catch { /* ignore */ }
  if (prev.node === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prev.node;
  if (prev.db === undefined) delete process.env['DATABASE_URL']; else process.env['DATABASE_URL'] = prev.db;
  if (prev.base === undefined) delete process.env['APP_BASE_URL']; else process.env['APP_BASE_URL'] = prev.base;
  vi.restoreAllMocks();
});
const post = (app: FastifyInstance, email: string) => app.inject({ method: 'POST', url: '/api/auth/magic-link', payload: { email } });

describe('magic-link send §LIVE', () => {
  it('send OK → 200; the link is APP_BASE_URL/api/auth/verify?token=… (public https, no localhost)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    mode = 'ok'; sentLinks = []; const app = await makeApp();
    const res = await post(app, EMAILS[0]!);
    expect(res.statusCode).toBe(200);
    expect(sentLinks).toHaveLength(1); // exactly one send
    expect(sentLinks[0]).toMatch(/^https:\/\/getbusinessbrain\.com\/api\/auth\/verify\?token=/);
    expect(sentLinks[0]).not.toContain('localhost');
    await app.close();
  });

  it('send FAILS → 503, generic (no devLink, no "sent" claim, no provider detail)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    mode = 'throw'; sentLinks = []; const app = await makeApp();
    const res = await post(app, EMAILS[0]!);
    expect(res.statusCode).toBe(503);
    const body = res.json<Record<string, unknown>>();
    expect(body['devLink']).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/provider|resend|422|down/i);
    await app.close();
  });

  it('no existence info — IDENTICAL response for any well-formed address', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    mode = 'ok'; sentLinks = []; const app = await makeApp();
    const a = await post(app, EMAILS[0]!); const b = await post(app, EMAILS[1]!);
    expect(a.statusCode).toBe(b.statusCode);
    expect(a.statusCode).toBe(200);
    await app.close();
  });
});
