/**
 * Google connector — first AUTHENTICATED Source (ADR-009). Implements the SAME standard connector
 * contract as website/upload (authorize/capabilities/sync/normalize/produceEvidence/status/
 * disconnect). Its only output is observed evidence through the UNCHANGED honesty gate; it NEVER
 * calls the engine and never reaches downstream (ADR-009 Invariant 3) — note: no engine import.
 *
 * Phase 1 (approved at the gate): authorize()=real OAuth + the credential lifecycle (exchange,
 * ahead-of-expiry refresh, revoke). Phase 2 (this file now): the evidence path — read granted
 * files via drive.file, extract (reusing M2.2's extractors), classify (reusing M2.2's redundancy
 * classifier), and emit observed google fragments with an OPAQUE `google://` document-location URI,
 * visibility:private, document identity + anchor. No new migration — the existing evidence schema
 * carries all of it (source/source_url/visibility columns + payload JSONB), exactly like upload.
 */
import { makeFragment, type EvidenceFragment, type IEvidenceRepository } from '@bb/domain';
import { classifyUnits } from '../upload/classify';
import { anchorKey } from '../upload/upload.connector';
import type { Anchor, ClassifiedUnit } from '../upload/types';
import type { CredentialStore, StoredCredential } from '../../auth/credential-store';
import { PendingAuthStore, createState, createPkce } from '../../auth/oauth';
import {
  buildAuthUrl, exchangeCode, refreshAccessToken, revokeToken,
  type GoogleOAuthConfig,
} from './google-oauth';
import { GoogleDriveClient, type DriveClient } from './drive-client';
import { extractGoogleFile, type GoogleFileResult, type GoogleFileType } from './google-extract';
import { GoogleCalendarClient, type CalendarClient } from './calendar-client';
import { buildCalendarEvidence, CALENDAR_SOURCE } from './calendar-temporal';

export const GOOGLE_PROVIDER = 'google';

/** Default calendar read window (days) — reversible; within the spec's 30–90 range. */
const CALENDAR_WINDOW_DAYS = 60;

export interface Capabilities { read: boolean; insights: boolean; publish: boolean }
export type GoogleConnectionState = 'disconnected' | 'connected';

/** Refresh this many ms BEFORE the token actually expires (ahead-of-expiry, never a hard edge). */
const REFRESH_SKEW_MS = 60_000;

/** Opaque, resolvable document-location key used as source_url. Never dereferenced/fetched. */
export function googleUri(fileId: string, filename: string, a: Anchor): string {
  return `google://${fileId}/${encodeURIComponent(filename)}#${anchorKey(a)}`;
}

export type ClassifiedGoogleFile = GoogleFileResult & { classified: ClassifiedUnit[] };

export interface GoogleConnectorOptions {
  repo?: IEvidenceRepository;
  drive?: DriveClient;
  calendar?: CalendarClient;
}

export interface CalendarSyncResult { eventsRead: number; fragmentsStored: number; fragmentsDeduped: number; hasPattern: boolean }

export class GoogleConnector {
  constructor(
    private readonly credentials: CredentialStore,
    private readonly oauth: GoogleOAuthConfig,
    private readonly pending: PendingAuthStore,
    private readonly opts: GoogleConnectorOptions = {},
  ) {}

  capabilities(): Capabilities { return { read: true, insights: false, publish: false }; }
  supportedTypes(): string[] { return ['google-doc', 'pdf', 'text']; }

  private repository(): IEvidenceRepository {
    if (!this.opts.repo) throw new Error('google evidence path not configured (no evidence repository)');
    return this.opts.repo;
  }
  private driveClient(): DriveClient { return this.opts.drive ?? new GoogleDriveClient(); }
  private calendarClient(): CalendarClient { return this.opts.calendar ?? new GoogleCalendarClient(); }

  // ── OAuth lifecycle (Phase 1, unchanged) ─────────────────────────────────────────────────────

  /** authorize() made real: begins the OAuth flow and returns Google's consent URL. */
  authorize(founderId: string): { authUrl: string; state: string } {
    const state = createState();
    const pkce = createPkce();
    this.pending.put(state, { founderId, provider: GOOGLE_PROVIDER, codeVerifier: pkce.codeVerifier, createdAt: Date.now() });
    return { authUrl: buildAuthUrl(this.oauth, state, pkce), state };
  }

  /** OAuth callback leg: verify state (CSRF), exchange code (+PKCE), persist tokens ENCRYPTED. */
  async handleCallback(state: string, code: string): Promise<{ founderId: string }> {
    const p = this.pending.take(state);
    if (!p) throw new Error('invalid or expired OAuth state');
    const tokens = await exchangeCode(this.oauth, code, p.codeVerifier);
    if (!tokens.accessToken) throw new Error('no access token in exchange response');
    await this.credentials.save(p.founderId, GOOGLE_PROVIDER, tokens);
    return { founderId: p.founderId };
  }

  async status(founderId: string): Promise<GoogleConnectionState> {
    return (await this.credentials.has(founderId, GOOGLE_PROVIDER)) ? 'connected' : 'disconnected';
  }

  /** Return a VALID access token for internal Drive calls, refreshing ahead of expiry. Never logged. */
  async getAccessToken(founderId: string, now = Date.now()): Promise<string> {
    const cred = await this.credentials.load(founderId, GOOGLE_PROVIDER);
    if (!cred) throw new Error('google not connected');
    const expiringSoon = cred.expiresAt != null && cred.expiresAt.getTime() - now <= REFRESH_SKEW_MS;
    if (expiringSoon) {
      if (!cred.refreshToken) throw new Error('access token expired and no refresh token available');
      const refreshed: StoredCredential = await refreshAccessToken(this.oauth, cred.refreshToken);
      await this.credentials.save(founderId, GOOGLE_PROVIDER, refreshed);
      return refreshed.accessToken;
    }
    return cred.accessToken;
  }

  /** Revoke at Google (best-effort) + delete local credentials + this Source's evidence. */
  async disconnect(founderId: string): Promise<void> {
    const cred = await this.credentials.load(founderId, GOOGLE_PROVIDER);
    const tok = cred?.refreshToken ?? cred?.accessToken;
    if (tok) { try { await revokeToken(this.oauth, tok); } catch { /* local delete authoritative */ } }
    await this.credentials.delete(founderId, GOOGLE_PROVIDER);
    if (this.opts.repo) {
      await this.opts.repo.deleteBySource(founderId, GOOGLE_PROVIDER);   // ADR-009 Inv 5: disconnect deletes evidence
      await this.opts.repo.deleteBySource(founderId, CALENDAR_SOURCE);   // …including the Calendar Source (same credential)
    }
  }

  // ── Evidence path (Phase 2) — connector contract; emits evidence only, no engine ─────────────

  /** sync: read each granted file via drive.file → extract to the shared ExtractedDoc shape. */
  async sync(founderId: string, fileIds: string[]): Promise<GoogleFileResult[]> {
    const token = await this.getAccessToken(founderId);
    const drive = this.driveClient();
    const out: GoogleFileResult[] = [];
    for (const id of fileIds) {
      try {
        const meta = await drive.getFileMeta(id, token);
        out.push(await extractGoogleFile(drive, token, meta));
      } catch (e) {
        // getFileMeta failed (401/403/404/network) — a Drive access ERROR, not an unsupported type.
        out.push({ fileId: id, filename: id, modifiedTime: null, type: 'error', doc: null, error: e instanceof Error ? e.message : 'read error' });
      }
    }
    return out;
  }

  // ── Calendar Source (behavior dimension) — same credential, source 'google-calendar' ─────────

  /**
   * Read the founder's primary-calendar timed events over a recent window and emit TEMPORAL
   * `observed` evidence as time-allocation patterns (calendar-temporal). Reuses the proven access-
   * token lifecycle; emits evidence only — NO engine, NO recompute (that is the service). Fail
   * closed: no events → no fragments. Same honesty gate; source 'google-calendar', calendar:// URI.
   */
  async syncCalendar(founderId: string, opts: { windowDays?: number; now?: Date } = {}): Promise<CalendarSyncResult> {
    const windowDays = opts.windowDays ?? CALENDAR_WINDOW_DAYS;
    const now = opts.now ?? new Date();
    const timeMin = new Date(now.getTime() - windowDays * 86_400_000);
    const token = await this.getAccessToken(founderId);
    const events = await this.calendarClient().listEvents(token, timeMin.toISOString(), now.toISOString());
    const fragments = buildCalendarEvidence(founderId, events, { windowDays, occurredAt: now });
    const { stored, deduped } = fragments.length ? await this.repository().appendMany(fragments) : { stored: 0, deduped: 0 };
    return { eventsRead: events.length, fragmentsStored: stored, fragmentsDeduped: deduped, hasPattern: fragments.length > 0 };
  }

  /** normalize: classify each unit — redundancy vs existing observed reality (reuses M2.2). */
  async normalize(founderId: string, files: GoogleFileResult[]): Promise<ClassifiedGoogleFile[]> {
    const existing = await this.repository().findObserved(founderId);
    const texts = existing.map((f) => String(f.payload?.['text'] ?? '')).filter(Boolean);
    return files.map((f) => ({ ...f, classified: f.doc ? classifyUnits(f.doc.units, texts) : [] }));
  }

  /** produceEvidence: emit observed google fragments through the UNCHANGED gate. Redundant → nothing. */
  async produceEvidence(founderId: string, files: ClassifiedGoogleFile[]): Promise<{ stored: number; deduped: number; redundantUnits: number }> {
    const fragments: EvidenceFragment[] = [];
    let redundantUnits = 0;
    for (const f of files) {
      if (!f.doc) continue;
      const occurredAt = f.modifiedTime ? new Date(f.modifiedTime) : null;
      const sourceDocument = { fileId: f.fileId, filename: f.filename, contentHash: f.doc.contentHash };
      for (const c of f.classified) {
        if (c.provenanceType === 'redundant') { redundantUnits++; continue; }
        const uri = googleUri(f.fileId, f.filename, c.unit.anchor);
        const common = {
          founderId, source: GOOGLE_PROVIDER, platform: null, sourceUrl: uri,
          confidenceKind: 'observed' as const, visibility: 'private' as const, occurredAt,
        };
        fragments.push(makeFragment({ ...common, payload: {
          text: c.unit.text, sourceDocument, anchor: c.unit.anchor, docType: f.type, provenanceStrength: f.doc.provenanceStrength,
        } }));
        for (const b of c.unit.blocks) {
          fragments.push(makeFragment({ ...common, payload: {
            kind: 'block', text: b.text, blockType: b.blockType, anchor: c.unit.anchor, sourceDocument,
          } }));
        }
      }
    }
    const { stored, deduped } = fragments.length ? await this.repository().appendMany(fragments) : { stored: 0, deduped: 0 };
    return { stored, deduped, redundantUnits };
  }
}

export type GoogleState = 'reading' | 'synced' | 'partial' | 'empty' | 'redundant' | 'unsupported' | 'failed';

export interface GoogleReadResult {
  state: GoogleState;
  founderId: string;
  filesRequested: number;
  filesRead: number;
  unsupportedFiles: number;
  unitsRead: number;
  fragmentsStored: number;
  fragmentsDeduped: number;
  redundantUnits: number;
  files: Array<{ fileId: string; filename: string; type: GoogleFileType; ok: boolean }>;
  error?: string;
}

/**
 * Orchestrator: runs the connector contract (sync → normalize → produceEvidence) and resolves an
 * honest state. STOPS at the evidence boundary (no recompute/reflection — that is the service).
 * Mirrors readUpload.
 */
export async function readGoogle(conn: GoogleConnector, founderId: string, fileIds: string[]): Promise<GoogleReadResult> {
  const zero = { founderId, filesRequested: fileIds.length, filesRead: 0, unsupportedFiles: 0, unitsRead: 0, fragmentsStored: 0, fragmentsDeduped: 0, redundantUnits: 0, files: [] as GoogleReadResult['files'] };
  if (fileIds.length === 0) return { state: 'empty', ...zero };

  let files;
  try { files = await conn.sync(founderId, fileIds); }
  catch (e) { return { state: 'failed', ...zero, error: e instanceof Error ? e.message : 'read error' }; }

  const fileSummary = files.map((f) => ({ fileId: f.fileId, filename: f.filename, type: f.type, ok: Boolean(f.doc) }));
  const errored = files.filter((f) => f.type === 'error');
  const unsupportedFiles = files.filter((f) => f.type === 'unsupported').length;
  const supported = files.filter((f) => f.doc && !f.doc.empty && f.doc.units.length > 0);

  if (supported.length === 0) {
    // A Drive ACCESS failure is a different truth from an unsupported file type — surface it as
    // FAILED (couldn't read from Google), never as an unsupported-type verdict (honesty).
    if (errored.length > 0) return { state: 'failed', ...zero, unsupportedFiles, files: fileSummary, error: errored[0]!.error };
    const anyReadable = files.some((f) => f.doc); // opened but empty vs. genuinely unsupported type
    return { state: anyReadable ? 'empty' : 'unsupported', ...zero, unsupportedFiles, files: fileSummary };
  }

  const classified = await conn.normalize(founderId, supported);
  const { stored, deduped, redundantUnits } = await conn.produceEvidence(founderId, classified);
  const unitsRead = supported.reduce((n, f) => n + (f.doc ? f.doc.units.length : 0), 0);

  let state: GoogleState;
  if (redundantUnits === unitsRead) state = 'redundant';
  else if (redundantUnits > 0) state = 'partial';
  else if (stored > 0) state = 'synced';
  else state = 'empty';

  return { state, founderId, filesRequested: fileIds.length, filesRead: supported.length, unsupportedFiles, unitsRead, fragmentsStored: stored, fragmentsDeduped: deduped, redundantUnits, files: fileSummary };
}
