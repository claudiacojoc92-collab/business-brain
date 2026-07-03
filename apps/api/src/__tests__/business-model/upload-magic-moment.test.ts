import { describe, it, expect } from 'vitest';
import { makeFragment, assertFragmentHonest, type EvidenceFragment, type IEvidenceRepository } from '@bb/domain';
import { runUploadMagicMoment } from '../../business-model/upload-magic-moment.service';

// In-mem store that re-asserts the unchanged honesty gate on append.
class GateRepo implements IEvidenceRepository {
  store = new Map<string, EvidenceFragment>();
  async append(f: EvidenceFragment) { assertFragmentHonest({ confidenceKind: f.confidenceKind, sourceUrl: f.sourceUrl, derivedFrom: f.derivedFrom, source: f.source }); const isNew = !this.store.has(f.id); this.store.set(f.id, f); return { stored: isNew }; }
  async appendMany(fs: EvidenceFragment[]) { let s = 0; for (const f of fs) if ((await this.append(f)).stored) s++; return { stored: s, deduped: fs.length - s }; }
  async findByFounder(fid: string) { return [...this.store.values()].filter((f) => f.founderId === fid); }
  async findObserved(fid: string, source?: string) { return [...this.store.values()].filter((f) => f.founderId === fid && f.confidenceKind === 'observed' && (source ? f.source === source : true)); }
  async deleteBySource(fid: string, source: string) { for (const [id, f] of this.store) if (f.founderId === fid && f.source === source) this.store.delete(id); }
}
const FID = 'f1';
const KEY = 'unused-in-these-tests'; // non-reflective paths never call the engine

describe('runUploadMagicMoment — honest non-synced states (no synthesis, no LLM)', () => {
  it('unsupported binary → unsupported state, honest message, no beats, no synthesis', async () => {
    const r = await runUploadMagicMoment({ founderId: FID, input: { founderId: FID, filename: 'x.bin', bytes: Buffer.from([0, 1, 2, 255]) }, repo: new GateRepo(), anthropicApiKey: KEY });
    expect(r.state).toBe('unsupported');
    expect(r.beat1.message).toMatch(/can't read this type/i);
    expect(r.beat1.uploadLines).toHaveLength(0);
    expect(r.inferredLines).toHaveLength(0);
    expect(r.timing.recomputeMs).toBe(0);
  });

  it('empty file → empty state, honest message', async () => {
    const r = await runUploadMagicMoment({ founderId: FID, input: { founderId: FID, filename: 'blank.txt', bytes: Buffer.from('   \n  ') }, repo: new GateRepo(), anthropicApiKey: KEY });
    expect(r.state).toBe('empty');
    expect(r.beat1.message).toMatch(/couldn't find much/i);
  });

  it('retyped-website upload → redundant state, no new evidence, honest message', async () => {
    const repo = new GateRepo();
    const site = 'It is the calm, organized way to manage projects, work with clients, and communicate company-wide.';
    const wf = makeFragment({ founderId: FID, source: 'website', sourceUrl: 'https://acme.co/', confidenceKind: 'observed', visibility: 'public', payload: { text: site } });
    repo.store.set(wf.id, wf);
    const before = repo.store.size;
    const r = await runUploadMagicMoment({ founderId: FID, input: { founderId: FID, filename: 'about.txt', bytes: Buffer.from(site) }, repo, anthropicApiKey: KEY });
    expect(r.state).toBe('redundant');
    expect(r.beat1.message).toMatch(/already read/i);
    expect(repo.store.size).toBe(before); // nothing new stored (no double-count)
  });
});
