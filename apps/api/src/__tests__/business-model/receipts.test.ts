import { describe, it, expect } from 'vitest';
import { makeFragment, type EvidenceFragment } from '@bb/domain';
import { resolveReceipts, type Receipt } from '../../business-model/receipts';
import { assembleRead, type BusinessRead, type RecommendationClaim } from '../../business-model/read-assembler';
import type { StoredRecommendation } from '../../business-model/recommendation-service';

/**
 * S1-T2 gate — Receipt resolution (Article VII). Every founder-visible grounded claim resolves to REAL
 * stored evidence: verbatim payload.text + source metadata, never interpretation/paraphrase. Fail closed —
 * no real receipt → no grounded claim. Pure/in-memory (fixtures = stored fragments, no engine, no LLM).
 */
const FID = 'founder-A';
const NOW = new Date('2026-07-10T00:00:00Z');
const byId = (fs: EvidenceFragment[]) => new Map(fs.map((f) => [f.id, f]));

const obs = (over: Partial<Parameters<typeof makeFragment>[0]> = {}) =>
  makeFragment({ founderId: FID, source: 'website', sourceUrl: 'https://a.example/pricing', confidenceKind: 'observed', visibility: 'public', payload: { text: 'Calm software for everyone.' }, ...over });
const dec = (over: Partial<Parameters<typeof makeFragment>[0]> = {}) =>
  makeFragment({ founderId: FID, source: 'founder', sourceUrl: 'conversation://declared/direction', confidenceKind: 'declared', visibility: 'public', payload: { field: 'direction', label: 'Direction', text: 'We are enterprise-first.' }, ...over });
const inf = (derivedFrom: string[], over: Partial<Parameters<typeof makeFragment>[0]> = {}) =>
  makeFragment({ founderId: FID, source: 'business-model', confidenceKind: 'inferred', visibility: 'private', payload: { category: 'contradictions', statement: 'A tension.' }, derivedFrom, ...over });

// ── resolveReceipts — the shared fail-closed resolver ─────────────────────────────────────────
describe('resolveReceipts', () => {
  it('receipt.text is the FULL verbatim payload.text — NO slice, NO paraphrase', () => {
    const long = 'X'.repeat(400) + ' — the whole thing, verbatim.';
    const f = obs({ payload: { text: long } });
    const [r] = resolveReceipts([f.id], byId([f]), 'observed');
    expect(r!.text).toBe(long);       // exact equality — not sliced to 140, not rewritten
    expect(r!.text.length).toBe(long.length);
  });

  it('resolves observed + declared metadata (sourceType, label, url safety, kind)', () => {
    const web = obs();
    const doc = obs({ source: 'upload', sourceUrl: 'upload://doc1', payload: { text: 'Internal note.', sourceDocument: { filename: 'strategy.pdf' } } });
    const d = dec();
    const m = byId([web, doc, d]);
    const [rw] = resolveReceipts([web.id], m, 'observed');
    expect(rw).toMatchObject({ epistemicKind: 'observed', sourceType: 'website', sourceLabel: 'a.example', sourceUrl: 'https://a.example/pricing' });
    const [rd] = resolveReceipts([doc.id], m, 'observed');
    expect(rd).toMatchObject({ sourceType: 'upload', sourceLabel: 'strategy.pdf' });
    expect(rd!.sourceUrl).toBeUndefined();            // opaque upload:// locator is NOT exposed as a URL
    const [rdec] = resolveReceipts([d.id], m, 'declared');
    expect(rdec).toMatchObject({ epistemicKind: 'declared', sourceType: 'founder', sourceLabel: 'Direction' });
    expect(rdec!.sourceUrl).toBeUndefined();          // conversation:// is internal plumbing, omitted
  });

  it('FAIL CLOSED — drops missing ids, wrong-kind ids, and empty-text ids', () => {
    const web = obs();
    const d = dec();
    const empty = obs({ payload: { text: '' } });
    const m = byId([web, d, empty]);
    expect(resolveReceipts(['no-such-id'], m, 'observed')).toEqual([]);        // (a) not in byId
    expect(resolveReceipts([d.id], m, 'observed')).toEqual([]);                // (b) wrong kind (declared asked as observed)
    expect(resolveReceipts([web.id], m, 'declared')).toEqual([]);             // (b) wrong kind (observed asked as declared)
    expect(resolveReceipts([empty.id], m, 'observed')).toEqual([]);           // (c) empty verbatim text
  });

  it('NEVER produces a receipt from an inferred fragment (pure evidence)', () => {
    const web = obs();
    const t = inf([web.id], { payload: { category: 'contradictions', statement: 'inferred text', text: 'inferred text' } });
    const m = byId([web, t]);
    // even with NO requireKind and even though the inferred fragment carries a payload.text, it is barred
    expect(resolveReceipts([t.id], m)).toEqual([]);
    // the Receipt type itself makes 'inferred' unrepresentable — epistemicKind is only 'observed' | 'declared'
  });

  it('dedupes — a repeated id resolves once', () => {
    const web = obs();
    const r = resolveReceipts([web.id, web.id, web.id], byId([web]), 'observed');
    expect(r).toHaveLength(1);
  });

  it('preserves PROVENANCE order (input id order), deterministic', () => {
    const a = obs({ payload: { text: 'first' } });
    const b = obs({ payload: { text: 'second' } });
    const c = obs({ payload: { text: 'third' } });
    const m = byId([a, b, c]);
    expect(resolveReceipts([c.id, a.id, b.id], m, 'observed').map((r) => r.text)).toEqual(['third', 'first', 'second']);
    // identical input → identical output
    expect(resolveReceipts([c.id, a.id, b.id], m, 'observed')).toEqual(resolveReceipts([c.id, a.id, b.id], m, 'observed'));
  });

  it('is a pure map lookup — takes a byId map, no repo (no N+1)', () => {
    // structural: the resolver's only inputs are ids + an in-memory Map — it cannot issue a per-id query.
    const web = obs();
    const m = byId([web]);
    expect(resolveReceipts([web.id], m, 'observed')).toHaveLength(1);
  });

  it('adversarial isolation — founder A cannot resolve a KNOWN id belonging to founder B', () => {
    const bFragment = makeFragment({ founderId: 'founder-B', source: 'website', sourceUrl: 'https://b.example', confidenceKind: 'observed', visibility: 'public', payload: { text: "B's private evidence." } });
    const aMap = byId([obs()]); // A's map — built from A's fragments only, exactly as the assembler builds it
    expect(resolveReceipts([bFragment.id], aMap, 'observed')).toEqual([]); // B's id is simply not present
  });
});

// ── assembler integration — receipts attached per section, fail-closed ─────────────────────────
function full(founderId = FID) {
  const obsWeb = obs({ founderId, payload: { text: 'Calm software for everyone.' } });
  const obsUp = obs({ founderId, source: 'upload', sourceUrl: 'upload://doc1', visibility: 'private', payload: { text: 'Internally we target enterprise teams.', sourceDocument: { filename: 'plan.pdf' } } });
  const d = dec({ founderId });
  const infGap = inf([d.id, obsWeb.id], { founderId, payload: { category: 'contradictions', statement: 'Declared enterprise vs calm-for-everyone diverge.' } });
  const infStrength = inf([obsUp.id], { founderId, payload: { category: 'hiddenStrengths', statement: 'Collaboration is an under-marketed moat.' } });
  const fragments = [obsWeb, obsUp, d, infGap, infStrength];
  const rec: StoredRecommendation = { claimFragmentId: infStrength.id, threadSignature: null, evidenceBasis: [obsUp.id], assumptions: ['SMB buyers value simplicity'], confidence: 'medium', recommendationText: 'Collaboration is an under-marketed moat.' };
  return { obsWeb, obsUp, d, infGap, infStrength, fragments, rec };
}
const section = (r: BusinessRead, id: string) => r.sections.find((s) => s.id === id)!;

describe('assembleRead — receipts (Article VII integration)', () => {
  it('S2 — every grounded observation carries a REAL observed receipt whose text === payload.text verbatim', () => {
    const { fragments, rec, obsWeb, obsUp } = full();
    const s2 = section(assembleRead(FID, fragments, [rec], undefined, NOW), 'what_i_observe');
    expect(s2.claims!.length).toBeGreaterThan(0);
    for (const c of s2.claims!) {
      expect(c.receipts!.length).toBeGreaterThan(0);
      expect(c.receipts!.every((r) => r.epistemicKind === 'observed')).toBe(true);
    }
    const texts = s2.claims!.flatMap((c) => c.receipts!.map((r) => r.text));
    expect(texts).toContain(obsWeb.payload['text']);   // exact verbatim
    expect(texts).toContain(obsUp.payload['text']);
  });

  it('S2 — fail closed: an observed fragment with empty text produces NO claim (no receipt → no claim)', () => {
    const good = obs({ payload: { text: 'real' } });
    const blank = obs({ source: 'upload', sourceUrl: 'upload://x', payload: { text: '' } });
    const s2 = section(assembleRead(FID, [good, blank], [], undefined, NOW), 'what_i_observe');
    expect(s2.claims!.every((c) => c.receipts!.length > 0)).toBe(true);
    expect(JSON.stringify(s2.claims)).not.toContain(blank.id);
  });

  it('S3 — a Gap carries declared AND observed receipts, resolved SEPARATELY (two distinct groups)', () => {
    const { fragments, rec, d, obsWeb } = full();
    const g = section(assembleRead(FID, fragments, [rec], undefined, NOW), 'gaps').claims![0]!;
    expect(g.declaredReceipts!.map((r) => r.fragmentId)).toEqual([d.id]);
    expect(g.declaredReceipts!.every((r) => r.epistemicKind === 'declared')).toBe(true);
    expect(g.observedReceipts!.map((r) => r.fragmentId)).toEqual([obsWeb.id]);
    expect(g.observedReceipts!.every((r) => r.epistemicKind === 'observed')).toBe(true);
    expect(g.declaredReceipts![0]!.text).toBe(d.payload['text']);       // verbatim, both sides
    expect(g.observedReceipts![0]!.text).toBe(obsWeb.payload['text']);
  });

  it('S3 — a ONE-SIDED gap (declared side has empty text) is DROPPED (not fully grounded)', () => {
    const obsWeb = obs({ payload: { text: 'observed side present' } });
    const dBlank = dec({ payload: { field: 'direction', label: 'Direction', text: '' } }); // declared side has no verbatim text
    const gap = inf([dBlank.id, obsWeb.id], { payload: { category: 'contradictions', statement: 'one-sided' } });
    const s3 = section(assembleRead(FID, [obsWeb, dBlank, gap], [], undefined, NOW), 'gaps');
    expect(s3.claims).toHaveLength(0);
    expect(s3.empty).toBe(true);
  });

  it('S5 — receipts resolve fresh & STRICT; an unresolvable basis id is dropped (never a placeholder)', () => {
    const { fragments, obsUp, infStrength } = full();
    // basis cites a real observed id AND a dangling id — the dangling one must NOT surface as a receipt
    const rec: StoredRecommendation = { claimFragmentId: infStrength.id, threadSignature: null, evidenceBasis: [obsUp.id, 'ghost-id'], assumptions: ['a'], confidence: 'low', recommendationText: 'text' };
    const s5 = section(assembleRead(FID, fragments, [rec], undefined, NOW), 'my_read');
    const c = s5.claims![0] as RecommendationClaim;
    expect(c.receipts!.map((r) => r.fragmentId)).toEqual([obsUp.id]); // only the resolvable id
    const blob = JSON.stringify(s5.claims);
    expect(blob).not.toContain('(evidence not found)');  // the toRecommendationView placeholder never enters the Read as grounded
    expect(blob).not.toContain('ghost-id');
  });

  it('S5 — a recommendation whose basis resolves to ZERO receipts is DROPPED from the Read', () => {
    const { fragments, infStrength } = full();
    const rec: StoredRecommendation = { claimFragmentId: infStrength.id, threadSignature: null, evidenceBasis: ['ghost-only'], assumptions: ['a'], confidence: 'low', recommendationText: 'ungrounded' };
    const s5 = section(assembleRead(FID, fragments, [rec], undefined, NOW), 'my_read');
    expect(s5.claims).toHaveLength(0);
    expect(s5.empty).toBe(true);
  });

  it('no receipt anywhere in the Read is inferred; determinism holds with receipts attached', () => {
    const { fragments, rec } = full();
    const a = assembleRead(FID, fragments, [rec], undefined, NOW);
    const collect = (r: BusinessRead): Receipt[] => r.sections.flatMap((s) => (s.claims ?? []).flatMap((c) => [...(c.receipts ?? []), ...(c.declaredReceipts ?? []), ...(c.observedReceipts ?? [])]));
    const receipts = collect(a);
    expect(receipts.length).toBeGreaterThan(0);
    expect(receipts.every((r) => r.epistemicKind === 'observed' || r.epistemicKind === 'declared')).toBe(true);
    const b = assembleRead(FID, fragments, [rec], undefined, NOW);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('adversarial isolation in the Read — B fragment ids never appear in A receipts', () => {
    const a = full('founder-A');
    const b = full('founder-B');
    const rA = assembleRead('founder-A', [...a.fragments, ...b.fragments], [a.rec], undefined, NOW);
    const blob = JSON.stringify(rA);
    for (const f of b.fragments) expect(blob, `B fragment ${f.id} leaked`).not.toContain(f.id);
  });
});
