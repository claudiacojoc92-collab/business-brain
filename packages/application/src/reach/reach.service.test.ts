import { describe, it, expect, beforeEach } from 'vitest';
import { ValidationError, NotFoundError } from '@bb/shared';
import { ReachService } from './reach.service';
import type { IReachReportRepository, ReachReport, ReachReportInput, ReachReportPatch } from './contracts';

class MemReachRepo implements IReachReportRepository {
  rows: ReachReport[] = [];
  private seq = 0;
  async create(input: ReachReportInput): Promise<ReachReport> {
    const now = new Date(Date.UTC(2026, 9, 3, 12, 0, this.seq++)).toISOString();
    const row: ReachReport = {
      id: `r${this.seq}`, businessId: input.businessId, accountId: input.accountId,
      weekStart: input.weekStart, weekEnd: input.weekEnd, newPeopleCount: input.newPeopleCount,
      rawText: input.rawText, channelHint: input.channelHint ?? null, publishedRefs: input.publishedRefs ?? [],
      reportedAt: now, updatedAt: now,
    };
    this.rows.unshift(row);
    return row;
  }
  async list(businessId: string): Promise<ReachReport[]> { return this.rows.filter((r) => r.businessId === businessId); }
  async get(businessId: string, id: string): Promise<ReachReport | null> { return this.rows.find((r) => r.businessId === businessId && r.id === id) ?? null; }
  async update(businessId: string, id: string, patch: ReachReportPatch): Promise<ReachReport | null> {
    const i = this.rows.findIndex((r) => r.businessId === businessId && r.id === id);
    if (i < 0) return null;
    this.rows[i] = { ...this.rows[i], ...patch, updatedAt: new Date().toISOString() } as ReachReport;
    return this.rows[i];
  }
  async delete(businessId: string, id: string): Promise<boolean> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.businessId === businessId && r.id === id));
    return this.rows.length < before;
  }
}

const base: ReachReportInput = {
  businessId: 'biz1', accountId: 'acc1', weekStart: '2026-09-28', weekEnd: '2026-10-05',
  newPeopleCount: 7, rawText: '3 from Instagram, 1 referral, 3 walked past', channelHint: 'instagram',
};

describe('ReachService — store + reflect founder-reported attribution', () => {
  let repo: MemReachRepo;
  let svc: ReachService;
  beforeEach(() => { repo = new MemReachRepo(); svc = new ReachService({ repo }); });

  it('records the founder\'s verbatim words with the week window and count', async () => {
    const r = await svc.record(base);
    expect(r.rawText).toBe('3 from Instagram, 1 referral, 3 walked past');
    expect(r.newPeopleCount).toBe(7);
    expect(r.weekStart).toBe('2026-09-28');
    expect((await svc.list('biz1')).length).toBe(1);
  });

  it('rejects an empty answer (collects nothing silently is not allowed)', async () => {
    await expect(svc.record({ ...base, rawText: '   ' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('normalizes a nonsense count to null and never throws on it', async () => {
    expect((await svc.record({ ...base, newPeopleCount: -4 })).newPeopleCount).toBeNull();
    expect((await svc.record({ ...base, newPeopleCount: Number.NaN })).newPeopleCount).toBeNull();
    expect((await svc.record({ ...base, newPeopleCount: 3.9 })).newPeopleCount).toBe(3);
  });

  it('corrects an entry — their report, their data', async () => {
    const r = await svc.record(base);
    const u = await svc.correct('biz1', r.id, { rawText: 'actually all 7 from a neighbour', newPeopleCount: 7 });
    expect(u.rawText).toBe('actually all 7 from a neighbour');
    expect((await svc.list('biz1'))[0]?.rawText).toBe('actually all 7 from a neighbour');
  });

  it('deletes an entry', async () => {
    const r = await svc.record(base);
    await svc.remove('biz1', r.id);
    expect((await svc.list('biz1')).length).toBe(0);
  });

  it('throws NotFound when correcting or deleting a missing / foreign entry', async () => {
    const r = await svc.record(base);
    await expect(svc.correct('biz1', 'nope', { rawText: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.remove('other-biz', r.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
