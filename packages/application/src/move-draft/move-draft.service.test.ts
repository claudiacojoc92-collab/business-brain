import { describe, it, expect, vi } from 'vitest';
import { MoveDraftService } from './move-draft.service';
import type { ILandingModelPort, IMoveDraftRepository, LandingAuthorizationSnapshot, LandingDraft, MoveDraft } from './contracts';
import type { PropositionCheckInput, PropositionCheckOutput } from '../voice/contracts';

const SNAP: LandingAuthorizationSnapshot = {
  snapshotId: 's1', businessId: 'b1', actionId: 'p1-a1', createHandoffId: null, strategyVersionId: 'sv1',
  language: 'ro', speakingRole: 'brand', audienceUseContext: 'oameni care caută mișcare ghidată',
  licensedPropositions: [
    { ref: 'B1', text: 'Body Move este un studio de mișcare din București', source: 'business_evidence' },
    { ref: 'B2', text: 'oferim ședințe individuale', source: 'business_evidence' },
  ],
  proofFacts: [], ctaFunction: 'programează o primă ședință', ownedStances: [], safetyContractHash: null,
  producedAt: '2026-10-05T00:00:00.000Z',
};

const CLEAN: LandingDraft = {
  sections: [
    { role: 'hero_headline', body: 'Body Move — un studio de mișcare din București.' },
    { role: 'what', heading: 'Ce facem', body: 'Oferim ședințe individuale.' },
  ],
  cta: 'Programează o primă ședință.',
};
const MEDICAL: LandingDraft = {
  sections: [
    { role: 'hero_headline', body: 'Tratăm durerile de spate.' }, // class 2 — regulated
    { role: 'what', heading: 'Ce facem', body: 'Oferim ședințe individuale.' },
  ],
  cta: 'Programează o primă ședință.',
};

function repo(): IMoveDraftRepository & { saved: MoveDraft[] } {
  const saved: MoveDraft[] = [];
  return { saved, save: async (d) => { saved.push(d); }, latestForAction: async () => saved[saved.length - 1] ?? null, get: async () => null };
}
/** A model that returns a scripted draft per call (draft, then repair, then repair…). */
function model(scripts: LandingDraft[]): ILandingModelPort & { calls: string[] } {
  const calls: string[] = []; let i = 0;
  const next = () => scripts[Math.min(i++, scripts.length - 1)]!;
  return { calls, draft: async () => { calls.push('draft'); return next(); }, repair: async () => { calls.push('repair'); return next(); } };
}
const args = { businessId: 'b1', actionId: 'p1-a1', planVersionId: 'pv1', snapshot: SNAP, communicationJob: 'landing page', voiceLines: [], language: 'ro' };

// A snapshot carrying a licensed PERSON (atomClass 'people') whose name the draft must reproduce faithfully.
const SNAP_PEOPLE: LandingAuthorizationSnapshot = {
  ...SNAP,
  licensedPropositions: [...SNAP.licensedPropositions, { ref: 'A1', text: 'Florin Laza Kinetoterapeut', source: 'business_evidence', atomClass: 'people' }],
};
const argsPeople = { ...args, snapshot: SNAP_PEOPLE };
const CORRUPT_NAME: LandingDraft = {
  sections: [{ role: 'hero_headline', body: 'Body Move — un studio de mișcare din București.' }, { role: 'proof', heading: 'Echipa', body: 'Florin Lazăr este alături de tine.' }],
  cta: 'Programează o primă ședință.',
};
const FAITHFUL_NAME: LandingDraft = {
  sections: [{ role: 'hero_headline', body: 'Body Move — un studio de mișcare din București.' }, { role: 'proof', heading: 'Echipa', body: 'Florin Laza este alături de tine.' }],
  cta: 'Programează o primă ședință.',
};

describe('MoveDraftService — orchestration', () => {
  it('a clean draft → status drafted, draft stored', async () => {
    const r = repo();
    const svc = new MoveDraftService({ model: model([CLEAN]), repo: r });
    const md = await svc.produceLanding(args);
    expect(md.status).toBe('drafted');
    expect(md.draft).not.toBeNull();
    expect(md.safetyDecision.failingLayer).toBeNull();
    expect(r.saved[0]?.status).toBe('drafted'); // persisted
  });

  it('gate order: a medical failure fails fast — the Layer-3 judge is NOT called', async () => {
    const judge = vi.fn(async (_i: PropositionCheckInput): Promise<PropositionCheckOutput> => ({ newPropositions: [] }));
    const svc = new MoveDraftService({ model: model([MEDICAL]), judge, repo: repo() });
    const md = await svc.produceLanding(args);
    expect(md.status).toBe('blocked');
    expect(md.safetyDecision.failingLayer).toBe('medical');
    expect(judge).not.toHaveBeenCalled();                 // judge never runs on copy medical already rejected
    expect(md.safetyDecision.layersRun).not.toContain('judge');
  });

  it('targeted repair recovers: a medical first draft, a clean repair → drafted after 1 repair', async () => {
    const m = model([MEDICAL, CLEAN]);
    const svc = new MoveDraftService({ model: m, repo: repo() });
    const md = await svc.produceLanding(args);
    expect(md.status).toBe('drafted');
    expect(md.safetyDecision.repairAttempts).toBe(1);
    expect(m.calls).toEqual(['draft', 'repair']);
  });

  it('bounded repair: a model that keeps emitting a medical claim → blocked after exactly 2 repairs', async () => {
    const m = model([MEDICAL, MEDICAL, MEDICAL, MEDICAL]);
    const r = repo();
    const svc = new MoveDraftService({ model: m, repo: r });
    const md = await svc.produceLanding(args);
    expect(md.status).toBe('blocked');
    expect(md.draft).toBeNull();                          // fail-closed: nothing unsafe stored as a shown draft
    expect(md.safetyDecision.repairAttempts).toBe(2);     // bounded
    expect(m.calls).toEqual(['draft', 'repair', 'repair']); // 1 draft + 2 repairs, then stop
    expect(r.saved[0]?.status).toBe('blocked');           // the BLOCKED outcome is stored (queryable), not just logged
    expect(r.saved[0]?.safetyDecision.failingLayer).toBe('medical');
  });

  it('the Layer-3 judge blocks when the cheap tiers pass but the judge finds a new proposition', async () => {
    const judge = vi.fn(async (): Promise<PropositionCheckOutput> => ({ newPropositions: [{ clause: 'Oferim ședințe individuale.', proposition: 'invented scope', reason: 'not authorized' }] }));
    const svc = new MoveDraftService({ model: model([CLEAN]), judge, repo: repo() });
    const md = await svc.produceLanding(args);
    expect(md.status).toBe('blocked');
    expect(md.safetyDecision.failingLayer).toBe('judge');
    expect(judge).toHaveBeenCalled();                     // judge DID run (cheap tiers passed)
  });

  it('people fidelity: a corrupted licensed name blocks the draft (after repair), never ships', async () => {
    const r = repo();
    const svc = new MoveDraftService({ model: model([CORRUPT_NAME, CORRUPT_NAME, CORRUPT_NAME]), repo: r });
    const md = await svc.produceLanding(argsPeople);
    expect(md.status).toBe('blocked');
    expect(md.safetyDecision.failingLayer).toBe('people_fidelity');
    expect(r.saved[0]?.safetyDecision.failures.some((f) => f.rule.includes('Florin Laza'))).toBe(true);
  });

  it('people fidelity: the faithful name (diacritics aside) passes', async () => {
    const svc = new MoveDraftService({ model: model([FAITHFUL_NAME]), repo: repo() });
    const md = await svc.produceLanding(argsPeople);
    expect(md.status).toBe('drafted');
  });

  it('a language with no reviewed guard vocabulary is blocked WITHOUT calling the model', async () => {
    const m = model([CLEAN]);
    const svc = new MoveDraftService({ model: m, repo: repo() });
    const md = await svc.produceLanding({ ...args, language: 'it' });
    expect(md.status).toBe('blocked');
    expect(m.calls).toEqual([]);                          // the generator never emits a language the guard can't vouch for
  });
});
