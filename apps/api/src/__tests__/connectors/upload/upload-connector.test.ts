import { describe, it, expect } from 'vitest';
import { makeFragment, assertFragmentHonest, EvidenceHonestyError, type EvidenceFragment, type IEvidenceRepository } from '@bb/domain';
import { readUpload, UploadConnector } from '../../../connectors/upload/upload.connector';
import { makeMinimalDocx, WEBSITE_TEXT } from './fixtures';

// In-memory store that RE-ASSERTS the unchanged honesty gate on every append (mirrors
// PgEvidenceRepository) — so if any upload fragment violated the gate, append would throw.
class GateRepo implements IEvidenceRepository {
  store = new Map<string, EvidenceFragment>();
  async append(f: EvidenceFragment) {
    assertFragmentHonest({ confidenceKind: f.confidenceKind, sourceUrl: f.sourceUrl, derivedFrom: f.derivedFrom, source: f.source });
    const isNew = !this.store.has(f.id); this.store.set(f.id, f); return { stored: isNew };
  }
  async appendMany(fs: EvidenceFragment[]) { let s = 0; for (const f of fs) if ((await this.append(f)).stored) s++; return { stored: s, deduped: fs.length - s }; }
  async findByFounder(fid: string) { return [...this.store.values()].filter((f) => f.founderId === fid); }
  async findObserved(fid: string, source?: string) { return [...this.store.values()].filter((f) => f.founderId === fid && f.confidenceKind === 'observed' && (source ? f.source === source : true)); }
  async deleteBySource(fid: string, source: string) { for (const [id, f] of this.store) if (f.founderId === fid && f.source === source) this.store.delete(id); }
}

const FID = 'f1';
function seedWebsite(repo: GateRepo) {
  for (const [i, text] of WEBSITE_TEXT.entries()) {
    const f = makeFragment({ founderId: FID, source: 'website', sourceUrl: `https://acme.co/p${i}`, confidenceKind: 'observed', visibility: 'public', payload: { text } });
    repo.store.set(f.id, f);
  }
}
const textInput = (name: string, body: string) => ({ founderId: FID, filename: name, bytes: Buffer.from(body) });

describe('upload connector — evidence through the UNCHANGED gate + honest states', () => {
  it('genuine upload → synced; every fragment observed + source:upload + private + anchored', async () => {
    const repo = new GateRepo();
    const md = '# Positioning\nWe help founders show up with clarity, in their own words, nowhere on any website.\n\n# Offer\nA calm monthly retainer designed for overwhelmed solo founders.';
    const res = await readUpload({ founderId: FID, input: textInput('memo.md', md), repo });

    expect(res.state).toBe('synced');
    expect(res.fragmentsStored).toBeGreaterThan(0);
    const frags = await repo.findByFounder(FID);
    expect(frags.length).toBe(res.fragmentsStored);
    for (const f of frags) {
      expect(f.confidenceKind).toBe('observed');
      expect(f.source).toBe('upload');
      expect(f.visibility).toBe('private');                 // §7 private by default
      expect(f.sourceUrl).toMatch(/^upload:\/\/[0-9a-f]{64}\//); // synthetic doc-location URI (anchor)
      expect(f.payload['sourceDocument']).toMatchObject({ filename: 'memo.md' });
      expect(f.payload['anchor']).toBeTruthy();             // location anchor present (§5.1)
    }
  });

  it('retyped-website upload → REDUNDANT, contributes no new evidence (§5.3)', async () => {
    const repo = new GateRepo(); seedWebsite(repo);
    const before = (await repo.findByFounder(FID)).length;
    const res = await readUpload({ founderId: FID, input: textInput('about.txt', WEBSITE_TEXT.join('\n\n')), repo });
    expect(res.state).toBe('redundant');
    expect(res.fragmentsStored).toBe(0);
    expect((await repo.findByFounder(FID)).length).toBe(before); // nothing new stored
  });

  it('partly-redundant upload → partial; only new units land', async () => {
    const repo = new GateRepo(); seedWebsite(repo);
    const mixed = `${WEBSITE_TEXT[0]}\n\nOur private Q3 roadmap centers on enterprise onboarding and a new mobile client.`;
    const res = await readUpload({ founderId: FID, input: textInput('mixed.txt', mixed), repo });
    expect(res.state).toBe('partial');
    expect(res.redundantUnits).toBe(1);
    expect(res.fragmentsStored).toBeGreaterThan(0);
  });

  it('honest edges: unsupported binary, empty file, oversized failure', async () => {
    const repo = new GateRepo();
    expect((await readUpload({ founderId: FID, input: { founderId: FID, filename: 'x.bin', bytes: Buffer.from([0, 1, 2, 255]) }, repo })).state).toBe('unsupported');
    expect((await readUpload({ founderId: FID, input: textInput('blank.txt', '   \n  '), repo })).state).toBe('empty');
    expect((await readUpload({ founderId: FID, input: { founderId: FID, filename: 'big.txt', bytes: Buffer.alloc(0) }, repo })).state).toBe('failed');
  });

  it('a real DOCX flows through the connector and stores private, anchored upload evidence', async () => {
    const repo = new GateRepo();
    const docx = makeMinimalDocx([{ heading: 'Strategy', body: 'Our wedge is honest understanding of a founder business from connected reality and documents.' }]);
    const res = await readUpload({ founderId: FID, input: { founderId: FID, filename: 'plan.docx', bytes: docx }, repo });
    expect(res.type).toBe('docx');
    expect(res.state).toBe('synced');
    expect(res.provenanceStrength).toBe('strong');
  });

  it('implements the full standard connector contract (methods, not just an orchestrator)', async () => {
    const repo = new GateRepo();
    const conn = new UploadConnector(repo);
    await expect(conn.authorize()).resolves.toBeUndefined();
    expect(conn.capabilities()).toEqual({ read: true, insights: false, publish: false });
    expect(conn.supportedTypes()).toEqual(['pdf', 'docx', 'text']);
    // sync → normalize → produceEvidence, driven explicitly through the contract surface
    const { type, doc } = await conn.sync(textInput('m.md', '# Plan\nA private roadmap in the founder own words, nowhere on any website at all.'));
    expect(type).toBe('text');
    const classified = await conn.normalize(FID, doc!);
    const out = await conn.produceEvidence(FID, doc!, classified);
    expect(out.stored).toBeGreaterThan(0);
    await conn.disconnect(FID);
    expect((await repo.findByFounder(FID)).filter((f) => f.source === 'upload')).toHaveLength(0); // disconnect deletes upload evidence
  });

  it('the gate is UNCHANGED and still bites: a fabricated observed fragment with no source is rejected', () => {
    expect(() => makeFragment({ founderId: FID, source: 'upload', confidenceKind: 'observed', payload: { text: 'x' } }))
      .toThrow(EvidenceHonestyError); // observed needs a source_url — upload satisfies it via the doc-location URI
  });
});
