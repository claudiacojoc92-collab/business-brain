/**
 * Pg repository for Context Snapshots (V081, ADR-014). Strictly APPEND-ONLY + immutable (BEFORE-UPDATE + BEFORE-DELETE
 * triggers). A snapshot is the frozen Effective BU + Effective FSC a recommendation may consume. Writes to nothing else.
 * Founder-isolated.
 */
import { generateId } from '@bb/shared';
import { buildContextSnapshot, type ContextSnapshot, type FrozenBusinessUnderstanding, type FrozenFounderContext, type FrozenPublicPositioning, type SnapshotProvenance } from './context-snapshot';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export class PgContextSnapshotRepository {
  constructor(private readonly db: AnyDB) {}

  /** Freeze the supplied full governed reasoning input (BU + FSC + public-positioning) + provenance into a new snapshot. */
  async create(founderId: string, bu: FrozenBusinessUnderstanding, fsc: FrozenFounderContext, ppc: FrozenPublicPositioning, provenance: SnapshotProvenance, now: Date): Promise<ContextSnapshot> {
    const f = buildContextSnapshot(bu, fsc, ppc, provenance);
    const row = await this.db.insertInto('business.context_snapshot').values({
      id: generateId(), founder_id: founderId,
      business_understanding: JSON.stringify(f.businessUnderstanding),
      founder_strategic_context: JSON.stringify(f.founderStrategicContext),
      public_positioning_context: JSON.stringify(f.publicPositioningContext),
      provenance: JSON.stringify(f.provenance), content_hash: f.contentHash,
      payload_schema_version: f.payloadSchemaVersion, hash_algorithm: f.hashAlgorithm, created_at: now.toISOString(),
    }).returningAll().executeTakeFirst();
    return this.toDomain(row);
  }

  async getById(founderId: string, id: string): Promise<ContextSnapshot | null> {
    const r = await this.db.selectFrom('business.context_snapshot').selectAll().where('founder_id', '=', founderId).where('id', '=', id).executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }

  async list(founderId: string): Promise<ContextSnapshot[]> {
    const rows = await this.db.selectFrom('business.context_snapshot').selectAll().where('founder_id', '=', founderId).orderBy('created_at', 'desc').orderBy('id', 'desc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }

  private toDomain(r: AnyDB): ContextSnapshot {
    const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
    return {
      id: r.id, founderId: r.founder_id,
      businessUnderstanding: parse(r.business_understanding), founderStrategicContext: parse(r.founder_strategic_context),
      publicPositioningContext: parse(r.public_positioning_context), provenance: parse(r.provenance),
      payloadSchemaVersion: r.payload_schema_version, hashAlgorithm: r.hash_algorithm, contentHash: r.content_hash,
      createdAt: new Date(r.created_at as string).toISOString(),
    };
  }
}
