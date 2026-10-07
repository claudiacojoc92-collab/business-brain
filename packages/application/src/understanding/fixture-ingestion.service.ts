import { ApplicationError } from '@bb/shared';
import {
  type Clock,
  type CorpusRevision,
  type CorpusRevisionId,
  type NormalizedObservation,
  type NormalizedObservationPayload,
  type RawCapture,
  type SubjectRef,
  buildObservation,
  buildRawCapture,
  corpusRevisionId,
  fixtureIngestionKey,
  normalizePublication,
} from '@bb/domain';
import type {
  EntryRejectedReason,
  FixtureFile,
  IngestionEventSink,
  IngestionRepos,
  IngestionUnitOfWork,
} from './ports';

const SOURCE = 'instagram';

/** Public contract (frozen). */
export interface IFixtureIngestionService {
  ingest(businessRef: SubjectRef, fixture: FixtureFile): Promise<CorpusRevisionId>;
}

interface AcceptedEntry {
  externalId: string;
  entry: unknown;
  payload: NormalizedObservationPayload; // fixtures are Instagram publications
  extraction: NormalizedObservation['extraction'];
}

/**
 * Orchestration only. Validates the fixture envelope and each entry independently, rejects invalid
 * entries fail-closed (with a structured event each), assembles deterministic RawCaptures +
 * NormalizedObservations for the accepted entries via pure domain functions, and persists everything
 * (captures, observations, corpus revision, current-corpus pointer, idempotency record) inside ONE
 * transaction. Retry-safe: a repeat of the same fixture returns the existing revision without new writes.
 */
export class FixtureIngestionService implements IFixtureIngestionService {
  constructor(
    private readonly deps: {
      readonly uow: IngestionUnitOfWork;
      readonly clock: Clock;
      readonly events: IngestionEventSink;
    },
  ) {}

  async ingest(businessRef: SubjectRef, fixture: FixtureFile): Promise<CorpusRevisionId> {
    const envelope = asEnvelope(fixture);
    if (!envelope) {
      throw new ApplicationError('INGESTION_INVALID_FIXTURE', 'Fixture must be an object with a posts array.', 400);
    }

    const accepted: AcceptedEntry[] = [];
    const seen = new Set<string>();
    let rejectedCount = 0;

    const reject = (index: number, reasonCode: EntryRejectedReason, externalId?: string): void => {
      rejectedCount += 1;
      this.deps.events.entryRejected({ businessRef, entryIndex: index, reasonCode, ...(externalId ? { externalId } : {}) });
    };

    envelope.posts.forEach((post, index) => {
      const shape = asEntryShape(post);
      if (!shape) return reject(index, 'invalid_shape');

      const normalized = normalizePublication(
        { externalId: shape.externalId, caption: shape.caption, mediaType: shape.mediaType, occurredAt: shape.occurredAt },
        envelope.bio,
      );
      if (!normalized.ok) return reject(index, normalized.reasonCode, shape.externalId);

      if (seen.has(shape.externalId)) return reject(index, 'duplicate_external_id', shape.externalId);
      seen.add(shape.externalId);

      accepted.push({ externalId: shape.externalId, entry: post, payload: normalized.payload, extraction: normalized.extraction });
    });

    if (accepted.length === 0) {
      throw new ApplicationError('INGESTION_NO_VALID_ENTRIES', 'No valid fixture entries to ingest.', 422, {
        rejectedCount,
      });
    }

    const fixtureHash = fixtureIngestionKey(fixture);

    const result = await this.deps.uow.run(businessRef, async (repos: IngestionRepos) => {
      const existing = await repos.idempotency.find(businessRef, fixtureHash);
      if (existing) return { corpusRevisionId: existing, created: false as const };

      const now = this.deps.clock.now();
      const captures: RawCapture[] = [];
      const observations: NormalizedObservation[] = [];
      for (const a of accepted) {
        const capture = buildRawCapture({ source: SOURCE, externalId: a.externalId, entry: a.entry, capturedAt: now });
        const observation = buildObservation({ rawCaptureId: capture.id, payload: a.payload, extraction: a.extraction, capturedAt: now });
        captures.push(capture);
        observations.push(observation);
      }

      const observationIds = observations.map((o) => o.id);
      const revId = corpusRevisionId({ observationIds, activeFacetCorrectionIds: [] });
      const revision: CorpusRevision = {
        id: revId,
        businessRef,
        observationIds,
        activeFacetCorrectionIds: [],
        createdAt: now,
      };

      await repos.rawCaptures.appendMany(businessRef, captures);
      await repos.observations.appendMany(businessRef, observations);
      await repos.revisions.bumpCorpus(businessRef, revision);
      await repos.idempotency.put(businessRef, fixtureHash, revId);

      return { corpusRevisionId: revId, created: true as const };
    });

    if (result.created) {
      this.deps.events.revisionCreated({
        businessRef,
        corpusRevision: result.corpusRevisionId,
        observationCount: accepted.length,
        rejectedCount,
      });
    }

    return result.corpusRevisionId;
  }
}

/* ── envelope / entry shape guards (no zod dependency in the application layer) ── */
function asEnvelope(fixture: unknown): { posts: unknown[]; bio: string | undefined } | null {
  if (typeof fixture !== 'object' || fixture === null) return null;
  const obj = fixture as Record<string, unknown>;
  if (!Array.isArray(obj['posts'])) return null;
  const bio = typeof obj['bio'] === 'string' ? (obj['bio'] as string) : undefined;
  return { posts: obj['posts'] as unknown[], bio };
}

function asEntryShape(post: unknown): { externalId: string; caption: string; mediaType: string; occurredAt: string } | null {
  if (typeof post !== 'object' || post === null) return null;
  const p = post as Record<string, unknown>;
  const { externalId, caption, mediaType, occurredAt } = p;
  if (
    typeof externalId !== 'string' || externalId.length === 0 ||
    typeof caption !== 'string' ||
    typeof mediaType !== 'string' ||
    typeof occurredAt !== 'string'
  ) {
    return null;
  }
  return { externalId, caption, mediaType, occurredAt };
}
