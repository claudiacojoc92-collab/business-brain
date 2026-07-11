import { describe, it, expect } from 'vitest';
import { makeFragment, type EvidenceFragment } from '@bb/domain';
import { assembleRead, type BusinessRead, type RecommendationClaim } from '../../business-model/read-assembler';
import type { StoredRecommendation } from '../../business-model/recommendation-service';
import type { MultiSourceResult } from '../../business-model/recompute';

/**
 * S1-T1 gate — the Business Read assembler COMPOSES existing output (no engine, no LLM). Pure/in-memory.
 * Proves: 6 sections in fixed order; observed/declared/inferred never collapse; provenance retained +
 * fail-closed on dangling ids; S4 always empty; no invented recommendation; determinism; two-founder
 * isolation; and no rank/stakes/priority field anywhere.
 */
const FID = 'founder-A';
const NOW = new Date('2026-07-10T00:00:00Z');

function fixture(founderId = FID) {
  const obsWeb = makeFragment({ founderId, source: 'website', sourceUrl: 'https://a.example', confidenceKind: 'observed', visibility: 'public', payload: { text: 'Calm software for everyone.' }, occurredAt: new Date('2026-06-01T00:00:00Z') });
  const obsUp = makeFragment({ founderId, source: 'upload', sourceUrl: 'upload://doc1', confidenceKind: 'observed', visibility: 'private', payload: { text: 'Internally we target enterprise teams.' } });
  const dec = makeFragment({ founderId, source: 'founder', confidenceKind: 'declared', visibility: 'public', payload: { field: 'direction', text: 'We are enterprise-first.' } });
  const infGap = makeFragment({ founderId, source: 'business-model', confidenceKind: 'inferred', visibility: 'private', payload: { category: 'contradictions', statement: 'Your declared enterprise focus and your calm-for-everyone positioning diverge.' }, derivedFrom: [dec.id, obsWeb.id] });
  const infStrength = makeFragment({ founderId, source: 'business-model', confidenceKind: 'inferred', visibility: 'private', payload: { category: 'hiddenStrengths', statement: 'Client collaboration is an under-marketed moat.' }, derivedFrom: [obsUp.id] });
  const fragments = [obsWeb, obsUp, dec, infGap, infStrength];
  const rec: StoredRecommendation = { claimFragmentId: infStrength.id, threadSignature: null, evidenceBasis: [obsUp.id], assumptions: ['SMB buyers value simplicity'], confidence: 'medium', recommendationText: 'Client collaboration is an under-marketed moat.' };
  const result: MultiSourceResult = { model: {} as never, persisted: 1, deduped: 0, rejected: [{ category: 'blindSpots', statement: 's', reason: 'no evidence chain — rejected (fail closed)' }], observedCount: 2, enginePages: ['https://a.example'], ceilingRejected: [{ statement: 'y', reason: 'external reality may not cite a founder source' }] };
  return { obsWeb, obsUp, dec, infGap, infStrength, fragments, rec, result };
}
const section = (r: BusinessRead, id: string) => r.sections.find((s) => s.id === id)!;

describe('assembleRead — Business Read composition', () => {
  it('emits the 6 sections in the FIXED order S1..S6', () => {
    const { fragments, rec, result } = fixture();
    const r = assembleRead(FID, fragments, [rec], result, NOW);
    expect(r.sections.map((s) => s.id)).toEqual(['what_i_read', 'what_i_observe', 'gaps', 'bets', 'my_read', 'cannot_see']);
    expect(r.founderId).toBe(FID);
    expect(r.assembledAt).toBe(NOW.toISOString());
  });

  it('S1 What I Read — connected observed sources only, with counts + date ranges (no declared/inferred)', () => {
    const { fragments, rec } = fixture();
    const s1 = section(assembleRead(FID, fragments, [rec], undefined, NOW), 'what_i_read');
    expect(s1.manifest!.map((m) => m.source)).toEqual(['website', 'upload']); // NOT 'founder'/'business-model'
    expect(s1.manifest!.find((m) => m.source === 'website')!.itemCount).toBe(1);
    expect(s1.manifest!.find((m) => m.source === 'website')!.earliest).toBe('2026-06-01T00:00:00.000Z');
    expect(s1.empty).toBe(false);
  });

  it('S2 What I Observe — observed fragments ONLY, no inferred leak, each with fragment provenance', () => {
    const { fragments, rec, infGap, infStrength } = fixture();
    const s2 = section(assembleRead(FID, fragments, [rec], undefined, NOW), 'what_i_observe');
    expect(s2.claims!.every((c) => c.epistemicKind === 'observed')).toBe(true);
    expect(s2.claims!.every((c) => c.provenance.fragmentIds.length === 1)).toBe(true);
    const blob = JSON.stringify(s2.claims);
    expect(blob).not.toContain(infGap.payload['statement']);      // no inferred statement leaks in
    expect(blob).not.toContain(infStrength.payload['statement']);
    expect(blob).not.toContain('contradictions');                 // no internal category in S2
  });

  it('S3 Gaps — grounded tensions only (inferred over declared∧observed), category carried, no rank/stakes', () => {
    const { fragments, rec, dec, obsWeb, infGap } = fixture();
    const s3 = section(assembleRead(FID, fragments, [rec], undefined, NOW), 'gaps');
    expect(s3.claims).toHaveLength(1); // only the contradiction spans declared+observed; hiddenStrengths is NOT a gap
    const g = s3.claims![0]!;
    expect(g.epistemicKind).toBe('inferred');
    expect(g.internalCategory).toBe('contradictions');            // frozen enum carried for traceability
    expect(g.statement).toBe(infGap.payload['statement']);        // engine verbatim
    expect(g.provenance.declaredFragmentIds).toEqual([dec.id]);
    expect(g.provenance.observedFragmentIds).toEqual([obsWeb.id]);
  });

  it('S4 Bets — ALWAYS empty, no claims, regardless of input', () => {
    const { fragments, rec, result } = fixture();
    const reads: BusinessRead[] = [
      assembleRead(FID, fragments, [rec], result, NOW),
      assembleRead(FID, fragments, [rec], undefined, NOW),
      assembleRead(FID, [], [], undefined, NOW),
    ];
    for (const r of reads) {
      const s4 = section(r, 'bets');
      expect(s4.empty).toBe(true);
      expect(s4.claims).toEqual([]);
    }
  });

  it('S5 My Read — exactly the stored recommendations (nothing invented), truthStatus inferred + full disclosure', () => {
    const { fragments, rec } = fixture();
    const s5 = section(assembleRead(FID, fragments, [rec], undefined, NOW), 'my_read');
    expect(s5.claims).toHaveLength(1); // == the one stored recommendation, no more
    const c = s5.claims![0] as RecommendationClaim;
    expect(c.epistemicKind).toBe('inferred');
    expect(c.disclosure.truthStatus).toBe('inferred');
    expect(c.disclosure.assumptions).toEqual(['SMB buyers value simplicity']);
    expect(c.receipts!.map((r) => r.fragmentId)).toEqual([fixture().obsUp.id]); // S1-T2: real receipts carry the basis
    expect(c.receipts![0]!.text).toBe(fixture().obsUp.payload['text']);         // full verbatim, not a sliced quote
    // no recommendation invented: zero stored → empty S5
    expect(section(assembleRead(FID, fragments, [], undefined, NOW), 'my_read').empty).toBe(true);
  });

  it('S6 Cannot See — absent observed sources + (with result) engine rejects/ceiling; instrument limits', () => {
    const { fragments, rec, result } = fixture();
    const s6 = section(assembleRead(FID, fragments, [rec], result, NOW), 'cannot_see');
    const kinds = s6.limits!.map((l) => l.kind);
    expect(s6.limits!.filter((l) => l.kind === 'absent_source').map((l) => l.source)).toEqual(['google', 'google-calendar']); // website+upload present
    expect(kinds).toContain('engine_rejected');
    expect(kinds).toContain('ceiling');
    // without a result → degrades to absent-source coverage only
    const s6NoResult = section(assembleRead(FID, fragments, [rec], undefined, NOW), 'cannot_see');
    expect(s6NoResult.limits!.every((l) => l.kind === 'absent_source')).toBe(true);
  });

  it('fail-closed: a Gap whose provenance ids do not resolve is DROPPED (never rendered as grounded)', () => {
    const { obsWeb, obsUp, dec } = fixture();
    // an inferred tension citing a declared id that is NOT in the fragment set → unresolvable → dropped
    const dangling = makeFragment({ founderId: FID, source: 'business-model', confidenceKind: 'inferred', visibility: 'private', payload: { category: 'contradictions', statement: 'dangling' }, derivedFrom: ['missing-declared-id', obsWeb.id] });
    const frags = [obsWeb, obsUp, dec, dangling]; // dangling's declared side ('missing-declared-id') absent
    const s3 = section(assembleRead(FID, frags, [], undefined, NOW), 'gaps');
    expect(s3.claims).toHaveLength(0);
    expect(s3.empty).toBe(true);
  });

  it('empty input → every section empty/fail-closed (no fabrication)', () => {
    const r = assembleRead(FID, [], [], undefined, NOW);
    expect(section(r, 'what_i_read').empty).toBe(true);
    expect(section(r, 'what_i_observe').empty).toBe(true);
    expect(section(r, 'gaps').empty).toBe(true);
    expect(section(r, 'bets').empty).toBe(true);
    expect(section(r, 'my_read').empty).toBe(true);
    // no evidence + no result → all four observed sources absent
    expect(section(r, 'cannot_see').limits!.map((l) => l.source)).toEqual(['website', 'upload', 'google', 'google-calendar']);
  });

  it('deterministic — identical inputs produce a deep-equal Read', () => {
    const { fragments, rec, result } = fixture();
    const a = assembleRead(FID, fragments, [rec], result, NOW);
    const b = assembleRead(FID, fragments, [rec], result, NOW);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('two-founder isolation — A’s fragments never appear in B’s Read', () => {
    const a = fixture('founder-A');
    const b = fixture('founder-B');
    // Even given the UNION of both founders' fragments, A's Read composes only A's data (ids include
    // founderId, so B's fragments have distinct ids that must never appear in A's Read).
    const rA = assembleRead('founder-A', [...a.fragments, ...b.fragments], [a.rec], undefined, NOW);
    const blob = JSON.stringify(rA);
    for (const f of b.fragments) expect(blob, `B fragment ${f.id} must not appear in A's Read`).not.toContain(f.id);
    // A's own content is present and its gap still resolves
    expect(section(rA, 'gaps').claims).toHaveLength(1);
    expect(section(rA, 'what_i_read').manifest!.length).toBeGreaterThan(0);
  });

  it('the BusinessRead shape carries NO rank/stakes/priority field (attention-direction forbidden)', () => {
    const { fragments, rec, result } = fixture();
    const blob = JSON.stringify(assembleRead(FID, fragments, [rec], result, NOW));
    for (const forbidden of ['"rank"', '"stakes"', '"priority"', '"severity"', '"importance"']) {
      expect(blob).not.toContain(forbidden);
    }
  });
});
