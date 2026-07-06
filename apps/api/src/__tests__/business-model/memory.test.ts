import { describe, it, expect } from 'vitest';
import { makeFragment, type EvidenceFragment } from '@bb/domain';
import { DECLARED_PATTERN, type BusinessModel } from '@bb/business-model-engine';
import { resolveDerivedFrom } from '../../business-model/recompute';
import { buildWhatMattersNow } from '../../business-model/what-matters';
import {
  buildResponseFragments, responseUri, responsesByTension, applyResponses,
} from '../../business-model/memory';

/**
 * Business Memory v1 §GATE — a founder RESPONSE to a C tension becomes `declared` evidence, grounds
 * to the tension it answers, persists through the UNCHANGED gate (fail closed), re-enters recompute
 * as declared, and closes the loop (the next reflection reflects the response). If a response could
 * render without grounding to its tension, or drifted attribution to observed, Memory would corrupt
 * honesty — these forbid both.
 */
const FID = 'f1';
const declared = (field: string, text: string) => makeFragment({ founderId: FID, source: 'founder', platform: null, sourceUrl: `conversation://declared/${field}`, confidenceKind: 'declared', visibility: 'private', occurredAt: null, payload: { text, field } });
const observed = (text: string, url = 'https://acme.co/') => makeFragment({ founderId: FID, source: 'website', platform: null, sourceUrl: url, confidenceKind: 'observed', visibility: 'public', occurredAt: null, payload: { text } });
const inferred = (category: string, statement: string, derivedFrom: string[]) => makeFragment({ founderId: FID, source: 'business-model', platform: null, sourceUrl: null, confidenceKind: 'inferred', visibility: 'founder_only', derivedFrom, payload: { category, statement } });

const dDir = declared('direction', 'Product excellence is our number-one priority this year.');
const dSucc = declared('success', 'Forty percent enterprise revenue within a year.');
const oWeb = observed('Calm simple project management for small teams.');
const oWeb2 = observed('Flat-rate pricing, twenty users, forever free.', 'https://acme.co/pricing');
const cTension = inferred('contradictions', 'Your declared product-excellence priority contradicts your observed small-team positioning.', [dDir.id, oWeb.id]);
const bTension = inferred('blindSpots', 'Your success target ignores that your observed pricing self-selects against enterprise.', [dSucc.id, oWeb2.id]);
const all: EvidenceFragment[] = [dDir, dSucc, oWeb, oWeb2, cTension, bTension];
const items = buildWhatMattersNow([cTension, bTension], all); // rank1 contradiction, rank2 blindSpot

describe('Memory v1 §gate — response → declared, grounded, fail-closed, closes the loop', () => {
  it('a response becomes a DECLARED fragment (B’s shape), grounded to the tension, through the gate', () => {
    const frags = buildResponseFragments(FID, { tensionId: items[0]!.tensionId, tensionStatement: items[0]!.statement, choice: 'handled', text: 'We repriced for enterprise last month.' });
    expect(frags).toHaveLength(2); // unit + block (resolvable)
    for (const f of frags) {
      expect(f.confidenceKind).toBe('declared');   // declared — NEVER observed
      expect(f.source).toBe('founder');
      expect(f.sourceUrl).toBe(responseUri(items[0]!.tensionId));
      expect(f.visibility).toBe('private');
    }
    const unit = frags[0]!;
    expect(unit.payload['respondsTo']).toBe(items[0]!.tensionId); // provenance → the exact tension
    expect(unit.payload['choice']).toBe('handled');
    expect(String(unit.payload['text'])).toContain(items[0]!.statement); // quotes the tension as context
    expect(String(unit.payload['text'])).toMatch(/already handled/);
    expect(DECLARED_PATTERN.test(responseUri(items[0]!.tensionId))).toBe(true); // frozen engine attributes it declared
  });

  it('FAIL CLOSED: no tension id / no statement / no founder → no response fragment', () => {
    expect(buildResponseFragments(FID, { tensionId: '', tensionStatement: 'x', choice: 'matters' })).toHaveLength(0);
    expect(buildResponseFragments(FID, { tensionId: 't', tensionStatement: '   ', choice: 'matters' })).toHaveLength(0);
    expect(buildResponseFragments('', { tensionId: 't', tensionStatement: 'x', choice: 'matters' })).toHaveLength(0);
  });

  it('RE-ENTERS recompute: a future inferred claim citing the response resolves fail-closed (declared evidence)', () => {
    const frags = buildResponseFragments(FID, { tensionId: items[0]!.tensionId, tensionStatement: items[0]!.statement, choice: 'context', text: 'Enterprise is a deliberate near-term bet.' });
    const stored = [...all, ...frags];
    const uri = responseUri(items[0]!.tensionId);
    const model = { blindSpots: [{ statement: 'The founder now frames enterprise as a deliberate bet.', contributingFields: [], evidenceChain: [{ source: uri, fragment: 'Enterprise is a deliberate near-term bet' }], confidenceKind: 'inferred' }] } as unknown as BusinessModel;
    const { toPersist, rejected } = resolveDerivedFrom(FID, model, stored);
    expect(rejected).toHaveLength(0);
    expect(toPersist).toHaveLength(1);
    const byId = new Map(stored.map((f) => [f.id, f]));
    const derived = (toPersist[0]!.derivedFrom ?? []).map((id) => byId.get(id)).filter(Boolean);
    expect(derived.some((f) => f!.source === 'founder' && f!.confidenceKind === 'declared' && f!.payload?.['blockType'] === 'response')).toBe(true);
  });

  it('CLOSES THE LOOP: a "handled" response deprioritizes its tension — the next reflection differs', () => {
    expect(items.map((i) => i.category)).toEqual(['contradictions', 'blindSpots']); // before: contradiction rank 1
    const resp = buildResponseFragments(FID, { tensionId: items[0]!.tensionId, tensionStatement: items[0]!.statement, choice: 'handled', text: 'done' });
    const byTension = responsesByTension([...all, ...resp]);
    expect(byTension.get(items[0]!.tensionId)?.choice).toBe('handled');
    const after = applyResponses(items, byTension);
    expect(after[0]!.category).toBe('blindSpots'); // the handled contradiction dropped; blindSpot is now rank 1
    expect(after[0]!.rank).toBe(1);
    const handled = after.find((i) => i.category === 'contradictions')!;
    expect(handled.rank).toBe(2);
    expect(handled.response?.choice).toBe('handled'); // annotated with the founder's response
  });

  it('attribution held: the item STATEMENT stays the engine’s verbatim (response is separate, never a rewrite)', () => {
    const resp = buildResponseFragments(FID, { tensionId: items[0]!.tensionId, tensionStatement: items[0]!.statement, choice: 'matters' });
    const after = applyResponses(items, responsesByTension([...all, ...resp]));
    const it0 = after.find((i) => i.tensionId === items[0]!.tensionId)!;
    expect(it0.statement).toBe(items[0]!.statement); // C's tension text unchanged
    expect(it0.response?.choice).toBe('matters');
  });
});
