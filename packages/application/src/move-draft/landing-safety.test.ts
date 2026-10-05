import { describe, it, expect } from 'vitest';
import { specFromLandingSnapshot, landingDraftToSampleContent, landingSectionToSampleContent } from './landing-safety';
import { validateAgainstAuthorization } from '../voice/proposition-safety';
import type { LandingAuthorizationSnapshot, LandingDraft } from './contracts';

const snap = (over: Partial<LandingAuthorizationSnapshot> = {}): LandingAuthorizationSnapshot => ({
  snapshotId: 's1', businessId: 'b1', actionId: 'p1-a1', createHandoffId: null, strategyVersionId: 'sv1',
  language: 'en', speakingRole: 'brand', audienceUseContext: 'people looking for guided movement',
  licensedPropositions: [
    { ref: 'B1', text: 'Body Move is a movement studio in Bucharest', source: 'business_evidence' },
    { ref: 'B2', text: 'we offer one-on-one sessions', source: 'business_evidence' },
    { ref: 'F1', text: 'we believe in moving at your own pace', source: 'founder_owned' },
    { ref: 'D1', text: 'lead with the one-on-one format', source: 'strategy_decision' },
  ],
  proofFacts: [], ctaFunction: 'book a first session', ownedStances: [], safetyContractHash: null,
  producedAt: '2026-10-05T00:00:00.000Z', ...over,
});

describe('specFromLandingSnapshot', () => {
  it('folds strategy_decision into internalDecisions (never licensed) and licenses the rest', () => {
    const spec = specFromLandingSnapshot(snap(), 'landing page');
    const licensedTexts = spec.licensedPropositions.map((p) => p.text);
    expect(licensedTexts).toContain('Body Move is a movement studio in Bucharest');
    expect(licensedTexts).toContain('we offer one-on-one sessions');
    expect(licensedTexts).toContain('we believe in moving at your own pace');
    expect(licensedTexts).not.toContain('lead with the one-on-one format');     // strategy decision is internal
    expect(spec.internalDecisions).toContain('lead with the one-on-one format');
    expect(spec.stanceStatements).toContain('we believe in moving at your own pace'); // founder_owned → stance
    expect(spec.feasibility).toBe('feasible');
  });

  it('licenses proof facts as behavior_result', () => {
    const spec = specFromLandingSnapshot(snap({ proofFacts: ['featured in a local paper in 2025'] }), 'landing page');
    expect(spec.licensedPropositions.find((p) => p.text === 'featured in a local paper in 2025')?.source).toBe('behavior_result');
  });

  it('blocks and records unknowns when nothing is licensable', () => {
    const spec = specFromLandingSnapshot(snap({ licensedPropositions: [{ ref: 'D1', text: 'lead with X', source: 'strategy_decision' }], proofFacts: [] }), 'landing page');
    expect(spec.feasibility).toBe('blocked_missing_material');
    expect(spec.unknowns.join(' ')).toMatch(/No licensed external material/);
    expect(spec.unknowns.join(' ')).toMatch(/No licensed historical client-result/);
  });
});

const draft = (): LandingDraft => ({
  sections: [
    { role: 'hero_headline', body: 'Body Move is a movement studio in Bucharest.' },
    { role: 'what', heading: 'What we do', body: 'We offer one-on-one sessions.' },
    { role: 'cta', body: 'ignored — the real CTA is the draft.cta field' },
  ],
  cta: 'Book a first session.',
});

describe('landingDraftToSampleContent', () => {
  it('maps non-CTA section headings+bodies to beats and the CTA to the separate cta field', () => {
    const sc = landingDraftToSampleContent(draft());
    expect(sc.beats).toEqual(['Body Move is a movement studio in Bucharest.', 'What we do', 'We offer one-on-one sessions.']);
    expect(sc.cta).toBe('Book a first session.');
    // the cta SECTION body must not leak into beats (the CTA is a discrete field, carousel-like not caption-like)
    expect(sc.beats).not.toContain('ignored — the real CTA is the draft.cta field');
  });
});

describe('landingSectionToSampleContent', () => {
  it('a body section → beats; the CTA section → cta only', () => {
    expect(landingSectionToSampleContent({ role: 'what', heading: 'What', body: 'We offer sessions.' }, 'Book now.')).toEqual({ beats: ['What', 'We offer sessions.'] });
    expect(landingSectionToSampleContent({ role: 'cta', body: 'x' }, 'Book a first session.')).toEqual({ cta: 'Book a first session.' });
  });
});

describe('the adapter output is kernel-consumable (Day-1 wiring)', () => {
  it('a clean draft (only licensed facts) mapped → kernel-clean deterministically', async () => {
    const spec = specFromLandingSnapshot(snap(), 'landing page');
    const sc = landingDraftToSampleContent(draft());
    const v = await validateAgainstAuthorization(sc, 'carousel', spec, undefined); // judge undefined → Layer 1/2 only
    expect(v.reasons).toEqual([]); // the frozen kernel accepts mapped landing prose that restates licensed facts
  });
});
