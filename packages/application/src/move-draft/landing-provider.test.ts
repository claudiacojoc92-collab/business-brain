import { describe, it, expect } from 'vitest';
import { assembleLandingMove, NO_ADOPTED_STRATEGY_MESSAGE, type LandingContextView } from './landing-provider';

const ids = { businessId: 'b1', actionId: 'p1-a1', planVersionId: 'pv1' };
const now = () => '2026-10-06T00:00:00.000Z';
const genId = () => 'snap-1';

const CTX: LandingContextView = {
  strategyVersionId: 'sv1', language: 'ro', goal: 'activarea canalului B2B medical', audience: 'medici din Cluj',
  ctaDirection: 'un număr de telefon direct', atoms: [
    { value: 'Kinetoterapie', atomClass: 'service', sourceUrl: 'https://www.bodymovestudio.ro/servicii' },
    { value: 'Bogdan Borsan Kinetoterapeut', atomClass: 'people', sourceUrl: 'https://www.bodymovestudio.ro/echipa' },
    { value: '(max. 4 persoane)', atomClass: 'policy', sourceUrl: 'https://www.bodymovestudio.ro/servicii' },
  ],
  synthesizedFacts: ['un spațiu integrat de sănătate prin mișcare'], founderOwned: ['punem preț pe calitate'],
  proofFacts: [], voiceLines: ['Mișcare, nu performanță.'],
};

describe('assembleLandingMove — adoption gate + strategy conditioning', () => {
  it('FAILS CLOSED with a legible reason when there is no adopted strategy (ctx null)', () => {
    const r = assembleLandingMove(null, ids, now, genId);
    expect(r.status).toBe('blocked');
    if (r.status === 'blocked') {
      expect(r.reason).toBe('no_adopted_strategy');
      expect(r.message).toBe(NO_ADOPTED_STRATEGY_MESSAGE); // a surface can SHOW this, not an empty state
    }
  });

  it('builds a snapshot from the substrate, preserving atomClass for routing', () => {
    const r = assembleLandingMove(CTX, ids, now, genId);
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    const byText = Object.fromEntries(r.snapshot.licensedPropositions.map((p) => [p.text, p]));
    expect(byText['Kinetoterapie']?.atomClass).toBe('service');
    expect(byText['Bogdan Borsan Kinetoterapeut']?.atomClass).toBe('people');
    expect(byText['(max. 4 persoane)']?.atomClass).toBe('policy');
    // synthesized + founder carry no atomClass (general / founder lanes)
    expect(byText['un spațiu integrat de sănătate prin mișcare']?.atomClass).toBeUndefined();
    expect(byText['un spațiu integrat de sănătate prin mișcare']?.source).toBe('business_evidence');
    expect(byText['punem preț pe calitate']?.source).toBe('founder_owned');
  });

  it('conditions the communication job on the ADOPTED strategy (goal + audience), not a generic page', () => {
    const r = assembleLandingMove(CTX, ids, now, genId);
    if (r.status !== 'ready') throw new Error('expected ready');
    expect(r.communicationJob).toContain('activarea canalului B2B medical');
    expect(r.communicationJob).toContain('medici din Cluj');
    expect(r.snapshot.audienceUseContext).toBe('medici din Cluj');
    expect(r.snapshot.ctaFunction).toBe('un număr de telefon direct');
  });
});
