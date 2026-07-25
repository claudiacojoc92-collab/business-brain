/* In-memory doubles for Commit 7 presentation lifecycle (+ empty recognition/review reads for view composition). */
import type {
  BusinessSnapshotVersion,
  RecognitionEvent,
  RecognitionEventRepository,
  SnapshotPresentedEvent,
  SnapshotRepository,
  SnapshotReview,
  SnapshotStatement,
  SubjectRef,
  ReviewRepository,
} from '@bb/domain';
import { businessRefKey } from '@bb/domain';
import { SnapshotViewService } from '../../understanding/snapshot-view.service';
import { PresentationViewService } from '../../understanding/presentation-view.service';
import type {
  PresentedEventAppendOutcome,
  PresentedEventLog,
  PresentationRepos,
  PresentationUnitOfWork,
} from '../../understanding/presentation-ports';

const rk = (brk: string, id: string): string => `${brk}::${id}`;

interface PresRow extends SnapshotPresentedEvent {
  readonly seq: number;
  readonly clientEventId: string;
}

export interface PresStore {
  versions: Map<string, BusinessSnapshotVersion>; // brk::snapshotId
  latest: Map<string, string>; // brk -> snapshotId
  presentations: Map<string, PresRow>; // brk::eventId
  presSeq: Map<string, number>; // brk -> last allocated append_seq
}

export function emptyPresStore(): PresStore {
  return { versions: new Map(), latest: new Map(), presentations: new Map(), presSeq: new Map() };
}
function clone(s: PresStore): PresStore {
  return {
    versions: new Map(s.versions),
    latest: new Map(s.latest),
    presentations: new Map(s.presentations),
    presSeq: new Map(s.presSeq),
  };
}

export function seedSnapshot(
  store: PresStore,
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

/** Seed a committed presented event directly (simulates a racer that won the append). */
export function seedPresentedRow(store: PresStore, businessRef: SubjectRef, event: SnapshotPresentedEvent, clientEventId: string): void {
  const brk = businessRefKey(businessRef);
  const nextSeq = (store.presSeq.get(brk) ?? 0) + 1;
  store.presSeq.set(brk, nextSeq);
  store.presentations.set(rk(brk, event.id), { ...event, seq: nextSeq, clientEventId });
}

/** Immutable intent signature (excludes assigned id, seq, `at`; includes snapshotId + clientEventId) — mirrors Pg. */
function intentSig(brk: string, e: SnapshotPresentedEvent, clientEventId: string): string {
  return JSON.stringify([brk, e.snapshotId, clientEventId]);
}
function stripEvent(r: PresRow): SnapshotPresentedEvent {
  const { seq: _seq, clientEventId: _c, ...event } = r;
  return event;
}

class MemPresentedLog implements PresentedEventLog {
  constructor(private readonly s: PresStore) {}

  async findByClientEventId(businessRef: SubjectRef, clientEventId: string): Promise<SnapshotPresentedEvent | null> {
    const brk = businessRefKey(businessRef);
    const hit = [...this.s.presentations.entries()].find(([k, v]) => k.startsWith(`${brk}::`) && v.clientEventId === clientEventId);
    return hit ? stripEvent(hit[1]) : null;
  }

  async appendIdempotent(businessRef: SubjectRef, event: SnapshotPresentedEvent, clientEventId: string): Promise<PresentedEventAppendOutcome> {
    const brk = businessRefKey(businessRef);
    const scoped = [...this.s.presentations.entries()].filter(([k]) => k.startsWith(`${brk}::`)).map(([, v]) => v);
    const byClient = scoped.find((r) => r.clientEventId === clientEventId);
    if (byClient) {
      return intentSig(brk, byClient, byClient.clientEventId) === intentSig(brk, event, clientEventId)
        ? { kind: 'replayed', stored: stripEvent(byClient) }
        : { kind: 'client_event_conflict' };
    }
    const byId = this.s.presentations.get(rk(brk, event.id));
    if (byId) {
      return intentSig(brk, byId, byId.clientEventId) === intentSig(brk, event, clientEventId)
        ? { kind: 'replayed', stored: stripEvent(byId) }
        : { kind: 'event_id_conflict' };
    }
    const nextSeq = (this.s.presSeq.get(brk) ?? 0) + 1;
    this.s.presSeq.set(brk, nextSeq);
    this.s.presentations.set(rk(brk, event.id), { ...event, seq: nextSeq, clientEventId });
    return { kind: 'created', stored: event };
  }

  async latest(businessRef: SubjectRef, snapshotId: string): Promise<SnapshotPresentedEvent | null> {
    const rows = this.scopedForSnapshot(businessRefKey(businessRef), snapshotId);
    return rows.length > 0 ? stripEvent(rows[rows.length - 1]!) : null;
  }

  async history(businessRef: SubjectRef, snapshotId: string): Promise<readonly SnapshotPresentedEvent[]> {
    return this.scopedForSnapshot(businessRefKey(businessRef), snapshotId).map(stripEvent);
  }

  private scopedForSnapshot(brk: string, snapshotId: string): PresRow[] {
    return [...this.s.presentations.entries()]
      .filter(([k, v]) => k.startsWith(`${brk}::`) && v.snapshotId === snapshotId)
      .map(([, v]) => v)
      .sort((a, b) => a.seq - b.seq);
  }
}

class FaultyPresentedLog implements PresentedEventLog {
  async findByClientEventId(): Promise<SnapshotPresentedEvent | null> {
    return null;
  }
  async appendIdempotent(): Promise<PresentedEventAppendOutcome> {
    throw new Error('injected presentation-append failure');
  }
  async latest(): Promise<SnapshotPresentedEvent | null> {
    return null;
  }
  async history(): Promise<readonly SnapshotPresentedEvent[]> {
    return [];
  }
}

class MemSnapshots implements SnapshotRepository {
  constructor(private readonly s: PresStore) {}
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

/** Empty recognition/review reads so the frozen SnapshotViewService composes a draft view (status untouched by presentation). */
class EmptyRecognitionRead implements RecognitionEventRepository {
  async append(): Promise<void> {
    throw new Error('presentation tests do not append recognition');
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
    throw new Error('presentation tests do not append reviews');
  }
  async latest(): Promise<SnapshotReview | null> {
    return null;
  }
}

/**
 * Clone-on-write UoW that SERIALIZES transactions per business (models the Postgres per-business
 * presented_seq FOR UPDATE lock). On success the working maps commit; a throw discards them (rollback).
 */
export class InMemoryPresentationUnitOfWork implements PresentationUnitOfWork {
  private readonly tails = new Map<string, Promise<unknown>>();
  constructor(private readonly store: PresStore, private readonly opts: { failOn?: 'append' } = {}) {}

  async run<T>(businessRef: SubjectRef, work: (repos: PresentationRepos) => Promise<T>): Promise<T> {
    const brk = businessRefKey(businessRef);
    const prior = this.tails.get(brk) ?? Promise.resolve();
    const mine = prior.then(() => this.critical(work));
    this.tails.set(brk, mine.catch(() => undefined));
    return mine;
  }

  private async critical<T>(work: (repos: PresentationRepos) => Promise<T>): Promise<T> {
    const working = clone(this.store);
    const repos: PresentationRepos = {
      presentations: this.opts.failOn === 'append' ? new FaultyPresentedLog() : new MemPresentedLog(working),
      snapshots: new MemSnapshots(working),
    };
    const result = await work(repos);
    this.store.versions = working.versions;
    this.store.latest = working.latest;
    this.store.presentations = working.presentations;
    this.store.presSeq = working.presSeq;
    return result;
  }
}

export function presentationUow(store: PresStore, opts?: { failOn?: 'append' }): InMemoryPresentationUnitOfWork {
  return new InMemoryPresentationUnitOfWork(store, opts);
}

/** Direct PresentedEventLog over the store — for unit-testing appendIdempotent's under-lock race mapping. */
export function directPresentedLog(store: PresStore): PresentedEventLog {
  return new MemPresentedLog(store);
}

/** A PresentationViewService composing the frozen (draft) SnapshotViewService with the presentation log. */
export function presentationViewService(store: PresStore): PresentationViewService {
  const snapshots = new MemSnapshots(store);
  const view = new SnapshotViewService({ snapshots, recognition: new EmptyRecognitionRead(), reviews: new EmptyReviewRead() });
  return new PresentationViewService({ view, presentations: new MemPresentedLog(store) });
}

export function scopedPresentations(store: PresStore, businessRef: SubjectRef): SnapshotPresentedEvent[] {
  const prefix = `${businessRefKey(businessRef)}::`;
  return [...store.presentations.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v).sort((a, b) => a.seq - b.seq).map(stripEvent);
}

export class CapturingPresentationEventSink {
  readonly appended: Array<{ snapshotId: string; presentedEventId: string; replayed: boolean }> = [];
  presentationAppended(e: { snapshotId: string; presentedEventId: string; replayed: boolean }): void {
    this.appended.push({ snapshotId: e.snapshotId, presentedEventId: e.presentedEventId, replayed: e.replayed });
  }
}
