/**
 * Slice 6 — targeted claim-safety tests (§8). These prove the carousel reuses the FROZEN Layer 1/2/3
 * contract and distinguishes: (B) authorized factual paraphrase [PASS], (C) new capability/outcome, scope-
 * mismatch, and population claims [FAIL], (D) non-propositional discourse [PASS], (F) composition-level
 * implication across otherwise-legal slides [asset-level FAIL], plus CTA governed as a Layer-2 invitation
 * and the immutable safety trace. The Layer-3 judge is a deterministic standin keyed to the contract; the
 * real model is falsified live (§9).
 */
import { describe, it, expect } from 'vitest';
import { validateCarouselClaimSafety, specFromSnapshot } from '../../carousel/carousel-safety';
import type { AssetAuthorizationSnapshot, Slide, TextBlock, SlideRole, TextBlockRole } from '../../carousel/contracts';

const SNAP: AssetAuthorizationSnapshot = {
  snapshotId: 'snap1', businessId: 'B', createHandoffId: 'ch1', strategyVersionId: 'sv1',
  language: 'en', speakingRole: 'the founder', audienceUseContext: 'seed-stage SaaS founders who just raised',
  licensedPropositions: [
    { ref: 'D1', text: 'we lead with a documented client outcome rather than credentials', source: 'strategy_decision' },
    { ref: 'B1', text: 'we offer a fractional-CFO diagnostic for seed-stage SaaS founders', source: 'business_evidence' },
  ],
  proofFacts: ['a seed-stage SaaS client cut burn 30% after a fractional-CFO engagement'],
  ctaFunction: 'book a 20-minute diagnostic call', ownedStances: [], sourceRefs: [],
  modelId: null, safetyContractHash: null, producedAt: 't',
};

let blockSeq = 0;
const tb = (role: TextBlockRole, text: string): TextBlock => ({ blockId: `blk-${blockSeq++}`, role, text, authorizedFrom: { propositionRef: null, sourceRefId: null, ctaFunction: role === 'cta' ? 'book' : null }, locked: false });
const mkSlide = (slideId: string, role: SlideRole, blocks: TextBlock[]): Slide => ({ slideId, order: 0, semanticRole: role, textBlocks: blocks, mediaSlots: [], layoutFamily: 'editorial_text', layoutParams: {}, lockedFields: [], sourceRefIds: [] });

// Deterministic standin for the frozen Layer-3 proposition judge, keyed to the contract distinctions.
const judge = {
  contract: () => ({ modelId: 'judge-standin', promptHash: 'jph' }),
  check: async ({ content }: any) => {
    const lc = [content.hook, ...(content.beats ?? []), content.caption, content.cta].filter(Boolean).join(' \n ').toLowerCase();
    const p: { clause: string; proposition: string; reason: string }[] = [];
    if (/cut your burn/.test(lc) || /we can (cut|save|grow|halve)/.test(lc)) p.push({ clause: 'we can cut your burn by 30%', proposition: 'capability to deliver a specific outcome to the reader', reason: 'no licensed capability claim' });
    if (/\d+%\s+conversion/.test(lc)) p.push({ clause: 'target 30% conversion', proposition: 'a 30% conversion metric', reason: 'scope mismatch: licensed proof is burn reduction' });
    if (/most .*founders/.test(lc)) p.push({ clause: 'most seed-stage founders waste money on finance hires', proposition: 'a population/market claim about founders', reason: 'no licensed market evidence' });
    if (/cut burn (by )?30%/.test(lc) && /imagine what that could do for you/.test(lc)) p.push({ clause: 'the reader will achieve the same 30% reduction', proposition: 'implied reader outcome from the documented case', reason: 'sequence transfers the documented result to the reader' });
    return { newPropositions: p };
  },
};
const run = (slides: Slide[]) => validateCarouselClaimSafety(slides, SNAP, 'turn the case study into a trust-building carousel', judge.check, judge.contract(), 1);

describe('Slice 6 — carousel claim safety (frozen Layer 1/2/3, one authority)', () => {
  it('specFromSnapshot: strategy decisions are INTERNAL; only real material is licensed', () => {
    const spec = specFromSnapshot(SNAP, 'job');
    expect(spec.internalDecisions).toContain('we lead with a documented client outcome rather than credentials');
    const licensed = spec.licensedPropositions.map((p) => p.text);
    expect(licensed).toContain('we offer a fractional-CFO diagnostic for seed-stage SaaS founders');
    expect(licensed).toContain('a seed-stage SaaS client cut burn 30% after a fractional-CFO engagement');
    expect(licensed).not.toContain('we lead with a documented client outcome rather than credentials');
  });

  it('A. authorized factual paraphrase of a licensed proof PASSES', async () => {
    const r = await run([
      mkSlide('s1', 'hook', [tb('headline', 'The seed-stage SaaS founder who got finance clarity')]),
      mkSlide('s2', 'proof', [tb('body', 'The client cut burn by 30% after a fractional-CFO engagement.')]),
      mkSlide('s3', 'cta', [tb('cta', 'Book a 20-minute diagnostic call')]),
    ]);
    expect(r.findings).toHaveLength(0);
  });

  it('B. capability/outcome generalization to the reader FAILS', async () => {
    const r = await run([
      mkSlide('s1', 'hook', [tb('headline', 'Finance clarity for founders')]),
      mkSlide('s2', 'proof', [tb('body', 'We can cut your burn by 30%.')]),
      mkSlide('s3', 'cta', [tb('cta', 'Book a call')]),
    ]);
    expect(r.findings.some((f) => f.code === 'block_new_proposition' && f.slideId === 's2')).toBe(true);
  });

  it('C. scope-mismatch numeric claim FAILS', async () => {
    const r = await run([
      mkSlide('s1', 'hook', [tb('headline', 'Grow faster')]),
      mkSlide('s2', 'insight', [tb('body', 'Target 30% conversion this quarter.')]),
      mkSlide('s3', 'cta', [tb('cta', 'Book a call')]),
    ]);
    expect(r.findings.some((f) => /new_proposition|composition/.test(f.code))).toBe(true);
  });

  it('D. unlicensed population/market claim FAILS', async () => {
    const r = await run([
      mkSlide('s1', 'hook', [tb('headline', 'Most seed-stage founders waste money on finance hires')]),
      mkSlide('s2', 'proof', [tb('body', 'The client cut burn by 30%.')]),
      mkSlide('s3', 'cta', [tb('cta', 'Book a call')]),
    ]);
    expect(r.findings.some((f) => f.slideId === 's1')).toBe(true);
  });

  it('E. non-propositional discourse PASSES (Layer 2, deterministic)', async () => {
    const r = await run([
      mkSlide('s1', 'hook', [tb('headline', "I'll keep this short.")]),
      mkSlide('s2', 'proof', [tb('body', 'The client cut burn by 30%.')]),
      mkSlide('s3', 'cta', [tb('cta', 'Book a 20-minute diagnostic call')]),
    ]);
    expect(r.findings).toHaveLength(0);
  });

  it('F. individually-legal slides that imply a reader outcome together FAIL at the ASSET level', async () => {
    const r = await run([
      mkSlide('s1', 'hook', [tb('headline', 'A documented turnaround')]),
      mkSlide('s2', 'proof', [tb('body', 'One client cut burn 30%.')]),
      mkSlide('s3', 'insight', [tb('body', 'Now imagine what that could do for you.')]),
      mkSlide('s4', 'cta', [tb('cta', 'Book a call')]),
    ]);
    expect(r.findings.some((f) => f.code === 'asset_composition_proposition' && f.slideId === null)).toBe(true);
    expect(r.trace.fullAssetFindings.length).toBeGreaterThan(0);
  });

  it('G. a CTA invitation is governed as Layer-2 discourse, not a world claim', async () => {
    const r = await run([
      mkSlide('s1', 'hook', [tb('headline', 'Finance clarity for founders')]),
      mkSlide('s2', 'proof', [tb('body', 'The client cut burn by 30%.')]),
      mkSlide('s3', 'cta', [tb('cta', 'Book a 20-minute diagnostic call')]),
    ]);
    expect(r.findings).toHaveLength(0);
    expect(r.trace.layer2Permitted.some((d) => d.discourseCategory === 'cta_invitation')).toBe(true);
  });

  it('H. the trace carries the governing decision + provenance', async () => {
    const r = await run([
      mkSlide('s1', 'hook', [tb('headline', 'Most seed-stage founders waste money on finance hires')]),
      mkSlide('s2', 'proof', [tb('body', 'The client cut burn by 30%.')]),
      mkSlide('s3', 'cta', [tb('cta', 'Book a call')]),
    ]);
    expect(r.trace.judgeModelId).toBe('judge-standin');
    expect(typeof r.trace.propositionContractHash).toBe('string');
    expect(r.trace.semanticBlockFindings.length + r.trace.fullAssetFindings.length).toBeGreaterThan(0);
  });
});
