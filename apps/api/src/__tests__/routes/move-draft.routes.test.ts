/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerMoveDraftRoutes } from '../../routes/move-draft.routes';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';
import type { Logger } from '@bb/infrastructure';

function makeLogger(): Logger { return { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as Logger; }

const DRAFT = { sections: [{ role: 'what', heading: 'Ce facem', body: 'Oferim ședințe.' }, { role: 'proof', heading: 'Echipa', body: 'Florin Laza.' }], cta: 'Programează.' };
// A snapshot with one anchored people-atom that appears verbatim in the 'proof' section → provenance resolves it.
const SNAPSHOT = { licensedPropositions: [{ ref: 'A1', text: 'Florin Laza', source: 'business_evidence', atomClass: 'people', sourceUrl: 'https://www.bodymovestudio.ro/echipa' }] };
const mdDrafted = (status = 'drafted', version = 1) => ({ moveDraftId: 'm1', businessId: 'b1', actionId: 'a1', planVersionId: 'pv1', kind: 'landing', language: 'ro', draft: DRAFT, snapshot: SNAPSHOT as any, safetyDecision: {} as any, status, version });

function buildServer(extra: any = {}) {
  const deps = {
    db: {} as any,
    businessService: { getBusiness: async (id: string) => ({ id, name: 'Body Move' }) },
    strategyService: { getCurrent: async () => null },
    moveDraftRepo: { latestForAction: async () => null, save: async () => {}, get: async () => null },
    moveDraftService: { accept: vi.fn(async () => mdDrafted('accepted', 2)), rewriteSection: vi.fn(async () => mdDrafted('drafted', 2)) },
    ...extra,
  } as any;
  const server = Fastify();
  registerErrorHandler(server, makeLogger());
  server.addHook('preHandler', async (req) => { (req as any).user = { sub: 'founder-1', role: 'founder' }; });
  registerMoveDraftRoutes(server, deps);
  return { server, deps };
}

describe('move-draft routes — legible states, accept, rewrite', () => {
  it('GET with no draft + no adopted strategy → legible no_adopted_strategy (not 404/empty)', async () => {
    const { server } = buildServer();
    const res = await server.inject({ method: 'GET', url: '/v1/businesses/b1/moves/a1/landing-draft' });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.status).toBe('blocked');
    expect(b.reason).toBe('no_adopted_strategy');
    expect(b.unblock).toBe('adopt_strategy');
    expect(typeof b.message).toBe('string');
    expect(b.message.length).toBeGreaterThan(0);
  });

  it('GET with no draft but a strategy adopted → pending', async () => {
    const { server } = buildServer({ strategyService: { getCurrent: async () => ({ record: {}, adoptedAt: 'x' }) } });
    const res = await server.inject({ method: 'GET', url: '/v1/businesses/b1/moves/a1/landing-draft' });
    expect(res.json().status).toBe('pending');
  });

  it('GET returns the drafted sections + cta, hiding internal ids/snapshot/trace', async () => {
    const { server } = buildServer({ moveDraftRepo: { latestForAction: async () => mdDrafted('drafted', 1), save: async () => {}, get: async () => null } });
    const res = await server.inject({ method: 'GET', url: '/v1/businesses/b1/moves/a1/landing-draft' });
    const b = res.json();
    expect(b.status).toBe('drafted');
    expect(b.sections.map((s: any) => s.role)).toEqual(['what', 'proof']);
    expect(b.cta).toBe('Programează.');
    expect(b.snapshot).toBeUndefined();
    expect(b.safetyDecision).toBeUndefined();
    // Provenance rides along per section, resolved from the (hidden) snapshot — never the raw snapshot itself.
    const proof = b.sections.find((s: any) => s.role === 'proof');
    expect(proof.facts).toEqual([{ source: 'anchored', text: 'Florin Laza', sourceUrl: 'https://www.bodymovestudio.ro/echipa' }]);
    const what = b.sections.find((s: any) => s.role === 'what');
    expect(what.facts).toEqual([{ source: 'synthesized', text: null, sourceUrl: null }]); // no anchored atom present
    expect(Array.isArray(b.ctaFacts)).toBe(true);
  });

  it('POST accept calls the service and returns the accepted draft', async () => {
    const { server, deps } = buildServer();
    const res = await server.inject({ method: 'POST', url: '/v1/businesses/b1/moves/a1/landing-draft/accept' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('accepted');
    expect(deps.moveDraftService.accept).toHaveBeenCalledWith('b1', 'a1');
  });

  it('POST rewrite a section calls the service; an unknown section is rejected', async () => {
    const { server, deps } = buildServer();
    const ok = await server.inject({ method: 'POST', url: '/v1/businesses/b1/moves/a1/landing-draft/sections/proof/rewrite' });
    expect(ok.statusCode).toBe(200);
    expect(deps.moveDraftService.rewriteSection).toHaveBeenCalledWith('b1', 'a1', 'proof');
    const bad = await server.inject({ method: 'POST', url: '/v1/businesses/b1/moves/a1/landing-draft/sections/nonsense/rewrite' });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
  });
});
