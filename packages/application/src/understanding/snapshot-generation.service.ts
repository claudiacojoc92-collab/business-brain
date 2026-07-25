import { ApplicationError } from '@bb/shared';
import {
  buildBusinessSnapshotVersion,
  buildScope,
  generateSnapshotStatements,
  GENERATION_PROFILE_VERSION,
  type BusinessSnapshotVersion,
  type Clock,
  type CorpusRevisionId,
  type EffectiveFacetResolver,
  type ObservationRepository,
  type RawCaptureRepository,
  type RevisionRepository,
  type SubjectRef,
} from '@bb/domain';
import type { SnapshotGenerationEventSink, SnapshotUnitOfWork } from './snapshot-ports';

export interface ISnapshotGenerationService {
  generate(businessRef: SubjectRef, corpus: CorpusRevisionId, extractionProfile: string): Promise<BusinessSnapshotVersion>;
}

/**
 * Orchestration only. Loads the corpus's observations, derives scope from RawCapture sources +
 * observation occurredAt, resolves effective facets, runs the pure deterministic generation into
 * immutable SnapshotStatements + an immutable BusinessSnapshotVersion, and persists it idempotently
 * (by the frozen snapshotId). Creates epistemic snapshot data only — no rendering, review, recognition,
 * status, declarations, or audit.
 */
export class SnapshotGenerationService implements ISnapshotGenerationService {
  constructor(
    private readonly deps: {
      readonly observations: ObservationRepository;
      readonly rawCaptures: RawCaptureRepository;
      readonly resolver: EffectiveFacetResolver;
      readonly revisions: RevisionRepository;
      readonly uow: SnapshotUnitOfWork;
      readonly clock: Clock;
      readonly events: SnapshotGenerationEventSink;
    },
  ) {}

  async generate(businessRef: SubjectRef, corpus: CorpusRevisionId, extractionProfile: string): Promise<BusinessSnapshotVersion> {
    const observations = await this.deps.observations.listByCorpus(businessRef, corpus);
    if (observations.length === 0) {
      throw new ApplicationError('SNAPSHOT_EMPTY_CORPUS', 'No observations for the requested corpus revision.', 422);
    }

    const rawCaptures = await this.deps.rawCaptures.getByIds(businessRef, observations.map((o) => o.rawCaptureId));
    const scope = buildScope({
      sources: rawCaptures.map((r) => r.source),
      occurredAts: observations.map((o) => o.payload.occurredAt),
      corpusSize: observations.length,
    });

    const effectiveFacets = await this.deps.resolver.resolve(businessRef, corpus, extractionProfile);
    const understandingContextRevision = await this.deps.revisions.currentUnderstandingCtx(businessRef);

    const observedStatements = generateSnapshotStatements({
      corpusRevision: corpus,
      understandingContextRevision,
      effectiveFacets,
      scope,
    });

    const version = buildBusinessSnapshotVersion({
      businessRef,
      corpusRevision: corpus,
      understandingContextRevision,
      observedStatements,
      declaredContext: [],
      createdAt: this.deps.clock.now(),
    });

    const out = await this.deps.uow.run(businessRef, async (snapshots) => {
      const existing = await snapshots.byId(businessRef, version.id);
      if (existing) return { version: existing, created: false as const };
      await snapshots.save(businessRef, version);
      return { version, created: true as const };
    });

    this.deps.events.snapshotGenerated({
      businessRef,
      snapshotId: out.version.id,
      corpusRevision: corpus,
      extractionProfile,
      generationProfileVersion: GENERATION_PROFILE_VERSION,
      statementCount: out.version.observedStatements.length,
      replayed: !out.created,
    });

    return out.version;
  }
}
