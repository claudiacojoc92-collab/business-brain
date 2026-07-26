/* In-memory doubles for Commit 9 claim lifecycle (+ snapshot/empty reads for lifecycle-isolation). */
import type {
  BusinessSnapshotVersion,
  Claim,
  ClaimId,
  RecognitionEvent,
  RecognitionEventRepository,
  ReviewRepository,
  SnapshotRepository,
  SnapshotReview,
  SnapshotStatement,
  SubjectRef,
} from '@bb/domain';
import { businessRefKey } from '@bb/domain';
import { ApplicationError } from '@bb/shared';
import { SnapshotViewService } from '../../understanding/snapshot-view.service';
import { assertValidClientEventId } from '../../understanding/claim-validation';
import type { ClaimAppendOutcome, ClaimLog, ClaimRepos, ClaimUnitOfWork } from '../../understanding/claim-ports';

const rk = (brk: string, id: string): string => `${brk}::${id}`;

interface ClaimRow extends Claim {
  readonly seq: number;
  readonly clientEventId: string | null; // COMMAND identity; NULL for the frozen entity-path append
}

export interface ClaimStore {
  claims: Map<string, ClaimRow>; // brk::claimId
  claimSeq: Map<string, number>; // brk -> last allocated append_seq
  versions: Map<string, BusinessSnapshotVersion>; // brk::snapshotId (lifecycle-isolation only)
  latest: Map<string, string>; // brk -> snapshotId
}

export function emptyClaimStore(): ClaimStore {
  return { claims: new Map(), claimSeq: new Map(), versions: new Map(), latest: new Map() };
}
function clone(s: ClaimStore): ClaimStore {
  return { claims: new Map(s.claims), claimSeq: new Map(s.claimSeq), versions: new Map(s.versions), latest: new Map(s.latest) };
}

export function seedSnapshot(store: ClaimStore, businessRef: SubjectRef, opts: { id: string; statements?: ReadonlyArray<{ semanticKey: string; versionId: string }> }): BusinessSnapshotVersion {
  const brk = businessRefKey(businessRef);
  const observedStatements: SnapshotStatement[] = (opts.statements ?? []).map((st) => ({
    semanticKey: st.semanticKey,
    versionId: st.versionId,
    definitionKey: 'understanding.snapshot.demo',
    definitionVersion: 1,
    subject: businessRef,
    params: {},
    scope: { sources: ['instagram'], window: '2025-01', corpusSize: 1 },
    confidence: 'clear',
    provenanceKind: 'observed',
    observationIds: [],
    uncertainty: [],
  }));
  const version: BusinessSnapshotVersion = {
    id: opts.id,
    businessRef,
    corpusRevision: `corpus_${opts.id}`,
    understandingContextRevision: 'ctx_genesis',
    observedStatements,
    declaredContext: [],
    createdAt: '2025-01-06T04:00:00.000Z',
  };
  store.versions.set(rk(brk, version.id), version);
  store.latest.set(brk, version.id);
  return version;
}

/** Seed a committed claim directly (simulates a racer that won the append). */
export function seedClaimRow(store: ClaimStore, businessRef: SubjectRef, claim: Claim, clientEventId: string): void {
  const brk = businessRefKey(businessRef);
  const nextSeq = (store.claimSeq.get(brk) ?? 0) + 1;
  store.claimSeq.set(brk, nextSeq);
  store.claims.set(rk(brk, claim.id), { ...claim, seq: nextSeq, clientEventId });
}

/** COMMAND-identity signature (frozen content + clientEventId) — mirrors Pg domainIntentSig/rowIntentSig. */
function intentSig(brk: string, c: Claim, clientEventId: string | null): string {
  return JSON.stringify([brk, c.subject.type, c.subject.id, c.predicate, typeof c.object, c.object, clientEventId ?? null]);
}
/** CLAIM-content signature (EVERY frozen field incl. recordedAt, no clientEventId) — used by the entity-path append. */
function contentSig(brk: string, c: Claim): string {
  return JSON.stringify([brk, c.subject.type, c.subject.id, c.predicate, typeof c.object, c.object, c.recordedAt]);
}
function stripClaim(r: ClaimRow): Claim {
  const { seq: _seq, clientEventId: _c, ...claim } = r;
  return claim;
}

class MemClaimLog implements ClaimLog {
  constructor(private readonly s: ClaimStore) {}

  async findByClientEventId(businessRef: SubjectRef, clientEventId: string): Promise<Claim | null> {
    const brk = businessRefKey(businessRef);
    const hit = [...this.s.claims.entries()].find(([k, v]) => k.startsWith(`${brk}::`) && v.clientEventId === clientEventId);
    return hit ? stripClaim(hit[1]) : null;
  }

  async appendIdempotent(businessRef: SubjectRef, claim: Claim, clientEventId: string): Promise<ClaimAppendOutcome> {
    assertValidClientEventId(clientEventId); // authoritative boundary — mirrors Pg
    const brk = businessRefKey(businessRef);
    const scoped = [...this.s.claims.entries()].filter(([k]) => k.startsWith(`${brk}::`)).map(([, v]) => v);
    const byClient = scoped.find((r) => r.clientEventId === clientEventId);
    if (byClient) {
      return intentSig(brk, byClient, byClient.clientEventId) === intentSig(brk, claim, clientEventId)
        ? { kind: 'replayed', stored: stripClaim(byClient) }
        : { kind: 'client_event_conflict' };
    }
    const byId = this.s.claims.get(rk(brk, claim.id));
    if (byId) {
      return intentSig(brk, byId, byId.clientEventId) === intentSig(brk, claim, clientEventId)
        ? { kind: 'replayed', stored: stripClaim(byId) }
        : { kind: 'claim_id_conflict' };
    }
    const nextSeq = (this.s.claimSeq.get(brk) ?? 0) + 1;
    this.s.claimSeq.set(brk, nextSeq);
    this.s.claims.set(rk(brk, claim.id), { ...claim, seq: nextSeq, clientEventId });
    return { kind: 'created', stored: claim };
  }

  /** ENTITY path (frozen port) — no clientEventId; governed errors; idempotent by CLAIM content under (businessRef, id). */
  async append(businessRef: SubjectRef, claim: Claim): Promise<void> {
    if (businessRef.type !== claim.businessRef.type || businessRef.id !== claim.businessRef.id) {
      throw new ApplicationError('CLAIM_BUSINESS_SCOPE_MISMATCH', 'businessRef does not match claim.businessRef.', 422);
    }
    const brk = businessRefKey(businessRef);
    const byId = this.s.claims.get(rk(brk, claim.id));
    if (byId) {
      if (contentSig(brk, stripClaim(byId)) === contentSig(brk, claim)) return; // idempotent — same entity
      throw new ApplicationError('CLAIM_ID_CONFLICT', 'A claim id already exists with different content.', 500);
    }
    const nextSeq = (this.s.claimSeq.get(brk) ?? 0) + 1;
    this.s.claimSeq.set(brk, nextSeq);
    this.s.claims.set(rk(brk, claim.id), { ...claim, seq: nextSeq, clientEventId: null }); // NULL command identity
  }

  async byId(businessRef: SubjectRef, id: ClaimId): Promise<Claim | null> {
    return this.s.claims.get(rk(businessRefKey(businessRef), id)) ? stripClaim(this.s.claims.get(rk(businessRefKey(businessRef), id))!) : null;
  }

  async history(businessRef: SubjectRef): Promise<readonly Claim[]> {
    return this.scoped(businessRefKey(businessRef)).map(stripClaim);
  }

  async bySubject(businessRef: SubjectRef, subject: SubjectRef): Promise<readonly Claim[]> {
    return this.scoped(businessRefKey(businessRef)).filter((r) => r.subject.type === subject.type && r.subject.id === subject.id).map(stripClaim);
  }

  private scoped(brk: string): ClaimRow[] {
    return [...this.s.claims.entries()].filter(([k]) => k.startsWith(`${brk}::`)).map(([, v]) => v).sort((a, b) => a.seq - b.seq);
  }
}

class FaultyClaimLog implements ClaimLog {
  async findByClientEventId(): Promise<Claim | null> {
    return null;
  }
  async appendIdempotent(): Promise<ClaimAppendOutcome> {
    throw new Error('injected claim-append failure');
  }
  async append(): Promise<void> {
    throw new Error('injected claim-append failure');
  }
  async byId(): Promise<Claim | null> {
    return null;
  }
  async history(): Promise<readonly Claim[]> {
    return [];
  }
  async bySubject(): Promise<readonly Claim[]> {
    return [];
  }
}

/** Clone-on-write UoW that SERIALIZES per business (models the claim_seq FOR UPDATE lock). Rollback on throw. */
export class InMemoryClaimUnitOfWork implements ClaimUnitOfWork {
  private readonly tails = new Map<string, Promise<unknown>>();
  constructor(private readonly store: ClaimStore, private readonly opts: { failOn?: 'append' } = {}) {}

  async run<T>(businessRef: SubjectRef, work: (repos: ClaimRepos) => Promise<T>): Promise<T> {
    const brk = businessRefKey(businessRef);
    const prior = this.tails.get(brk) ?? Promise.resolve();
    const mine = prior.then(() => this.critical(work));
    this.tails.set(brk, mine.catch(() => undefined));
    return mine;
  }

  private async critical<T>(work: (repos: ClaimRepos) => Promise<T>): Promise<T> {
    const working = clone(this.store);
    const repos: ClaimRepos = { claims: this.opts.failOn === 'append' ? new FaultyClaimLog() : new MemClaimLog(working) };
    const result = await work(repos);
    this.store.claims = working.claims;
    this.store.claimSeq = working.claimSeq;
    this.store.versions = working.versions;
    this.store.latest = working.latest;
    return result;
  }
}

export function claimUow(store: ClaimStore, opts?: { failOn?: 'append' }): InMemoryClaimUnitOfWork {
  return new InMemoryClaimUnitOfWork(store, opts);
}

/** Direct ClaimLog over the store — for unit-testing appendIdempotent's under-lock race mapping + frozen append/reads. */
export function directClaimLog(store: ClaimStore): ClaimLog {
  return new MemClaimLog(store);
}

// --- lifecycle-isolation helpers: a frozen SnapshotViewService over the snapshot store, empty other lanes ---
class MemSnapshots implements SnapshotRepository {
  constructor(private readonly s: ClaimStore) {}
  async save(businessRef: SubjectRef, version: BusinessSnapshotVersion): Promise<void> {
    const brk = businessRefKey(businessRef);
    this.s.versions.set(rk(brk, version.id), version);
    this.s.latest.set(brk, version.id);
  }
  async current(businessRef: SubjectRef): Promise<BusinessSnapshotVersion | null> {
    const brk = businessRefKey(businessRef);
    const id = this.s.latest.get(brk);
    return id ? this.s.versions.get(rk(brk, id)) ?? null : null;
  }
  async byId(businessRef: SubjectRef, id: string): Promise<BusinessSnapshotVersion | null> {
    return this.s.versions.get(rk(businessRefKey(businessRef), id)) ?? null;
  }
}
class EmptyRecognitionRead implements RecognitionEventRepository {
  async append(): Promise<void> {
    throw new Error('claim tests do not append recognition');
  }
  async history(): Promise<readonly RecognitionEvent[]> {
    return [];
  }
  async latestForVersion(): Promise<readonly RecognitionEvent[]> {
    return [];
  }
}
class EmptyReviewRead implements ReviewRepository {
  async append(): Promise<void> {
    throw new Error('claim tests do not append reviews');
  }
  async latest(): Promise<SnapshotReview | null> {
    return null;
  }
}

/** The frozen SnapshotViewService over this store's snapshots (recognition/review deliberately empty). */
export function snapshotViewService(store: ClaimStore): SnapshotViewService {
  return new SnapshotViewService({ snapshots: new MemSnapshots(store), recognition: new EmptyRecognitionRead(), reviews: new EmptyReviewRead() });
}

export function scopedClaims(store: ClaimStore, businessRef: SubjectRef): Claim[] {
  const prefix = `${businessRefKey(businessRef)}::`;
  return [...store.claims.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v).sort((a, b) => a.seq - b.seq).map(stripClaim);
}

export class CapturingClaimEventSink {
  readonly appended: Array<{ claimId: string; replayed: boolean }> = [];
  claimAppended(e: { claimId: string; replayed: boolean }): void {
    this.appended.push({ claimId: e.claimId, replayed: e.replayed });
  }
}
