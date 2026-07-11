import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createKyselyClient } from '@bb/infrastructure';
import { makeFragment } from '@bb/domain';
import { assembleRead, type BusinessRead } from '../../business-model/read-assembler';
import type { StoredRecommendation } from '../../business-model/recommendation-service';
import { PgBusinessReadRepository, StoredReadError, canonicalize } from '../../business-model/pg-business-read.repository';

/**
 * S1-T3 C1 gate — Business Read persistence (V055). Real DB, NO engine, NO LLM. Fixtures = an assembled
 * receipt-bearing Read from the S1-T1/T2 assembler. Proves: save→reload is deep-equal identical (+ hash);
 * receipts (incl. S3 declared/observed groups) reload verbatim; section order preserved; S4 stays empty;
 * fetch is a pure DB read (the repo imports no engine); two-founder isolation; deterministic ordering;
 * and fail-closed THROWS (never null) on corrupt content or an unknown schema_version. Skip-guarded.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const FID_A = 'persist.a@read.test';
const FID_B = 'persist.b@read.test';
const FIDS = [FID_A, FID_B];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let repo: PgBusinessReadRepository; let dbUp = false;

// Build a real assembled, receipt-bearing Read (S2 observed receipts, S3 declared+observed groups, S5).
function assembled(founderId: string, marker: string): BusinessRead {
  const obsWeb = makeFragment({ founderId, source: 'website', sourceUrl: `https://${marker}.example`, confidenceKind: 'observed', visibility: 'public', payload: { text: `${marker} calm software for everyone` }, occurredAt: new Date('2026-06-01T00:00:00Z') });
  const obsUp = makeFragment({ founderId, source: 'upload', sourceUrl: 'upload://doc1', confidenceKind: 'observed', visibility: 'private', payload: { text: `${marker} internally we target enterprise`, sourceDocument: { filename: `${marker}-plan.pdf` } } });
  const dec = makeFragment({ founderId, source: 'founder', sourceUrl: 'conversation://declared/direction', confidenceKind: 'declared', visibility: 'public', payload: { field: 'direction', label: 'Direction', text: `${marker} we are enterprise-first` } });
  const infGap = makeFragment({ founderId, source: 'business-model', confidenceKind: 'inferred', visibility: 'private', payload: { category: 'contradictions', statement: `${marker} declared enterprise vs calm-for-everyone diverge` }, derivedFrom: [dec.id, obsWeb.id] });
  const infStrength = makeFragment({ founderId, source: 'business-model', confidenceKind: 'inferred', visibility: 'private', payload: { category: 'hiddenStrengths', statement: `${marker} collaboration is an under-marketed moat` }, derivedFrom: [obsUp.id] });
  const rec: StoredRecommendation = { claimFragmentId: infStrength.id, threadSignature: null, evidenceBasis: [obsUp.id], assumptions: ['SMB buyers value simplicity'], confidence: 'medium', recommendationText: `${marker} collaboration is an under-marketed moat` };
  return assembleRead(founderId, [obsWeb, obsUp, dec, infGap, infStrength], [rec], undefined, new Date('2026-07-10T00:00:00Z'));
}
const hashOf = (r: BusinessRead) => createHash('sha256').update(canonicalize(r)).digest('hex');
const section = (r: BusinessRead, id: string) => r.sections.find((s) => s.id === id)!;

async function purge(): Promise<void> {
  await db.deleteFrom('business_read.snapshots').where('founder_id', 'in', FIDS).execute();
}

beforeAll(async () => {
  try { db = createKyselyClient(DB_URL); await db.selectFrom('business_read.snapshots').select('read_id').limit(1).execute(); repo = new PgBusinessReadRepository(db); await purge(); dbUp = true; } catch { dbUp = false; }
});
afterAll(async () => { try { if (dbUp) await purge(); } catch { /* ignore */ } try { await db?.destroy(); } catch { /* ignore */ } });

describe('Business Read persistence §LIVE — immutable, founder-scoped, fail-closed', () => {
  it('save → reload is deep-equal identical, content_hash matches, receipts + order preserved, S4 empty', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const read = assembled(FID_A, 'ALPHA');
    const { readId } = await repo.save(read);
    const stored = await repo.findById(FID_A, readId);
    expect(stored).not.toBeNull();
    // deep-equal identical (whole snapshot, Option A)
    expect(stored!.read).toEqual(read);
    expect(stored!.contentHash).toBe(hashOf(read));
    expect(stored!.schemaVersion).toBe(1);
    // section order preserved
    expect(stored!.read.sections.map((s) => s.id)).toEqual(['what_i_read', 'what_i_observe', 'gaps', 'bets', 'my_read', 'cannot_see']);
    // S4 stays empty
    expect(section(stored!.read, 'bets').empty).toBe(true);
    expect(section(stored!.read, 'bets').claims).toEqual([]);
    // S2 observed receipts reload verbatim
    const s2 = section(stored!.read, 'what_i_observe').claims!;
    expect(s2.length).toBeGreaterThan(0);
    expect(s2.flatMap((c) => c.receipts!.map((r) => r.text))).toContain('ALPHA calm software for everyone');
    // S3 declared + observed receipt groups reload distinctly
    const gap = section(stored!.read, 'gaps').claims![0]!;
    expect(gap.declaredReceipts!.map((r) => r.text)).toContain('ALPHA we are enterprise-first');
    expect(gap.observedReceipts!.map((r) => r.text)).toContain('ALPHA calm software for everyone');
    expect(gap.declaredReceipts!.every((r) => r.epistemicKind === 'declared')).toBe(true);
    expect(gap.observedReceipts!.every((r) => r.epistemicKind === 'observed')).toBe(true);
  });

  it('fetch path imports NO engine/LLM (a pure DB read + deserialize)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const src = readFileSync(join(__dirname, '../../business-model/pg-business-read.repository.ts'), 'utf8');
    expect(src).not.toMatch(/business-model-engine/);
    expect(src).not.toMatch(/anthropic/i);
    expect(src).not.toMatch(/assembleRead|recompute/);
  });

  it('two-founder isolation — A cannot fetch B’s Read by read_id; listByFounder never crosses', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const bSaved = await repo.save(assembled(FID_B, 'BETA'));
    // A knows B's read_id but is not authorized: founder_id is always filtered
    expect(await repo.findById(FID_A, bSaved.readId)).toBeNull();
    const bList = await repo.listByFounder(FID_B);
    expect(bList.every((s) => s.founderId === FID_B)).toBe(true);
    const aList = await repo.listByFounder(FID_A);
    expect(aList.some((s) => s.readId === bSaved.readId)).toBe(false);
  });

  it('listByFounder / findLatest are deterministic (created_at desc, read_id tiebreak)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    await purge();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await repo.save(assembled(FID_A, `SEQ${i}`))).readId);
    const list = await repo.listByFounder(FID_A);
    expect(list).toHaveLength(3);
    // newest first; identical query twice → identical order
    const list2 = await repo.listByFounder(FID_A);
    expect(list2.map((s) => s.readId)).toEqual(list.map((s) => s.readId));
    const latest = await repo.findLatestByFounder(FID_A);
    expect(latest!.readId).toBe(list[0]!.readId);
  });

  it('fail-closed: structurally-malformed read_content THROWS (never masked as not-found)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    // valid JSON (JSONB accepts it) but NOT a BusinessRead — no sections array / no founderId. The repo must
    // refuse to reconstitute it rather than return a half-Read or null.
    await db.insertInto('business_read.snapshots').values({ read_id: 'corrupt-A', founder_id: FID_A, schema_version: 1, content_hash: 'x', read_content: JSON.stringify({ notARead: true, sections: 'nope' }) }).execute();
    await expect(repo.findById(FID_A, 'corrupt-A')).rejects.toBeInstanceOf(StoredReadError);
  });

  it('fail-closed: unknown/future schema_version THROWS', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    await db.insertInto('business_read.snapshots').values({ read_id: 'v999-A', founder_id: FID_A, schema_version: 999, content_hash: 'x', read_content: JSON.stringify(assembled(FID_A, 'FUT')) }).execute();
    await expect(repo.findById(FID_A, 'v999-A')).rejects.toBeInstanceOf(StoredReadError);
  });
});
