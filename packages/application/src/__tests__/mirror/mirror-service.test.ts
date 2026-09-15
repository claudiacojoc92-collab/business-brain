/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { MirrorService, type MirrorMismatch } from '../../mirror/index';

const UNDERSTANDING = {
  understanding: {
    offer: { summary: 'Recovery-focused physiotherapy memberships', sourceRefs: ['home'] },
    positioning: { summary: 'Six service categories promoted equally', evidenceBacked: [], sourceRefs: ['services'] },
    audience: { addressed: ['post-op patients'], sourceRefs: ['home'] },
    acquisition: { visiblePaths: ['doctor referrals'], sourceRefs: [] },
    messaging: { recurringThemes: [], sourceRefs: [] },
    unknowns: ['whether corporate partnerships convert'],
  },
};

const STATE = [
  { id: 'g', kind: 'goal', statement: 'Grow recurring memberships', scope: null, temporary: false, status: 'active' },
  { id: 'c', kind: 'constraint', statement: 'No budget for major investment', scope: null, temporary: false, status: 'active' },
  { id: 's1', kind: 'decision', statement: 'I stopped Instagram because it wasn’t working', scope: 'founder_self', temporary: false, status: 'active' },
  { id: 's2', kind: 'preference', statement: 'I avoid direct sales conversations', scope: 'founder_self', temporary: false, status: 'active' },
];

const STRATEGY: any = { record: { bundle: { core: { coreBet: { priority: 'referrals' }, notNow: [{ item: 'paid ads' }], reconsiderTriggers: [{ condition: 'if referral stalls' }] } } }, adoptedAt: 't' };

function makeDeps(mismatches: Partial<MirrorMismatch>[], opts: { state?: any[]; hasStrategy?: boolean } = {}) {
  let contrastCalls = 0;
  const deps = {
    understanding: { latest: async () => UNDERSTANDING } as any,
    state: { listActive: async () => (opts.state ?? STATE) } as any,
    strategy: { getCurrent: async () => (opts.hasStrategy ? STRATEGY : null) } as any,
    model: { contrast: async () => { contrastCalls += 1; return { mismatches: mismatches as MirrorMismatch[] }; } },
  };
  return { deps, getContrastCalls: () => contrastCalls };
}

const valid: MirrorMismatch = {
  founderWords: 'You said the medical/recovery side is your priority',
  founderLane: 'business',
  against: 'Your website promotes six service categories equally',
  againstLane: 'observed',
  tension: 'You named a priority your site does not reflect.',
};

describe('MirrorService — three lanes + grounded contrast', () => {
  it('projects the three lanes: observed from the snapshot, business vs self split by scope', async () => {
    const m = makeDeps([]);
    const view = await new MirrorService(m.deps).build('B', 'Acme', 'en');
    // Lane 1 observed
    expect(view.observed.some((i) => i.statement.includes('physiotherapy memberships'))).toBe(true);
    expect(view.observed.some((i) => i.provenance === 'unknown')).toBe(true);       // unknowns kept honest
    // Lane 2 business (scope ≠ founder_self)
    expect(view.business.map((i) => i.statement)).toContain('Grow recurring memberships');
    expect(view.business.map((i) => i.statement)).not.toContain('I avoid direct sales conversations');
    // Lane 3 self (scope = founder_self)
    expect(view.self.map((i) => i.statement)).toEqual(['I stopped Instagram because it wasn’t working', 'I avoid direct sales conversations']);
    expect(view.hasSelf).toBe(true);
  });

  it('keeps a valid contrast with BOTH sides cited', async () => {
    const m = makeDeps([valid]);
    const view = await new MirrorService(m.deps).build('B', 'Acme', 'en');
    expect(view.contrasts).toHaveLength(1);
    expect(view.contrasts[0]!.founderWords).toMatch(/priority/);
    expect(view.contrasts[0]!.against).toMatch(/six service categories/);
    expect(view.contrasts[0]!.tension).toBeTruthy();
  });

  it('DROPS a one-sided mismatch (missing the observed/against side) — never states one side', async () => {
    const m = makeDeps([valid, { founderWords: 'You said X', founderLane: 'self', against: '', againstLane: 'observed', tension: 'incomplete' } as MirrorMismatch]);
    const view = await new MirrorService(m.deps).build('B', 'Acme', 'en');
    expect(view.contrasts).toHaveLength(1);        // the one-sided one is guarded out
  });

  it('does NOT fabricate: an empty model result yields no contrasts', async () => {
    const m = makeDeps([]);
    const view = await new MirrorService(m.deps).build('B', 'Acme', 'en');
    expect(view.contrasts).toEqual([]);
  });

  it('does not even call the contrast model when the founder has told BB nothing (only observed exists)', async () => {
    const m = makeDeps([valid], { state: [] });
    const view = await new MirrorService(m.deps).build('B', 'Acme', 'en');
    expect(m.getContrastCalls()).toBe(0);
    expect(view.contrasts).toEqual([]);
    expect(view.hasSelf).toBe(false);
  });

  it('caps contrasts at six — quality over quantity', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...valid, tension: `tension ${i}` }));
    const m = makeDeps(many);
    const view = await new MirrorService(m.deps).build('B', 'Acme', 'en');
    expect(view.contrasts.length).toBeLessThanOrEqual(6);
  });
});
