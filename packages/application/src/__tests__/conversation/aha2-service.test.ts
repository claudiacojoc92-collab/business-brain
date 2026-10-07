/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { Aha2Service, type Aha2Deps, type Aha2Event } from '../../conversation/index';
import type { Aha2Output, Aha2RepairInput } from '../../conversation/contracts';

const UNDERSTANDING = {
  positioning: { summary: 'Positioning built around the founder’s personal expertise' },
  audience: { addressed: ['a broad audience from startups to enterprises'] },
  acquisition: { visiblePaths: ['/hire-us contact page'] },
  contradictions: [],
};

function makeDeps(opts: {
  synthesize: () => Promise<Aha2Output>;
  repair?: (i: Aha2RepairInput) => Promise<Aha2Output>;
  founder?: { kind: string; statement: string }[];
}) {
  const events: Aha2Event[] = [];
  const saved: any[] = [];
  const founder = opts.founder ?? [
    { kind: 'preference', statement: 'prefer healthcare events over paid ads' },
    { kind: 'goal', statement: 'land 10 recurring B2B retainer clients' },
  ];
  const deps: Aha2Deps = {
    understanding: { save: async () => { throw new Error('n/a'); }, latest: async () => ({ id: 'snap', understanding: UNDERSTANDING }) as any },
    state: {
      append: async () => { throw new Error('n/a'); },
      listActive: async () => founder.map((f, i) => ({ id: `s${i}`, kind: f.kind as any, statement: f.statement, scope: null, temporary: false, status: 'active' as const })),
      setStatus: async () => null,
      setTemporary: async () => undefined,
    },
    observations: { listActive: async () => [], observe: async () => { throw new Error('n/a'); }, setStatus: async () => null },
    conversations: {
      getByBusiness: async () => null, create: async () => { throw new Error('n/a'); },
      setStatus: async () => undefined, setLanguage: async () => undefined,
      appendTurn: async () => { throw new Error('n/a'); }, listTurns: async () => [],
    },
    model: {
      synthesize: opts.synthesize,
      repair: opts.repair ?? (async () => ({ findings: [] })),
    },
    aha2: {
      save: async (i) => { const rec = { ...i, createdAt: '1970' }; saved.push(rec); return rec as any; },
      latest: async () => null,
    },
    log: (e) => events.push(e),
  };
  return { deps, events, saved };
}

const P = { businessId: 'B', businessName: 'Acme', language: 'en' };

describe('Aha2Service repair loop', () => {
  it('repairs a strategy-selecting candidate into a valid constraint and persists it', async () => {
    let calls = 0;
    const m = makeDeps({
      synthesize: async () => ({ findings: [{
        implication: 'You want retainer clients, so you should focus on one acquisition channel.',
        businessRefs: ['B1'], founderRefs: ['F2'], observationRefs: [],
      }] }),
      repair: async () => { calls += 1; return { findings: [{
        implication: 'You want recurring retainer clients, but the site addresses a broad audience and does not make the hire-us path obvious — a gap any strategy must close.',
        businessRefs: ['B1', 'B2'], founderRefs: ['F2'], observationRefs: [],
      }] }; },
    });
    const rec = await new Aha2Service(m.deps).generate(P.businessId, P.businessName, P.language);
    expect(rec.status).toBe('produced');
    expect(calls).toBe(1);
    expect(rec.findings[0]?.implication).toContain('any strategy must close');
    expect(rec.findings[0]?.implication.toLowerCase()).not.toContain('focus on');
    expect(m.events.some((e) => e.type === 'repair_attempt')).toBe(true);
    expect(m.events.some((e) => e.type === 'repaired_ok')).toBe(true);
  });

  it('repairs a founder-state upgrade (preference → segment) into a licensed constraint', async () => {
    const m = makeDeps({
      founder: [{ kind: 'preference', statement: 'prefer healthcare events' }],
      synthesize: async () => ({ findings: [{
        implication: 'Your preference for healthcare events points toward a specific segment the site does not center.',
        businessRefs: ['B1'], founderRefs: ['F1'], observationRefs: [],
      }] }),
      repair: async () => ({ findings: [{
        implication: 'You prefer healthcare events as a route, while the site currently speaks to a broad audience — so any strategy cannot assume the current positioning already supports that route.',
        businessRefs: ['B1'], founderRefs: ['F1'], observationRefs: [],
      }] }),
    });
    const rec = await new Aha2Service(m.deps).generate(P.businessId, P.businessName, P.language);
    expect(rec.status).toBe('produced');
    expect(rec.findings[0]?.implication.toLowerCase()).not.toContain('specific segment');
    expect(rec.findings[0]?.implication).toContain('cannot assume');
  });

  it('fails closed when repair still violates the boundary after bounded attempts', async () => {
    let repairCalls = 0;
    const m = makeDeps({
      synthesize: async () => ({ findings: [{
        implication: 'You want clients, so you should focus on Instagram.',
        businessRefs: ['B1'], founderRefs: ['F2'], observationRefs: [],
      }] }),
      repair: async () => { repairCalls += 1; return { findings: [{
        implication: 'You should still focus on one channel.',
        businessRefs: ['B1'], founderRefs: ['F2'], observationRefs: [],
      }] }; },
    });
    const rec = await new Aha2Service(m.deps).generate(P.businessId, P.businessName, P.language);
    expect(rec.status).toBe('insufficient');
    expect(rec.findings).toHaveLength(0);
    expect(repairCalls).toBe(2); // bounded
    expect(m.events.some((e) => e.type === 'failed_closed')).toBe(true);
  });

  it('does not call repair when the first candidate is already valid', async () => {
    let repairCalls = 0;
    const m = makeDeps({
      synthesize: async () => ({ findings: [{
        implication: 'You want recurring retainer clients, but the site addresses a broad audience and does not make the hire-us path obvious — a gap any strategy must close.',
        businessRefs: ['B1', 'B2'], founderRefs: ['F2'], observationRefs: [],
      }] }),
      repair: async () => { repairCalls += 1; return { findings: [] }; },
    });
    const rec = await new Aha2Service(m.deps).generate(P.businessId, P.businessName, P.language);
    expect(rec.status).toBe('produced');
    expect(repairCalls).toBe(0);
    expect(m.events.some((e) => e.type === 'first_pass_ok')).toBe(true);
  });
});
