/* In-memory doubles for Commit 8 declaration lifecycle (+ snapshot/empty reads for lifecycle-isolation). */
import type {
  BusinessSnapshotVersion,
  DeclarationKind,
  FounderDeclaration,
  RecognitionEvent,
  RecognitionEventRepository,
  ReviewRepository,
  SnapshotRepository,
  SnapshotReview,
  SnapshotStatement,
  StatementDeclarationLink,
  SubjectRef,
} from '@bb/domain';
import { businessRefKey } from '@bb/domain';
import { SnapshotViewService } from '../../understanding/snapshot-view.service';
import type {
  DeclarationAppendOutcome,
  DeclarationLog,
  DeclarationRepos,
  DeclarationUnitOfWork,
} from '../../understanding/declaration-ports';

const rk = (brk: string, id: string): string => `${brk}::${id}`;
const UNDERSTANDING_ELIGIBLE: readonly DeclarationKind[] = ['self_report', 'intent', 'decision'];

interface DeclRow extends FounderDeclaration {
  readonly seq: number;
  readonly clientEventId: string;
}

export interface DeclStore {
  declarations: Map<string, DeclRow>; // brk::declarationId
  declSeq: Map<string, number>; // brk -> last allocated append_seq
  links: Set<string>; // `${brk}::${semanticKey}::${declarationId}`
  versions: Map<string, BusinessSnapshotVersion>; // brk::snapshotId (for lifecycle-isolation only)
  latest: Map<string, string>; // brk -> snapshotId
}

export function emptyDeclStore(): DeclStore {
  return { declarations: new Map(), declSeq: new Map(), links: new Set(), versions: new Map(), latest: new Map() };
}
function clone(s: DeclStore): DeclStore {
  return {
    declarations: new Map(s.declarations),
    declSeq: new Map(s.declSeq),
    links: new Set(s.links),
    versions: new Map(s.versions),
    latest: new Map(s.latest),
  };
}

export function seedSnapshot(store: DeclStore, businessRef: SubjectRef, opts: { id: string; statements?: ReadonlyArray<{ semanticKey: string; versionId: string }> }): BusinessSnapshotVersion {
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

/** Seed a committed declaration directly (simulates a racer that won the append). */
export function seedDeclarationRow(store: DeclStore, businessRef: SubjectRef, declaration: FounderDeclaration, clientEventId: string): void {
  const brk = businessRefKey(businessRef);
  const nextSeq = (store.declSeq.get(brk) ?? 0) + 1;
  store.declSeq.set(brk, nextSeq);
  store.declarations.set(rk(brk, declaration.id), { ...declaration, seq: nextSeq, clientEventId });
}

/** Immutable founder-owned intent signature (excludes assigned id, seq, `declaredAt`) — mirrors Pg. */
function intentSig(brk: string, d: FounderDeclaration, clientEventId: string): string {
  return JSON.stringify([brk, d.kind, d.subject.type, d.subject.id, d.statement, d.provenance, d.supersedes ?? null, clientEventId]);
}
function stripDecl(r: DeclRow): FounderDeclaration {
  const { seq: _seq, clientEventId: _c, ...declaration } = r;
  return declaration;
}

class MemDeclarationLog implements DeclarationLog {
  constructor(private readonly s: DeclStore) {}

  async findByClientEventId(businessRef: SubjectRef, clientEventId: string): Promise<FounderDeclaration | null> {
    const brk = businessRefKey(businessRef);
    const hit = [...this.s.declarations.entries()].find(([k, v]) => k.startsWith(`${brk}::`) && v.clientEventId === clientEventId);
    return hit ? stripDecl(hit[1]) : null;
  }

  async appendIdempotent(businessRef: SubjectRef, declaration: FounderDeclaration, clientEventId: string): Promise<DeclarationAppendOutcome> {
    const brk = businessRefKey(businessRef);
    const scoped = [...this.s.declarations.entries()].filter(([k]) => k.startsWith(`${brk}::`)).map(([, v]) => v);
    const byClient = scoped.find((r) => r.clientEventId === clientEventId);
    if (byClient) {
      return intentSig(brk, byClient, byClient.clientEventId) === intentSig(brk, declaration, clientEventId)
        ? { kind: 'replayed', stored: stripDecl(byClient) }
        : { kind: 'client_event_conflict' };
    }
    const byId = this.s.declarations.get(rk(brk, declaration.id));
    if (byId) {
      return intentSig(brk, byId, byId.clientEventId) === intentSig(brk, declaration, clientEventId)
        ? { kind: 'replayed', stored: stripDecl(byId) }
        : { kind: 'declaration_id_conflict' };
    }
    const nextSeq = (this.s.declSeq.get(brk) ?? 0) + 1;
    this.s.declSeq.set(brk, nextSeq);
    this.s.declarations.set(rk(brk, declaration.id), { ...declaration, seq: nextSeq, clientEventId });
    return { kind: 'created', stored: declaration };
  }

  async append(businessRef: SubjectRef, declaration: FounderDeclaration): Promise<void> {
    const outcome = await this.appendIdempotent(businessRef, declaration, declaration.id);
    const brk = businessRefKey(businessRef);
    if (outcome.kind === 'client_event_conflict') throw new Error(`declaration conflict for clientEventId ${declaration.id} (business ${brk})`);
    if (outcome.kind === 'declaration_id_conflict') throw new Error(`declaration id conflict for id ${declaration.id} (business ${brk})`);
  }

  async link(businessRef: SubjectRef, link: StatementDeclarationLink): Promise<void> {
    const brk = businessRefKey(businessRef);
    this.s.links.add(`${brk}::${link.statementSemanticKey}::${link.declarationId}`);
  }

  async effectiveUnderstanding(businessRef: SubjectRef): Promise<readonly FounderDeclaration[]> {
    return this.scoped(businessRefKey(businessRef)).filter((r) => UNDERSTANDING_ELIGIBLE.includes(r.kind)).map(stripDecl);
  }

  async history(businessRef: SubjectRef): Promise<readonly FounderDeclaration[]> {
    return this.scoped(businessRefKey(businessRef)).map(stripDecl);
  }

  private scoped(brk: string): DeclRow[] {
    return [...this.s.declarations.entries()].filter(([k]) => k.startsWith(`${brk}::`)).map(([, v]) => v).sort((a, b) => a.seq - b.seq);
  }
}

class FaultyDeclarationLog implements DeclarationLog {
  async findByClientEventId(): Promise<FounderDeclaration | null> {
    return null;
  }
  async appendIdempotent(): Promise<DeclarationAppendOutcome> {
    throw new Error('injected declaration-append failure');
  }
  async append(): Promise<void> {
    throw new Error('injected declaration-append failure');
  }
  async link(): Promise<void> {
    throw new Error('injected declaration-link failure');
  }
  async effectiveUnderstanding(): Promise<readonly FounderDeclaration[]> {
    return [];
  }
  async history(): Promise<readonly FounderDeclaration[]> {
    return [];
  }
}

/** Clone-on-write UoW that SERIALIZES per business (models the presented_seq FOR UPDATE lock). Rollback on throw. */
export class InMemoryDeclarationUnitOfWork implements DeclarationUnitOfWork {
  private readonly tails = new Map<string, Promise<unknown>>();
  constructor(private readonly store: DeclStore, private readonly opts: { failOn?: 'append' } = {}) {}

  async run<T>(businessRef: SubjectRef, work: (repos: DeclarationRepos) => Promise<T>): Promise<T> {
    const brk = businessRefKey(businessRef);
    const prior = this.tails.get(brk) ?? Promise.resolve();
    const mine = prior.then(() => this.critical(work));
    this.tails.set(brk, mine.catch(() => undefined));
    return mine;
  }

  private async critical<T>(work: (repos: DeclarationRepos) => Promise<T>): Promise<T> {
    const working = clone(this.store);
    const repos: DeclarationRepos = { declarations: this.opts.failOn === 'append' ? new FaultyDeclarationLog() : new MemDeclarationLog(working) };
    const result = await work(repos);
    this.store.declarations = working.declarations;
    this.store.declSeq = working.declSeq;
    this.store.links = working.links;
    this.store.versions = working.versions;
    this.store.latest = working.latest;
    return result;
  }
}

export function declarationUow(store: DeclStore, opts?: { failOn?: 'append' }): InMemoryDeclarationUnitOfWork {
  return new InMemoryDeclarationUnitOfWork(store, opts);
}

/** Direct DeclarationLog over the store — for unit-testing appendIdempotent's under-lock race mapping + link. */
export function directDeclarationLog(store: DeclStore): DeclarationLog {
  return new MemDeclarationLog(store);
}

// --- lifecycle-isolation helpers: a frozen SnapshotViewService over the snapshot store, empty other lanes ---
class MemSnapshots implements SnapshotRepository {
  constructor(private readonly s: DeclStore) {}
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
    throw new Error('declaration tests do not append recognition');
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
    throw new Error('declaration tests do not append reviews');
  }
  async latest(): Promise<SnapshotReview | null> {
    return null;
  }
}

/** The frozen SnapshotViewService over this store's snapshots (recognition/review deliberately empty). */
export function snapshotViewService(store: DeclStore): SnapshotViewService {
  return new SnapshotViewService({ snapshots: new MemSnapshots(store), recognition: new EmptyRecognitionRead(), reviews: new EmptyReviewRead() });
}

export function scopedDeclarations(store: DeclStore, businessRef: SubjectRef): FounderDeclaration[] {
  const prefix = `${businessRefKey(businessRef)}::`;
  return [...store.declarations.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v).sort((a, b) => a.seq - b.seq).map(stripDecl);
}

export class CapturingDeclarationEventSink {
  readonly appended: Array<{ declarationId: string; kind: string; replayed: boolean }> = [];
  declarationAppended(e: { declarationId: string; kind: string; replayed: boolean }): void {
    this.appended.push({ declarationId: e.declarationId, kind: e.kind, replayed: e.replayed });
  }
}
