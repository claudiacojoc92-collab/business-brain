import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * S1-T5a C1 — THE LOAD-BEARING PROOF: production connect ingest is ingest-ONLY. Each wrapper deletes only
 * its OWN source's observed evidence (never 'business-model'), calls its connector spine, and returns a
 * factual result — with ZERO engine/recompute calls and no reflection callbacks. Connectors + recompute are
 * mocked so any engine touch would be caught.
 */
vi.mock('../../connectors/website/website.connector', () => ({ readWebsite: vi.fn() }));
vi.mock('../../connectors/upload/upload.connector', () => ({ readUpload: vi.fn() }));
vi.mock('../../connectors/google/google.connector', () => ({ readGoogle: vi.fn() }));
vi.mock('../../business-model/recompute', () => ({ recomputeFromWebsite: vi.fn(), recomputeFromSources: vi.fn() }));

import { readWebsite } from '../../connectors/website/website.connector';
import { readUpload } from '../../connectors/upload/upload.connector';
import { recomputeFromWebsite, recomputeFromSources } from '../../business-model/recompute';
import { ingestWebsite, ingestUpload, ingestCalendar } from '../../business-model/connect-ingest.service';

function fakeRepo() {
  return { deleteBySource: vi.fn(async () => {}), findObserved: vi.fn(async () => []), appendMany: vi.fn(async () => ({ stored: 0, deduped: 0 })) };
}
const noRecompute = () => { expect(recomputeFromWebsite).not.toHaveBeenCalled(); expect(recomputeFromSources).not.toHaveBeenCalled(); };
beforeEach(() => { vi.clearAllMocks(); });

describe('connect-ingest — ingest-only, no engine, no stream', () => {
  it('ingestWebsite: deletes website (NOT business-model), reads, returns factual result, NO recompute', async () => {
    vi.mocked(readWebsite).mockResolvedValue({ state: 'synced', pagesRead: 3, fragmentsStored: 5, gaps: [] } as never);
    const repo = fakeRepo();
    const r = await ingestWebsite({ founderId: 'A', url: 'https://a.example', repo: repo as never });
    expect(repo.deleteBySource).toHaveBeenCalledWith('A', 'website');
    expect(repo.deleteBySource).not.toHaveBeenCalledWith('A', 'business-model'); // inference lifecycle stays with generate
    expect(readWebsite).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ source: 'website', state: 'synced', stored: 5, detail: { pagesRead: 3 } });
    noRecompute();
  });

  it('ingestUpload: deletes upload only, reads, factual result, NO recompute', async () => {
    vi.mocked(readUpload).mockResolvedValue({ state: 'synced', filename: 'plan.pdf', provenanceStrength: 'strong', unitsRead: 7, fragmentsStored: 7, redundantUnits: 0 } as never);
    const repo = fakeRepo();
    const r = await ingestUpload({ founderId: 'A', input: { founderId: 'A', filename: 'plan.pdf', bytes: Buffer.from('x') }, repo: repo as never });
    expect(repo.deleteBySource).toHaveBeenCalledWith('A', 'upload');
    expect(repo.deleteBySource).not.toHaveBeenCalledWith('A', 'business-model');
    expect(r.source).toBe('upload'); expect(r.stored).toBe(7); expect(r.state).toBe('synced');
    noRecompute();
  });

  it('ingestCalendar: deletes google-calendar only, syncs, derives state, NO recompute', async () => {
    const conn = { syncCalendar: vi.fn(async () => ({ eventsRead: 12, fragmentsStored: 4, fragmentsDeduped: 0, hasPattern: true })) };
    const repo = fakeRepo();
    const r = await ingestCalendar({ founderId: 'A', conn: conn as never, repo: repo as never });
    expect(repo.deleteBySource).toHaveBeenCalledWith('A', 'google-calendar');
    expect(repo.deleteBySource).not.toHaveBeenCalledWith('A', 'business-model');
    expect(conn.syncCalendar).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ source: 'google-calendar', state: 'synced', stored: 4, detail: { eventsRead: 12 } });
    noRecompute();
  });

  it('ingestCalendar derives empty state when no events read', async () => {
    const conn = { syncCalendar: vi.fn(async () => ({ eventsRead: 0, fragmentsStored: 0, fragmentsDeduped: 0, hasPattern: false })) };
    const r = await ingestCalendar({ founderId: 'A', conn: conn as never, repo: fakeRepo() as never });
    expect(r.state).toBe('empty');
  });

  it('the ingest service imports NO engine and NO recompute (source-level invariant)', () => {
    const src = readFileSync(join(__dirname, '../../business-model/connect-ingest.service.ts'), 'utf8');
    expect(src).not.toMatch(/business-model-engine/);
    expect(src).not.toMatch(/from '\.\/recompute'/);
    expect(src).not.toMatch(/recomputeFrom/);
  });
});
