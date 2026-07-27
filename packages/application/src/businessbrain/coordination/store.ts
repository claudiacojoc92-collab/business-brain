/**
 * Business Brain V1 — in-memory canonical store (owner-scoped).
 *
 * Stands in for the persistence layer behind the frozen logical boundary.
 * Enforces the schema invariants provable without a database: at most one
 * Current and at most one Candidate per Founder, and content-free append-only
 * Audit Events. Candidate content is held here but never exposed publicly.
 *
 * `failNextPromotion` is a deterministic seam to prove Promotion failure leaves
 * the prior Current intact (Rollback), without a real transaction manager.
 */
import type {
  DiagnosisContent,
  EvidenceVersion,
  FounderId,
  RefreshRecord,
  VersionBundle,
  VersionId,
} from '../domain/model';

export interface CandidateState {
  readonly versionId: VersionId;
  readonly founderId: FounderId;
  evidence: EvidenceVersion | null;
  diagnosis: DiagnosisContent | null;
}

export interface AuditEvent {
  readonly type: string;
  readonly versionId?: VersionId;
  readonly at: string;
}

interface FounderState {
  current: VersionBundle | null;
  candidate: CandidateState | null;
  refresh: RefreshRecord | null;
  audit: AuditEvent[];
}

export class PromotionFailure extends Error {}

export class BusinessBrainStore {
  private readonly byFounder = new Map<FounderId, FounderState>();
  /** Test-only seam: force the next promotion commit to fail. */
  public failNextPromotion = false;

  private state(founderId: FounderId): FounderState {
    let s = this.byFounder.get(founderId);
    if (!s) {
      s = { current: null, candidate: null, refresh: null, audit: [] };
      this.byFounder.set(founderId, s);
    }
    return s;
  }

  getCurrent(founderId: FounderId): VersionBundle | null {
    return this.state(founderId).current;
  }

  getRefresh(founderId: FounderId): RefreshRecord | null {
    return this.state(founderId).refresh;
  }

  activeCandidateVersionId(founderId: FounderId): VersionId | null {
    return this.state(founderId).candidate?.versionId ?? null;
  }

  audit(founderId: FounderId): readonly AuditEvent[] {
    return this.state(founderId).audit;
  }

  private append(founderId: FounderId, type: string, at: string, versionId?: VersionId): void {
    this.state(founderId).audit.push({ type, at, ...(versionId ? { versionId } : {}) });
  }

  /** Create the single Candidate + Refresh record. Enforces one-Candidate. */
  startCandidate(founderId: FounderId, refresh: RefreshRecord, at: string): void {
    const s = this.state(founderId);
    if (s.candidate !== null) {
      throw new Error('one_candidate_invariant_violation');
    }
    s.candidate = {
      versionId: refresh.candidateVersionId,
      founderId,
      evidence: null,
      diagnosis: null,
    };
    s.refresh = refresh;
    this.append(founderId, 'RefreshStarted', at, refresh.candidateVersionId);
  }

  setCandidateEvidence(
    founderId: FounderId,
    versionId: VersionId,
    evidence: EvidenceVersion,
    at: string,
  ): boolean {
    const c = this.state(founderId).candidate;
    if (!c || c.versionId !== versionId) return false; // stale-worker guard
    c.evidence = evidence;
    this.append(founderId, 'ImportCommitted', at, versionId);
    return true;
  }

  setCandidateDiagnosis(
    founderId: FounderId,
    versionId: VersionId,
    diagnosis: DiagnosisContent,
    at: string,
  ): boolean {
    const c = this.state(founderId).candidate;
    if (!c || c.versionId !== versionId) return false; // stale-worker guard
    c.diagnosis = diagnosis;
    this.append(founderId, 'DiagnosisCompleted', at, versionId);
    return true;
  }

  /**
   * Atomic Promotion: remove the prior Current and make the Candidate the sole
   * Current, in one logical step. On seam-forced failure, nothing changes
   * (Rollback) and PromotionFailure is thrown.
   */
  promote(founderId: FounderId, versionId: VersionId, producedAt: string): VersionBundle {
    const s = this.state(founderId);
    const c = s.candidate;
    if (!c || c.versionId !== versionId) {
      throw new Error('promotion_no_active_candidate');
    }
    if (!c.evidence || !c.diagnosis) {
      throw new Error('promotion_incomplete_candidate');
    }
    if (this.failNextPromotion) {
      this.failNextPromotion = false;
      throw new PromotionFailure('forced_promotion_failure'); // prior Current intact
    }
    const bundle: VersionBundle = {
      versionId: c.versionId,
      founderId,
      evidence: c.evidence,
      diagnosis: c.diagnosis,
      producedAt,
    };
    const priorId = s.current?.versionId;
    s.current = bundle; // prior Current physically replaced in one step
    s.candidate = null;
    this.append(founderId, 'VersionPromoted', producedAt, versionId);
    if (priorId) this.append(founderId, 'VersionSuperseded', producedAt, priorId);
    return bundle;
  }

  /** Physically remove the Candidate. Never touches Current. */
  discardCandidate(founderId: FounderId, at: string): void {
    const s = this.state(founderId);
    if (s.candidate) {
      this.append(founderId, 'CandidateDiscarded', at, s.candidate.versionId);
      s.candidate = null;
    }
  }

  updateRefresh(founderId: FounderId, mutate: (r: RefreshRecord) => void): RefreshRecord | null {
    const r = this.state(founderId).refresh;
    if (r) mutate(r);
    return r;
  }
}
