import { describe, it, expect } from 'vitest';
import { assertFragmentHonest, type EvidenceFragment, type IEvidenceRepository } from '@bb/domain';
import { GoogleConnector } from '../../connectors/google/google.connector';
import { PendingAuthStore } from '../../auth/oauth';
import type { CredentialStore, StoredCredential } from '../../auth/credential-store';
import type { CalendarClient, CalendarEvent } from '../../connectors/google/calendar-client';
import type { GoogleOAuthConfig } from '../../connectors/google/google-oauth';
import { runCalendarMagicMoment } from '../../business-model/calendar-magic-moment.service';

/**
 * Calendar service — honest NON-synced states (no synthesis, no LLM). Mirrors the bar set by
 * google-magic-moment.test: the synced/Beat-2 path runs the frozen engine and is proven at the
 * live manual gate (real Google account + calendar). Here we prove the paths that must NEVER call
 * the engine stay honest and cheap: no events → empty (no fabricated pattern); a calendar read
 * failure → failed (never a false synced). Fail closed both ways.
 */
const FID = 'dev-founder';
const KEY = 'unused-non-synced-paths-never-call-the-engine';

class GateRepo implements IEvidenceRepository {
  store = new Map<string, EvidenceFragment>();
  async append(f: EvidenceFragment) { assertFragmentHonest({ confidenceKind: f.confidenceKind, sourceUrl: f.sourceUrl, derivedFrom: f.derivedFrom, source: f.source }); const isNew = !this.store.has(f.id); this.store.set(f.id, f); return { stored: isNew }; }
  async appendMany(fs: EvidenceFragment[]) { let s = 0; for (const f of fs) if ((await this.append(f)).stored) s++; return { stored: s, deduped: fs.length - s }; }
  async findByFounder(fid: string) { return [...this.store.values()].filter((f) => f.founderId === fid); }
  async findObserved(fid: string, source?: string) { return [...this.store.values()].filter((f) => f.founderId === fid && f.confidenceKind === 'observed' && (source ? f.source === source : true)); }
  async deleteBySource(fid: string, source: string) { for (const [id, f] of this.store) if (f.founderId === fid && f.source === source) this.store.delete(id); }
}
class FixedTokenStore implements CredentialStore {
  async save() {} async has() { return true; } async delete() {}
  async load(): Promise<StoredCredential> { return { accessToken: 'T', refreshToken: null, expiresAt: null, scopes: 'calendar.events.readonly' }; }
}
class FakeCalendar implements CalendarClient {
  constructor(private readonly events: CalendarEvent[] | Error) {}
  async listEvents(): Promise<CalendarEvent[]> { if (this.events instanceof Error) throw this.events; return this.events; }
}
const OAUTH: GoogleOAuthConfig = { clientId: 'x', clientSecret: 'x', redirectUri: 'x' };
const connWith = (cal: CalendarEvent[] | Error, repo: IEvidenceRepository) =>
  new GoogleConnector(new FixedTokenStore(), OAUTH, new PendingAuthStore(), { repo, calendar: new FakeCalendar(cal) });

describe('runCalendarMagicMoment — honest non-synced states (no synthesis, no LLM)', () => {
  it('no events in the window → empty state, honest message, no synthesis (no fabricated pattern)', async () => {
    const repo = new GateRepo();
    let mattersFired = false;
    const r = await runCalendarMagicMoment({ founderId: FID, conn: connWith([], repo), repo, anthropicApiKey: KEY, onWhatMatters: () => { mattersFired = true; } });
    expect(r.state).toBe('empty');
    expect(r.beat1.calendarLines).toHaveLength(0);
    expect(r.inferredLines).toHaveLength(0);
    expect(r.whatMattersNow).toHaveLength(0);
    expect(r.timing.recomputeMs).toBe(0);   // engine never ran
    expect(mattersFired).toBe(false);        // C never fired on the empty path
    expect(r.beat1.message).toMatch(/no scheduled events/i);
    // and nothing was written to the store (no calendar fragments minted)
    expect((await repo.findObserved(FID, 'google-calendar'))).toHaveLength(0);
  });

  it('calendar read failure → failed state, honest message, never a false synced', async () => {
    const repo = new GateRepo();
    const r = await runCalendarMagicMoment({ founderId: FID, conn: connWith(new Error('calendar listEvents failed: 403'), repo), repo, anthropicApiKey: KEY });
    expect(r.state).toBe('failed');
    expect(r.beat1.calendarLines).toHaveLength(0);
    expect(r.whatMattersNow).toHaveLength(0);
    expect(r.timing.recomputeMs).toBe(0);   // engine never ran
    expect(r.error).toMatch(/403/);
    expect(r.beat1.message).toMatch(/couldn't read from your calendar/i);
  });
});
