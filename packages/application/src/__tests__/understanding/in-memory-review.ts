/* In-memory doubles for Commit 6 review lifecycle (+ minimal recognition read for view integration). */
import type {
  BusinessSnapshotVersion,
  RecognitionEvent,
  RecognitionEventRepository,
  SnapshotRepository,
  SnapshotReview,
  SnapshotStatement,
  SubjectRef,
} from '@bb/domain';
import { businessRefKey } from '@bb/domain';
import type {
  ReviewAppendOutcome,
  ReviewLog,
  ReviewRepos,
  ReviewUnitOfWork,
} from '../../understanding/review-ports';

const rk = (brk: string, id: string): string => `${brk}::${id}`;

interface RevRow extends SnapshotReview {
  readonly seq: number;
  readonly clientEventId: string;
}
interface RecRow extends RecognitionEvent {
  readonly seq: number;
}

export interface RevStore {
  versions: Map<string, BusinessSnapshotVersion>; // brk::snapshotId
  latest: Map<string, string>; // brk -> snapshotId
  reviews: Map<string, RevRow>; // brk::reviewId
  reviewSeq: Map<string, number>; // brk -> last allocated review append_seq
  events: Map<string, RecRow>; // brk::eventId (recognition; drives view status in the override test)
  recSeq: Map<string, number>; // brk -> last allocated recognition append_seq
}

export function emptyRevStore(): RevStore {
  return { versions: new Map(), latest: new Map(), reviews: new Map(), reviewSeq: new Map(), events: new Map(), recSeq: new Map() };
}
function clone(s: RevStore): RevStore {
  return {
    versions: new Map(s.versions),
    latest: new Map(s.latest),
    reviews: new Map(s.reviews),
    reviewSeq: new Map(s.reviewSeq),
    events: new Map(s.events),
    recSeq: new Map(s.recSeq),
  };
}

/** Seed a synthetic immutable snapshot with the given (semanticKey, versionId) statements. */
export function seedSnapshot(
  store: RevStore,
  businessRef: SubjectRef,
  opts: { id: string; statements?: ReadonlyArray<{ semanticKey: string; versionId: string }> },
): BusinessSnapshotVersion {
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

/** Seed a committed recognition event directly (a DIRECT event → view status partially_reviewed absent a review). */
export function seedRecognitionEvent(store: RevStore, businessRef: SubjectRef, event: RecognitionEvent): void {
  const brk = businessRefKey(businessRef);
  const nextSeq = (store.recSeq.get(brk) ?? 0) + 1;
  store.recSeq.set(brk, nextSeq);
  store.events.set(rk(brk, event.id), { ...event, seq: nextSeq });
}

/** Seed a committed review directly (simulates a racer that won the append). */
export function seedReviewRow(store: RevStore, businessRef: SubjectRef, review: SnapshotReview, clientEventId: string): void {
  const brk = businessRefKey(businessRef);
  const nextSeq = (store.reviewSeq.get(brk) ?? 0) + 1;
  store.reviewSeq.set(brk, nextSeq);
  store.reviews.set(rk(brk, review.id), { ...review, seq: nextSeq, clientEventId });
}

/** Immutable review intent signature (excludes assigned id, seq, `at`; includes clientEventId) — mirrors Pg. */
function intentSig(brk: string, r: SnapshotReview, clientEventId: string): string {
  return JSON.stringify([brk, r.snapshotId, r.response, clientEventId]);
}
function stripReview(r: RevRow): SnapshotReview {
  const { seq: _seq, clientEventId: _c, ...review } = r;
  return review;
}

class MemReviewLog implements ReviewLog {
  constructor(private readonly s: RevStore) {}

  async findByClientEventId(businessRef: SubjectRef, clientEventId: string): Promise<SnapshotReview | null> {
    const brk = businessRefKey(businessRef);
    const hit = [...this.s.reviews.entries()].find(([k, v]) => k.startsWith(`${brk}::`) && v.clientEventId === clientEventId);
    return hit ? stripReview(hit[1]) : null;
  }

  async appendIdempotent(businessRef: SubjectRef, review: SnapshotReview, clientEventId: string): Promise<ReviewAppendOutcome> {
    const brk = businessRefKey(businessRef);
    const scoped = [...this.s.reviews.entries()].filter(([k]) => k.startsWith(`${brk}::`)).map(([, v]) => v);
    const byClient = scoped.find((r) => r.clientEventId === clientEventId);
    if (byClient) {
      return intentSig(brk, byClient, byClient.clientEventId) === intentSig(brk, review, clientEventId)
        ? { kind: 'replayed', stored: stripReview(byClient) }
        : { kind: 'client_event_conflict' };
    }
    const byId = this.s.reviews.get(rk(brk, review.id));
    if (byId) {
      return intentSig(brk, byId, byId.clientEventId) === intentSig(brk, review, clientEventId)
        ? { kind: 'replayed', stored: stripReview(byId) }
        : { kind: 'review_id_conflict' };
    }
    const nextSeq = (this.s.reviewSeq.get(brk) ?? 0) + 1;
    this.s.reviewSeq.set(brk, nextSeq);
    this.s.reviews.set(rk(brk, review.id), { ...review, seq: nextSeq, clientEventId });
    return { kind: 'created', stored: review };
  }

  async append(businessRef: SubjectRef, review: SnapshotReview): Promise<void> {
    const outcome = await this.appendIdempotent(businessRef, review, review.id);
    const brk = businessRefKey(businessRef);
    if (outcome.kind === 'client_event_conflict') throw new Error(`review conflict for clientEventId ${review.id} (business ${brk})`);
    if (outcome.kind === 'review_id_conflict') throw new Error(`review id conflict for id ${review.id} (business ${brk})`);
  }

  async latest(businessRef: SubjectRef, snapshotId: string): Promise<SnapshotReview | null> {
    const brk = businessRefKey(businessRef);
    const rows = this.scopedForSnapshot(brk, snapshotId);
    return rows.length > 0 ? stripReview(rows[rows.length - 1]!) : null;
  }

  async history(businessRef: SubjectRef, snapshotId: string): Promise<readonly SnapshotReview[]> {
    const brk = businessRefKey(businessRef);
    return this.scopedForSnapshot(brk, snapshotId).map(stripReview);
  }

  private scopedForSnapshot(brk: string, snapshotId: string): RevRow[] {
    return [...this.s.reviews.entries()]
      .filter(([k, v]) => k.startsWith(`${brk}::`) && v.snapshotId === snapshotId)
      .map(([, v]) => v)
      .sort((a, b) => a.seq - b.seq);
  }
}

class FaultyReviewLog implements ReviewLog {
  async findByClientEventId(): Promise<SnapshotReview | null> {
    return null;
  }
  async appendIdempotent(): Promise<ReviewAppendOutcome> {
    throw new Error('injected review-append failure');
  }
  async append(): Promise<void> {
    throw new Error('injected review-append failure');
  }
  async latest(): Promise<SnapshotReview | null> {
    return null;
  }
  async history(): Promise<readonly SnapshotReview[]> {
    return [];
  }
}

class MemSnapshots implements SnapshotRepository {
  constructor(private readonly s: RevStore) {}
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

/** Minimal recognition READ double so the SnapshotViewService can derive draft/partial before a review. */
class MemRecognitionRead implements RecognitionEventRepository {
  constructor(private readonly s: RevStore) {}
  async append(): Promise<void> {
    throw new Error('review tests must not append recognition events through this double');
  }
  async history(businessRef: SubjectRef, semanticKey: string): Promise<readonly RecognitionEvent[]> {
    const brk = businessRefKey(businessRef);
    return [...this.s.events.entries()]
      .filter(([k, v]) => k.startsWith(`${brk}::`) && v.statementSemanticKey === semanticKey)
      .map(([, v]) => v)
      .sort((a, b) => a.seq - b.seq)
      .map(stripEvent);
  }
  async latestForVersion(businessRef: SubjectRef, snapshotId: string): Promise<readonly RecognitionEvent[]> {
    const brk = businessRefKey(businessRef);
    return [...this.s.events.entries()]
      .filter(([k, v]) => k.startsWith(`${brk}::`) && v.snapshotId === snapshotId)
      .map(([, v]) => v)
      .sort((a, b) => a.seq - b.seq)
      .map(stripEvent);
  }
}
function stripEvent(r: RecRow): RecognitionEvent {
  const { seq: _seq, ...event } = r;
  return event;
}

/**
 * Clone-on-write UoW that SERIALIZES transactions per business (models the Postgres per-business review_seq
 * FOR UPDATE lock): concurrent run(A, …) calls execute one-at-a-time, each cloning from the latest committed
 * state. On success the working maps commit; a throw discards them (rollback).
 */
export class InMemoryReviewUnitOfWork implements ReviewUnitOfWork {
  private readonly tails = new Map<string, Promise<unknown>>();
  constructor(private readonly store: RevStore, private readonly opts: { failOn?: 'append' } = {}) {}

  async run<T>(businessRef: SubjectRef, work: (repos: ReviewRepos) => Promise<T>): Promise<T> {
    const brk = businessRefKey(businessRef);
    const prior = this.tails.get(brk) ?? Promise.resolve();
    const mine = prior.then(() => this.critical(work));
    this.tails.set(brk, mine.catch(() => undefined));
    return mine;
  }

  private async critical<T>(work: (repos: ReviewRepos) => Promise<T>): Promise<T> {
    const working = clone(this.store);
    const repos: ReviewRepos = {
      reviews: this.opts.failOn === 'append' ? new FaultyReviewLog() : new MemReviewLog(working),
      snapshots: new MemSnapshots(working),
    };
    const result = await work(repos);
    this.store.versions = working.versions;
    this.store.latest = working.latest;
    this.store.reviews = working.reviews;
    this.store.reviewSeq = working.reviewSeq;
    this.store.events = working.events;
    this.store.recSeq = working.recSeq;
    return result;
  }
}

export function reviewUow(store: RevStore, opts?: { failOn?: 'append' }): InMemoryReviewUnitOfWork {
  return new InMemoryReviewUnitOfWork(store, opts);
}

/** Direct ReviewLog over the store — for unit-testing appendIdempotent's under-lock race mapping. */
export function directReviewLog(store: RevStore): ReviewLog {
  return new MemReviewLog(store);
}

/** Read-side deps for the SnapshotViewService over the SAME review store. */
export function viewDeps(store: RevStore): {
  snapshots: SnapshotRepository;
  recognition: RecognitionEventRepository;
  reviews: ReviewLog;
} {
  return { snapshots: new MemSnapshots(store), recognition: new MemRecognitionRead(store), reviews: new MemReviewLog(store) };
}

export function scopedReviews(store: RevStore, businessRef: SubjectRef): SnapshotReview[] {
  const prefix = `${businessRefKey(businessRef)}::`;
  return [...store.reviews.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v).sort((a, b) => a.seq - b.seq).map(stripReview);
}

export class CapturingReviewEventSink {
  readonly appended: Array<{ snapshotId: string; reviewId: string; response: string; replayed: boolean }> = [];
  reviewAppended(e: { snapshotId: string; reviewId: string; response: string; replayed: boolean }): void {
    this.appended.push({ snapshotId: e.snapshotId, reviewId: e.reviewId, response: e.response, replayed: e.replayed });
  }
}
