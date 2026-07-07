import { describe, it, expect } from 'vitest';
import { makeFragment, type EvidenceFragment } from '@bb/domain';
import { DECLARED_PATTERN, type BusinessModel } from '@bb/business-model-engine';
import { resolveDerivedFrom } from '../../business-model/recompute';
import { buildDecisionFragments, decisionUri, decisionsByTension } from '../../business-model/decision';

/**
 * Business Memory v1 §GATE — DECISIONS ride the declared pipeline, fail closed. A decision is an
 * explicit founder commitment captured as `declared`/`founder` evidence (never observed, never
 * inferred), attributed by the FROZEN engine's DECLARED_PATTERN, tied to the tension it answers, and
 * re-entering the SAME recompute. No explicit commitment → nothing (no inferred decisions).
 */
const FID = 'f1';
const TID = 'tension-123';

describe('Memory v1 §gate — decision = declared founder commitment, fail closed', () => {
  it('a decision becomes a DECLARED fragment (B’s shape), grounded to its tension, through the gate', () => {
    const frags = buildDecisionFragments(FID, { tensionId: TID, tensionStatement: 'Excellence-first vs small-team simplicity.', commitment: 'Commit to the enterprise segment and reprice by Q3.' });
    expect(frags).toHaveLength(2); // unit + block (resolvable)
    for (const f of frags) {
      expect(f.confidenceKind).toBe('declared');  // declared — NEVER observed, NEVER inferred
      expect(f.source).toBe('founder');
      expect(f.sourceUrl).toBe(decisionUri(TID));
      expect(f.visibility).toBe('private');
    }
    const unit = frags[0]!;
    expect(unit.payload['decidesOn']).toBe(TID);                          // provenance → the exact tension
    expect(unit.payload['commitment']).toBe('Commit to the enterprise segment and reprice by Q3.');
    expect(String(unit.payload['text'])).toContain('Excellence-first vs small-team simplicity.'); // quotes tension as context
    expect(String(unit.payload['text'])).toMatch(/I have decided/);
    expect(frags[1]!.payload['blockType']).toBe('decision');
    expect(DECLARED_PATTERN.test(decisionUri(TID))).toBe(true);           // frozen engine attributes it declared
  });

  it('FAIL CLOSED: missing founder / tension / statement / commitment → no decision (never inferred)', () => {
    const base = { tensionId: TID, tensionStatement: 'x', commitment: 'y' };
    expect(buildDecisionFragments('', base)).toHaveLength(0);
    expect(buildDecisionFragments(FID, { ...base, tensionId: '' })).toHaveLength(0);
    expect(buildDecisionFragments(FID, { ...base, tensionStatement: '   ' })).toHaveLength(0);
    expect(buildDecisionFragments(FID, { ...base, commitment: '  ' })).toHaveLength(0);
  });

  it('RE-ENTERS recompute: a future inferred claim citing the decision resolves fail-closed (declared evidence)', () => {
    const frags = buildDecisionFragments(FID, { tensionId: TID, tensionStatement: 'Excellence-first vs small-team simplicity.', commitment: 'Commit to the enterprise segment and reprice by Q3.' });
    const stored = [...frags];
    const uri = decisionUri(TID);
    const model = { blindSpots: [{ statement: 'The founder has now committed to enterprise.', contributingFields: [], evidenceChain: [{ source: uri, fragment: 'Commit to the enterprise segment and reprice by Q3' }], confidenceKind: 'inferred' }] } as unknown as BusinessModel;
    const { toPersist, rejected } = resolveDerivedFrom(FID, model, stored);
    expect(rejected).toHaveLength(0);
    expect(toPersist).toHaveLength(1);
    const byId = new Map<string, EvidenceFragment>(stored.map((f) => [f.id, f]));
    const derived = (toPersist[0]!.derivedFrom ?? []).map((id) => byId.get(id)).filter(Boolean);
    expect(derived.some((f) => f!.source === 'founder' && f!.confidenceKind === 'declared' && f!.payload?.['blockType'] === 'decision')).toBe(true);
  });

  it('decisionsByTension maps the tension → the founder’s commitment (units only)', () => {
    const frags = buildDecisionFragments(FID, { tensionId: TID, tensionStatement: 'stmt', commitment: 'Focus enterprise.' });
    const m = decisionsByTension(frags);
    expect(m.get(TID)?.commitment).toBe('Focus enterprise.');
    expect(m.size).toBe(1); // the block fragment is not counted
  });
});
