/* In-memory doubles for Commit 5 recognition append + snapshot-view read composition. */
import type {
  BusinessSnapshotVersion,
  RecognitionEvent,
  RecognitionEventRepository,
  ReviewRepository,
  SnapshotRepository,
  SnapshotReview,
  SnapshotStatement,
  SubjectRef,
} from '@bb/domain';
import { businessRefKey } from '@bb/domain';
import type {
  RecognitionAppendOutcome,
  RecognitionEventLog,
  RecognitionRepos,
  RecognitionUnitOfWork,
} from '../../understanding/recognition-ports';

const rk = (brk: string, id: string): string => `${brk}::${id}`;

interface RecEventRow extends RecognitionEvent {
  readonly seq: number;
}

export interface RecStore {
  versions: Map<string, BusinessSnapshotVersion>; // brk::snapshotId
  latest: Map<string, string>; // brk -> snapshotId
  events: Map<string, RecEventRow>; // brk::eventId
  seq: Map<string, number>; // brk -> last allocated append_seq
  reviews: Map<string, SnapshotReview[]>; // brk::snapshotId -> append-ordered reviews
}

export function emptyRecStore(): RecStore {
  return { versions: new Map(), latest: new Map(), events: new Map(), seq: new Map(), reviews: new Map() };
}
function clone(s: RecStore): RecStore {
  return {
    versions: new Map(s.versions),
    latest: new Map(s.latest),
    events: new Map(s.events),
    seq: new Map(s.seq),
    reviews: new Map([...s.reviews.entries()].map(([k, v]) => [k, [...v]])),
  };
}

/** Seed a synthetic immutable snapshot with the given (semanticKey, versionId) statements. */
export function seedSnapshot(
  store: RecStore,
  businessRef: SubjectRef,
  opts: { id: string; statements: ReadonlyArray<{ semanticKey: string; versionId: string }> },
): BusinessSnapshotVersion {
  const brk = businessRefKey(businessRef);
  const observedStatements: SnapshotStatement[] = opts.statements.map((st) => ({
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

export function seedReview(store: RecStore, businessRef: SubjectRef, review: SnapshotReview): void {
  const key = rk(businessRefKey(businessRef), review.snapshotId);
  const list = store.reviews.get(key) ?? [];
  list.push(review);
  store.reviews.set(key, list);
}

/**
 * Immutable client-owned intent signature (excludes assigned id, seq, and `at`; INCLUDES clientEventId) —
 * mirrors the Pg repo exactly so the double reproduces business-scoped replay/conflict behavior.
 */
function intentSig(brk: string, e: RecognitionEvent): string {
  return JSON.stringify([brk, e.snapshotId, e.statementSemanticKey, e.statementVersionId, e.response, e.note ?? null, e.clientEventId]);
}

class MemRecognitionEvents implements RecognitionEventLog {
  constructor(private readonly s: RecStore) {}

  async findByClientEventId(businessRef: SubjectRef, clientEventId: string): Promise<RecognitionEvent | null> {
    const brk = businessRefKey(businessRef);
    const row = [...this.s.events.values()].find((r) => businessRefKey(r.businessRef) === brk && r.clientEventId === clientEventId);
    return row ? strip(row) : null;
  }

  async appendIdempotent(businessRef: SubjectRef, event: RecognitionEvent): Promise<RecognitionAppendOutcome> {
    const brk = businessRefKey(businessRef);
    // Business-scoped clientEventId re-check (any semanticKey) — authoritative, mirrors the under-lock Pg path.
    const byClient = [...this.s.events.values()].find((r) => businessRefKey(r.businessRef) === brk && r.clientEventId === event.clientEventId);
    if (byClient) {
      return intentSig(brk, byClient) === intentSig(brk, event)
        ? { kind: 'replayed', stored: strip(byClient) }
        : { kind: 'client_event_conflict' };
    }
    const byId = this.s.events.get(rk(brk, event.id));
    if (byId) {
      return intentSig(brk, byId) === intentSig(brk, event)
        ? { kind: 'replayed', stored: strip(byId) }
        : { kind: 'event_id_conflict' };
    }
    const nextSeq = (this.s.seq.get(brk) ?? 0) + 1;
    this.s.seq.set(brk, nextSeq);
    this.s.events.set(rk(brk, event.id), { ...event, seq: nextSeq });
    return { kind: 'created', stored: event };
  }

  async append(businessRef: SubjectRef, event: RecognitionEvent): Promise<void> {
    const outcome = await this.appendIdempotent(businessRef, event);
    const brk = businessRefKey(businessRef);
    if (outcome.kind === 'client_event_conflict') throw new Error(`recognition event conflict for clientEventId ${event.clientEventId} (business ${brk})`);
    if (outcome.kind === 'event_id_conflict') throw new Error(`recognition event id conflict for id ${event.id} (business ${brk})`);
  }

  async history(businessRef: SubjectRef, semanticKey: string): Promise<readonly RecognitionEvent[]> {
    const brk = businessRefKey(businessRef);
    return [...this.s.events.values()]
      .filter((r) => businessRefKey(r.businessRef) === brk && r.statementSemanticKey === semanticKey)
      .sort((a, b) => a.seq - b.seq)
      .map(strip);
  }
  async latestForVersion(businessRef: SubjectRef, snapshotId: string): Promise<readonly RecognitionEvent[]> {
    const brk = businessRefKey(businessRef);
    return [...this.s.events.values()]
      .filter((r) => businessRefKey(r.businessRef) === brk && r.snapshotId === snapshotId)
      .sort((a, b) => a.seq - b.seq)
      .map(strip);
  }
}

function strip(r: RecEventRow): RecognitionEvent {
  const { seq: _seq, ...event } = r;
  return event;
}

class FaultyRecognitionEvents implements RecognitionEventLog {
  async findByClientEventId(): Promise<RecognitionEvent | null> {
    return null;
  }
  async appendIdempotent(): Promise<RecognitionAppendOutcome> {
    throw new Error('injected recognition-append failure');
  }
  async append(): Promise<void> {
    throw new Error('injected recognition-append failure');
  }
  async history(): Promise<readonly RecognitionEvent[]> {
    return [];
  }
  async latestForVersion(): Promise<readonly RecognitionEvent[]> {
    return [];
  }
}

class MemSnapshots implements SnapshotRepository {
  constructor(private readonly s: RecStore) {}
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

class MemReviews implements ReviewRepository {
  constructor(private readonly s: RecStore) {}
  async append(businessRef: SubjectRef, review: SnapshotReview): Promise<void> {
    seedReview(this.s, businessRef, review);
  }
  async latest(businessRef: SubjectRef, snapshotId: string): Promise<SnapshotReview | null> {
    const list = this.s.reviews.get(rk(businessRefKey(businessRef), snapshotId)) ?? [];
    return list.length > 0 ? list[list.length - 1]! : null;
  }
}

/**
 * Clone-on-write UoW that SERIALIZES transactions per business, modeling the Postgres per-business
 * append-sequence FOR UPDATE lock: concurrent `run(A, …)` calls execute one-at-a-time and each clones
 * from the latest committed state, so a racing appender's committed writes are visible to the next. On
 * success the working maps are committed; a throw discards them (rollback). Serialization is per
 * businessRefKey — different businesses never block each other.
 */
export class InMemoryRecognitionUnitOfWork implements RecognitionUnitOfWork {
  private readonly tails = new Map<string, Promise<unknown>>();
  constructor(private readonly store: RecStore, private readonly opts: { failOn?: 'append' } = {}) {}

  async run<T>(businessRef: SubjectRef, work: (repos: RecognitionRepos) => Promise<T>): Promise<T> {
    const brk = businessRefKey(businessRef);
    const prior = this.tails.get(brk) ?? Promise.resolve();
    const mine = prior.then(() => this.critical(work));
    this.tails.set(brk, mine.catch(() => undefined)); // keep the chain alive even if this tx throws
    return mine;
  }

  private async critical<T>(work: (repos: RecognitionRepos) => Promise<T>): Promise<T> {
    const working = clone(this.store); // clones the latest committed state (prior tx already committed)
    const repos: RecognitionRepos = {
      recognition: this.opts.failOn === 'append' ? new FaultyRecognitionEvents() : new MemRecognitionEvents(working),
      snapshots: new MemSnapshots(working),
    };
    const result = await work(repos); // a throw here skips the commit below → rollback
    this.store.versions = working.versions;
    this.store.latest = working.latest;
    this.store.events = working.events;
    this.store.seq = working.seq;
    this.store.reviews = working.reviews;
    return result;
  }
}

/** Direct RecognitionEventLog over the store — for unit-testing appendIdempotent's under-lock race mapping. */
export function directRecognitionLog(store: RecStore): RecognitionEventLog {
  return new MemRecognitionEvents(store);
}

/** Seed an already-committed event directly (simulates a racer that won the append). */
export function seedEvent(store: RecStore, businessRef: SubjectRef, event: RecognitionEvent): void {
  const brk = businessRefKey(businessRef);
  const nextSeq = (store.seq.get(brk) ?? 0) + 1;
  store.seq.set(brk, nextSeq);
  store.events.set(rk(brk, event.id), { ...event, seq: nextSeq });
}

export function recognitionUow(store: RecStore, opts?: { failOn?: 'append' }): InMemoryRecognitionUnitOfWork {
  return new InMemoryRecognitionUnitOfWork(store, opts);
}

/** Read-side deps for the SnapshotViewService (no transaction needed). */
export function viewDeps(store: RecStore): {
  snapshots: SnapshotRepository;
  recognition: RecognitionEventRepository;
  reviews: ReviewRepository;
} {
  return { snapshots: new MemSnapshots(store), recognition: new MemRecognitionEvents(store), reviews: new MemReviews(store) };
}

export function scopedEvents(store: RecStore, businessRef: SubjectRef): RecognitionEvent[] {
  const brk = businessRefKey(businessRef);
  return [...store.events.values()].filter((r) => businessRefKey(r.businessRef) === brk).sort((a, b) => a.seq - b.seq).map(strip);
}

export class CapturingRecognitionEventSink {
  readonly appended: Array<{ snapshotId: string; statementVersionId: string; response: string; replayed: boolean }> = [];
  recognitionAppended(e: { snapshotId: string; statementVersionId: string; response: string; replayed: boolean }): void {
    this.appended.push({ snapshotId: e.snapshotId, statementVersionId: e.statementVersionId, response: e.response, replayed: e.replayed });
  }
}
