import { describe, it, expect } from 'vitest';
import { assertFragmentHonest, makeFragment, type EvidenceFragment, type IEvidenceRepository } from '@bb/domain';
import { runDeclaredMagicMoment } from '../../business-model/declared-magic-moment.service';
import { captureDeclared } from '../../business-model/declared';
import { buildDeclaredLines, buildGoogleObservedLines } from '../../business-model/reflection';

/**
 * Capability B Phase 2/3 (structural, no LLM). The live LLM-generated declared-vs-observed gap is
 * the Phase-4 manual gate; here we prove the honesty-critical wiring: declared is attributed AS
 * declared ("you told me"), observed AS observed, and the two never collapse into each other.
 */
const FID = 'dev-founder';

class GateRepo implements IEvidenceRepository {
  store = new Map<string, EvidenceFragment>();
  async append(f: EvidenceFragment) { assertFragmentHonest({ confidenceKind: f.confidenceKind, sourceUrl: f.sourceUrl, derivedFrom: f.derivedFrom, source: f.source }); const isNew = !this.store.has(f.id); this.store.set(f.id, f); return { stored: isNew }; }
  async appendMany(fs: EvidenceFragment[]) { let s = 0; for (const f of fs) if ((await this.append(f)).stored) s++; return { stored: s, deduped: fs.length - s }; }
  async findByFounder(fid: string) { return [...this.store.values()].filter((f) => f.founderId === fid); }
  async findObserved(fid: string, source?: string) { return [...this.store.values()].filter((f) => f.founderId === fid && f.confidenceKind === 'observed' && (source ? f.source === source : true)); }
  async deleteBySource(fid: string, source: string) { for (const [id, f] of this.store) if (f.founderId === fid && f.source === source) this.store.delete(id); }
}

describe('runDeclaredMagicMoment — declared capture + attribution (Phase 2/3)', () => {
  it('no answers → honest empty state, no synthesis (no LLM call)', async () => {
    const r = await runDeclaredMagicMoment({ founderId: FID, answers: [], repo: new GateRepo(), anthropicApiKey: 'unused' });
    expect(r.state).toBe('empty');
    expect(r.beat1.declaredLines).toHaveLength(0);
    expect(r.timing.recomputeMs).toBe(0); // never reached Beat 2
    expect(r.beat1.message).toMatch(/didn't catch/i);
  });

  it('Beat 1: declared renders as DECLARED ("you told me"), observed as OBSERVED — distinct, no collapse', async () => {
    const repo = new GateRepo();
    // what we PERCEIVED (a google observed fragment)
    await repo.append(makeFragment({
      founderId: FID, source: 'google', platform: null, sourceUrl: 'google://f1/Roadmap#document',
      confidenceKind: 'observed', visibility: 'private', occurredAt: null,
      payload: { text: 'Our roadmap prioritizes enterprise SSO and audit logs for large teams.', sourceDocument: { fileId: 'f1', filename: 'Roadmap' }, anchor: { kind: 'document', label: 'Roadmap' } },
    }));
    // what the founder TOLD us
    await captureDeclared(FID, [
      { field: 'direction', text: 'We are building the simplest tool for solo founders who hate enterprise bloat.' },
      { field: 'target', text: 'Solo founders and two-person teams — never the enterprise.' },
    ], repo);

    const all = await repo.findByFounder(FID);
    const declaredLines = buildDeclaredLines(all.filter((f) => f.confidenceKind === 'declared'));
    const observedLines = buildGoogleObservedLines(all.filter((f) => f.confidenceKind === 'observed'));

    expect(declaredLines.length).toBeGreaterThan(0);
    expect(observedLines.length).toBeGreaterThan(0);
    // declared attributed AS declared
    expect(declaredLines.every((l) => l.kind === 'declared')).toBe(true);
    expect(declaredLines.every((l) => l.text.startsWith('You told me:'))).toBe(true);
    expect(declaredLines.some((l) => /your business is|your website says/i.test(l.text))).toBe(false);
    // observed attributed AS observed
    expect(observedLines.every((l) => l.kind === 'observed')).toBe(true);
    // NO COLLAPSE: kinds disjoint, fragment ids disjoint
    expect(declaredLines.some((l) => l.kind === 'observed')).toBe(false);
    expect(observedLines.some((l) => l.kind === 'declared')).toBe(false);
    const dIds = new Set(declaredLines.flatMap((l) => l.fragmentIds));
    const oIds = new Set(observedLines.flatMap((l) => l.fragmentIds));
    expect([...dIds].some((id) => oIds.has(id))).toBe(false);
  });
});
