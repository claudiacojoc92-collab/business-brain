import { describe, it, expect } from 'vitest';
import { assertFragmentHonest, type EvidenceFragment, type IEvidenceRepository } from '@bb/domain';
import { GoogleConnector } from '../../connectors/google/google.connector';
import { PendingAuthStore } from '../../auth/oauth';
import type { CredentialStore, StoredCredential } from '../../auth/credential-store';
import type { DriveClient, DriveFileMeta } from '../../connectors/google/drive-client';
import type { GoogleOAuthConfig } from '../../connectors/google/google-oauth';
import { runGoogleMagicMoment } from '../../business-model/google-magic-moment.service';

/**
 * Phase-3 service — honest non-reflective states (no synthesis, no LLM). The synced/Beat-2 path
 * runs the frozen engine and is proven at the Phase-5 live manual gate (real Google account).
 */
const FID = 'dev-founder';
const GOOGLE_DOC = 'application/vnd.google-apps.document';
const KEY = 'unused-non-reflective-paths-never-call-the-engine';

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
  async load(): Promise<StoredCredential> { return { accessToken: 'T', refreshToken: null, expiresAt: null, scopes: 'drive.file' }; }
}
class FakeDrive implements DriveClient {
  constructor(private readonly files: Record<string, { meta: DriveFileMeta; text?: string }>) {}
  async getFileMeta(id: string) { return this.files[id]!.meta; }
  async exportText(id: string) { return this.files[id]!.text ?? ''; }
  async download() { return Buffer.from(''); }
}
const OAUTH: GoogleOAuthConfig = { clientId: 'x', clientSecret: 'x', redirectUri: 'x' };
const meta = (id: string, name: string, mimeType: string): DriveFileMeta => ({ id, name, mimeType, modifiedTime: null });
const connWith = (files: Record<string, { meta: DriveFileMeta; text?: string }>, repo: IEvidenceRepository) =>
  new GoogleConnector(new FixedTokenStore(), OAUTH, new PendingAuthStore(), { repo, drive: new FakeDrive(files) });

describe('runGoogleMagicMoment — honest non-synced states (no synthesis, no LLM)', () => {
  it('unsupported files → unsupported state, honest message, no beats, no synthesis', async () => {
    const repo = new GateRepo();
    const conn = connWith({ f1: { meta: meta('f1', 'Budget', 'application/vnd.google-apps.spreadsheet') } }, repo);
    const r = await runGoogleMagicMoment({ founderId: FID, fileIds: ['f1'], conn, repo, anthropicApiKey: KEY });
    expect(r.state).toBe('unsupported');
    expect(r.beat1.googleLines).toHaveLength(0);
    expect(r.inferredLines).toHaveLength(0);
    expect(r.timing.recomputeMs).toBe(0);
    expect(r.beat1.message).toMatch(/couldn't read/i);
  });

  it('no files selected → empty state, honest message', async () => {
    const repo = new GateRepo();
    const r = await runGoogleMagicMoment({ founderId: FID, fileIds: [], conn: connWith({}, repo), repo, anthropicApiKey: KEY });
    expect(r.state).toBe('empty');
    expect(r.beat1.message).toMatch(/couldn't find much/i);
  });

  it('redundant (duplicates website) → redundant state, no new evidence, honest message', async () => {
    const repo = new GateRepo();
    const site = 'We are the calm, organized way to manage projects, work with clients, and communicate company-wide across your team.';
    await repo.append({ id: 'w1', founderId: FID, source: 'website', platform: null, sourceUrl: 'https://acme.co/', confidenceKind: 'observed', occurredAt: null, capturedAt: new Date('2026-01-01'), visibility: 'public', payload: { text: site }, derivedFrom: null });
    const before = repo.store.size;
    const conn = connWith({ f1: { meta: meta('f1', 'About', GOOGLE_DOC), text: site } }, repo);
    const r = await runGoogleMagicMoment({ founderId: FID, fileIds: ['f1'], conn, repo, anthropicApiKey: KEY });
    expect(r.state).toBe('redundant');
    expect(r.beat1.message).toMatch(/already read/i);
    expect(repo.store.size).toBe(before); // nothing new stored (no double-count)
  });
});
