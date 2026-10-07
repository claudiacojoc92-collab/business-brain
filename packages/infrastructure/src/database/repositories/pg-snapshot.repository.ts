import type { KyselyDB } from '../client';
import type {
  BusinessSnapshotVersion,
  SnapshotRepository,
  SnapshotStatement,
  SubjectRef,
} from '@bb/domain';
import { businessRefKey } from '@bb/domain';

/**
 * Immutable BusinessSnapshotVersion store. A version + its observed statements are written atomically
 * (append-only; idempotent by (business_ref, id)); versions are never mutated. Business-scoped.
 * `declaredContext` is stored on the version row (empty in Commit 4). Review/recognition/status are
 * NOT stored here (derived elsewhere in a later commit).
 */
export class PgSnapshotRepository implements SnapshotRepository {
  constructor(private readonly db: KyselyDB) {}

  async save(businessRef: SubjectRef, version: BusinessSnapshotVersion): Promise<void> {
    const brk = businessRefKey(businessRef);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.db as any;

    // Version-level conflict detection: same id + different content fails loudly (never a silent
    // ON CONFLICT DO NOTHING). Equivalent content is an idempotent replay.
    const existingV = await db
      .selectFrom('understanding.snapshot_version')
      .select(['corpus_revision_id', 'understanding_ctx_revision_id', 'declared_context'])
      .where('business_ref', '=', brk)
      .where('id', '=', version.id)
      .executeTakeFirst();
    if (existingV) {
      if (versionSig(existingV.corpus_revision_id, existingV.understanding_ctx_revision_id, normJson(existingV.declared_context))
        !== versionSig(version.corpusRevision, version.understandingContextRevision, JSON.stringify(version.declaredContext))) {
        throw new Error(`snapshot version content conflict for id ${version.id} (business ${brk})`);
      }
    } else {
      await db
        .insertInto('understanding.snapshot_version')
        .values({
          business_ref: brk,
          id: version.id,
          corpus_revision_id: version.corpusRevision,
          understanding_ctx_revision_id: version.understandingContextRevision,
          generation_profile_version: 'understanding.snapshot.physio_movement.v1',
          declared_context: JSON.stringify(version.declaredContext),
          created_at: version.createdAt,
          supersedes: version.supersedes ?? null,
        })
        .execute();
    }

    let ordinal = 0;
    for (const s of version.observedStatements) {
      const ord = ordinal++;
      const existingS = await db
        .selectFrom('understanding.snapshot_statement')
        .selectAll()
        .where('business_ref', '=', brk)
        .where('snapshot_id', '=', version.id)
        .where('version_id', '=', s.versionId)
        .executeTakeFirst();
      if (existingS) {
        // Content-addressed: same version_id must carry identical content AND ordering (ordinal).
        if (rowStmtSig(existingS) !== domainStmtSig(s, ord)) {
          throw new Error(`snapshot statement content conflict for id ${s.versionId} (business ${brk})`);
        }
        continue;
      }
      await db
        .insertInto('understanding.snapshot_statement')
        .values({
          business_ref: brk,
          snapshot_id: version.id,
          version_id: s.versionId,
          ordinal: ord,
          semantic_key: s.semanticKey,
          definition_key: s.definitionKey,
          definition_version: s.definitionVersion,
          subject_type: s.subject.type,
          subject_id: s.subject.id,
          params: JSON.stringify(s.params),
          scope: JSON.stringify(s.scope),
          confidence: s.confidence,
          provenance_kind: s.provenanceKind,
          observation_ids: JSON.stringify(s.observationIds),
          uncertainty: JSON.stringify(s.uncertainty),
          unknown_basis: s.unknownBasis ? JSON.stringify(s.unknownBasis) : null,
        })
        .execute();
    }
  }

  async byId(businessRef: SubjectRef, id: string): Promise<BusinessSnapshotVersion | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('understanding.snapshot_version')
      .selectAll()
      .where('business_ref', '=', businessRefKey(businessRef))
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return null;
    return this.hydrate(businessRef, row);
  }

  async current(businessRef: SubjectRef): Promise<BusinessSnapshotVersion | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('understanding.snapshot_version')
      .selectAll()
      .where('business_ref', '=', businessRefKey(businessRef))
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!row) return null;
    return this.hydrate(businessRef, row);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async hydrate(businessRef: SubjectRef, versionRow: any): Promise<BusinessSnapshotVersion> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stmtRows = (await (this.db as any)
      .selectFrom('understanding.snapshot_statement')
      .selectAll()
      .where('business_ref', '=', businessRefKey(businessRef))
      .where('snapshot_id', '=', versionRow.id)
      .orderBy('ordinal', 'asc')
      .execute()) as unknown[];
    return {
      id: versionRow.id,
      businessRef,
      corpusRevision: versionRow.corpus_revision_id,
      understandingContextRevision: versionRow.understanding_ctx_revision_id,
      observedStatements: stmtRows.map((r) => toStatement(r)),
      declaredContext: parseJson(versionRow.declared_context, []),
      createdAt: typeof versionRow.created_at === 'string' ? versionRow.created_at : new Date(versionRow.created_at).toISOString(),
      ...(versionRow.supersedes ? { supersedes: versionRow.supersedes } : {}),
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toStatement(r: any): SnapshotStatement {
  return {
    semanticKey: r.semantic_key,
    versionId: r.version_id,
    definitionKey: r.definition_key,
    definitionVersion: Number(r.definition_version),
    subject: { type: r.subject_type, id: r.subject_id },
    params: parseJson(r.params, {}),
    scope: parseJson(r.scope, { sources: [], window: '', corpusSize: 0 }),
    confidence: r.confidence,
    provenanceKind: 'observed',
    observationIds: parseJson(r.observation_ids, []),
    uncertainty: parseJson(r.uncertainty, []),
    ...(r.unknown_basis ? { unknownBasis: parseJson(r.unknown_basis, undefined) } : {}),
  };
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  return (typeof v === 'string' ? JSON.parse(v) : v) as T;
}

/** Canonicalize a jsonb column (string or object) to a stable string for content comparison. */
function normJson(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return JSON.stringify(typeof v === 'string' ? JSON.parse(v) : v);
}

function versionSig(corpus: string, ctx: string, declared: string | null): string {
  return JSON.stringify([corpus, ctx, declared]);
}

function domainStmtSig(s: SnapshotStatement, ordinal: number): string {
  return JSON.stringify([
    ordinal, s.semanticKey, s.definitionKey, s.definitionVersion, s.subject.type, s.subject.id,
    JSON.stringify(s.params), JSON.stringify(s.scope), s.confidence, s.provenanceKind,
    JSON.stringify(s.observationIds), JSON.stringify(s.uncertainty), s.unknownBasis ? JSON.stringify(s.unknownBasis) : null,
  ]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowStmtSig(r: any): string {
  return JSON.stringify([
    Number(r.ordinal), r.semantic_key, r.definition_key, Number(r.definition_version), r.subject_type, r.subject_id,
    normJson(r.params), normJson(r.scope), r.confidence, r.provenance_kind,
    normJson(r.observation_ids), normJson(r.uncertainty), r.unknown_basis ? normJson(r.unknown_basis) : null,
  ]);
}
