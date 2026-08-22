/**
 * Slice 6 — Concept material-feasibility + CTA communication-closure (quality contracts, distinct from
 * claim safety). Feasibility binds each beat to authorized meaning and contracts / rejects before copy;
 * closure fails a safe-but-unearned CTA.
 */
import { describe, it, expect } from 'vitest';
import { checkFeasibility, meaningUnits } from '../../carousel/feasibility';
import { validateClosure } from '../../carousel/closure';
import type { AssetAuthorizationSnapshot, Slide, TextBlock, SlideRole, TextBlockRole, CarouselProposition } from '../../carousel/contracts';

function snap(over: Partial<AssetAuthorizationSnapshot> = {}): AssetAuthorizationSnapshot {
  return {
    snapshotId: 's', businessId: 'B', createHandoffId: 'ch', strategyVersionId: 'sv', language: 'en', speakingRole: 'the founder',
    audienceUseContext: 'seed-stage SaaS founders who just raised', licensedPropositions: [], proofFacts: [], ctaFunction: 'book a 20-minute diagnostic call',
    ownedStances: [], sourceRefs: [], modelId: null, safetyContractHash: null, producedAt: 't', ...over,
  };
}
const prop = (ref: string, text: string, source: CarouselProposition['source']): CarouselProposition => ({ ref, text, source });
let seq = 0;
const tb = (role: TextBlockRole, text: string): TextBlock => ({ blockId: `b${seq++}`, role, text, authorizedFrom: { propositionRef: null, sourceRefId: null, ctaFunction: role === 'cta' ? 'book' : null }, locked: false });
const mk = (role: SlideRole, blocks: TextBlock[]): Slide => ({ slideId: `sl${seq++}`, order: 0, semanticRole: role, textBlocks: blocks, mediaSlots: [], layoutFamily: 'editorial_text', layoutParams: {}, lockedFields: [], sourceRefIds: [] });

describe('Slice 6 — concept material-feasibility', () => {
  it('excludes strategy decisions from meaning units; keeps business/founder/proof', () => {
    const u = meaningUnits(snap({ licensedPropositions: [prop('D1', 'we lead with proof', 'strategy_decision'), prop('B1', 'we offer a diagnostic', 'business_evidence')], proofFacts: ['a client cut burn 30%'] }));
    expect(u.some((x) => x.type === 'business_fact')).toBe(true);
    expect(u.some((x) => x.type === 'proof')).toBe(true);
    expect(u.some((x) => x.text === 'we lead with proof')).toBe(false);
  });

  it('contracts a padded outline to the grounded beats (no padding beyond available meaning)', () => {
    const s = snap({ licensedPropositions: [prop('B1', 'we offer a fractional-CFO diagnostic', 'business_evidence')] }); // 1 business_fact + audience
    const r = checkFeasibility(['hook', 'context', 'insight', 'proof', 'cta'], s); // insight+proof orphaned
    expect(r.feasible).toBe(true);
    expect(r.outline[0]).toBe('hook'); expect(r.outline[r.outline.length - 1]).toBe('cta');
    expect(r.outline).not.toContain('proof');   // no proof unit → dropped
    expect(r.outline).not.toContain('insight');  // no founder_insight → dropped
    expect(r.outline.length).toBeLessThanOrEqual(4); // capped by available substantive meaning
  });

  it('rejects as infeasible when there is no authorized substantive meaning (only framing)', () => {
    const s = snap({ licensedPropositions: [prop('D1', 'we lead with proof', 'strategy_decision')], audienceUseContext: '' });
    const r = checkFeasibility(['hook', 'insight', 'cta'], s);
    expect(r.feasible).toBe(false);
  });

  it('a proof beat is grounded only when a documented proof fact exists', () => {
    const s = snap({ proofFacts: ['a seed-stage SaaS client cut burn 30%'] });
    expect(checkFeasibility(['hook', 'proof', 'cta'], s).outline).toContain('proof');
  });
});

describe('Slice 6 — communication closure (quality, not safety)', () => {
  const S = snap({ licensedPropositions: [prop('B1', 'a 20-minute diagnostic call reviewing runway and burn', 'business_evidence')] });
  it('flags a CTA that names no concrete action', async () => {
    const slides = [mk('hook', [tb('headline', 'Finance clarity')]), mk('cta', [tb('cta', 'Finance clarity for founders')])];
    const f = await validateClosure(slides, S);
    expect(f.some((x) => x.code === 'cta_no_action')).toBe(true);
  });
  it('flags a CTA slide that repeats itself without added clarity', async () => {
    const slides = [mk('hook', [tb('headline', 'Book the diagnostic call')]), mk('cta', [tb('headline', 'Book the diagnostic call now'), tb('cta', 'Book the diagnostic call')])];
    const f = await validateClosure(slides, S);
    expect(f.some((x) => x.code === 'cta_redundant')).toBe(true);
  });
  it('passes a concrete, non-redundant CTA (no judge)', async () => {
    const slides = [mk('hook', [tb('headline', 'Runway pressure after raising?')]), mk('cta', [tb('headline', 'See where your numbers stand'), tb('cta', 'Book a 20-minute diagnostic call')])];
    expect(await validateClosure(slides, S)).toHaveLength(0);
  });
  it('fails when the semantic closure judge says the CTA is not earned', async () => {
    const slides = [mk('hook', [tb('headline', 'Runway pressure after raising?')]), mk('cta', [tb('cta', 'Book a 20-minute diagnostic call')])];
    const judge = async () => ({ closed: false, reason: 'the diagnostic is never explained in the body' });
    const f = await validateClosure(slides, S, judge);
    expect(f.some((x) => x.code === 'cta_not_closed')).toBe(true);
  });
});
