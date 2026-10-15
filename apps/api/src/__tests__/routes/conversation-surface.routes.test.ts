/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerConversationRoutes } from '../../routes/conversation.routes';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';
import type { Logger } from '@bb/infrastructure';

// V086: the Talk drawer and the conversation page share these routes, so the client names its surface (closed set);
// anything else is stored as unknown (null), never guessed. Reopen is the conversation page only.
function makeLogger(): Logger { return { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as Logger; }
const fakeDb = { getExecutor: () => ({ transformQuery: (n: any) => n, compileQuery: () => ({ sql: '', parameters: [] }), executeQuery: async () => ({ rows: [] }) }) } as any;

function buildServer() {
  const view = { session: { id: 's1', status: 'active', conversationLanguage: 'en' }, turns: [], readyForAha2: false };
  const conversationService = { startOrResume: vi.fn(async () => view), reopen: vi.fn(async () => view), submitResponse: vi.fn(async () => view) };
  const deps = {
    db: fakeDb,
    businessService: { getBusiness: async (id: string) => ({ id, name: 'Body Move' }) },
    founderAccountService: { getById: async () => ({ interfaceLocale: 'en' }) },
    conversationService,
  } as any;
  const server = Fastify();
  registerErrorHandler(server, makeLogger());
  server.addHook('preHandler', async (req) => { (req as any).user = { sub: 'founder-1', role: 'founder' }; });
  registerConversationRoutes(server, deps);
  return { server, conversationService };
}

describe('conversation routes pass the surface through', () => {
  it('start and turn carry the client surface; the screen context is passed for grounding, never as the surface', async () => {
    const { server, conversationService: c } = buildServer();
    await server.inject({ method: 'POST', url: '/v1/businesses/b1/conversation', payload: { surface: 'talk' } });
    expect(c.startOrResume).toHaveBeenCalledWith('b1', 'founder-1', 'Body Move', 'en', 'talk');
    await server.inject({ method: 'POST', url: '/v1/businesses/b1/conversation/turn', payload: { message: 'why?', context: 'strategy card', surface: 'talk' } });
    expect(c.submitResponse).toHaveBeenLastCalledWith('b1', 'founder-1', 'Body Move', 'why?', 'en', 'strategy card', 'talk');
    await server.inject({ method: 'POST', url: '/v1/businesses/b1/conversation/turn', payload: { message: 'ok', surface: 'conversation' } });
    expect(c.submitResponse).toHaveBeenLastCalledWith('b1', 'founder-1', 'Body Move', 'ok', 'en', null, 'conversation');
  });

  it('a missing or unknown surface is stored as unknown (null)', async () => {
    const { server, conversationService: c } = buildServer();
    await server.inject({ method: 'POST', url: '/v1/businesses/b1/conversation', payload: {} });
    expect(c.startOrResume).toHaveBeenCalledWith('b1', 'founder-1', 'Body Move', 'en', null);
    await server.inject({ method: 'POST', url: '/v1/businesses/b1/conversation/turn', payload: { message: 'x', surface: 'home-screen' } });
    expect(c.submitResponse).toHaveBeenLastCalledWith('b1', 'founder-1', 'Body Move', 'x', 'en', null, null);
  });

  it('reopen (baseline refresh) is the conversation page', async () => {
    const { server, conversationService: c } = buildServer();
    await server.inject({ method: 'POST', url: '/v1/businesses/b1/conversation/reopen', payload: {} });
    expect(c.reopen).toHaveBeenCalledWith('b1', 'founder-1', 'Body Move', 'en', 'conversation');
  });
});
