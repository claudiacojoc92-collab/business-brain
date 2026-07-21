/**
 * Pg repository for Strategic Commitment Records (V073). Strictly APPEND-ONLY (mirrors the Strategic-Decision
 * discipline): each row is an immutable revision keyed by (founder, logical_commitment_id, revision); no method issues an
 * UPDATE (a BEFORE-UPDATE trigger forbids it). Effective status is derived from the latest revision's lifecycle, plus a
 * read-time EXPIRED derivation from expires_at. Creation is idempotent on (founder, idempotency_key). Founder-isolated.
 */
import { generateId } from '@bb/shared';
import { effectiveStatus, buildCommitmentFields, type StrategicCommitmentRecord, type CommitmentInput, type CommitmentLifecycle } from './strategic-commitment';
import type { StrategicDecisionRecord } from './strategic-decision';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export class PgStrategicCommitmentRepository {
  constructor(private readonly db: AnyDB) {}

  private values(fields: ReturnType<typeof buildCommitmentFields>, base: { founderId: string; logicalCommitmentId: string; revision: number; lifecycle: CommitmentLifecycle; supersedesId: string | null }) {
    return {
      id: generateId(), founder_id: base.founderId, logical_commitment_id: base.logicalCommitmentId, revision: base.revision,
      lifecycle: base.lifecycle, supersedes_id: base.supersedesId,
      decision_record_id: fields.decisionRecordId, decision_logical_id: fields.decisionLogicalId, decision_revision: fields.decisionRevision, decision_schema_version: fields.decisionSchemaVersion,
      recommendation_session_id: fields.recommendationSessionId, recommendation_schema_version: fields.recommendationSchemaVersion, provenance_manifest_version: fields.provenanceManifestVersion,
      alignment_at_commitment: fields.alignmentAtCommitment, grounding_status_at_commitment: fields.groundingStatusAtCommitment,
      statement: fields.statement, scope: fields.scope, exclusivity: fields.exclusivity,
      governed_behavior: JSON.stringify(fields.governedBehavior), resource_envelope: JSON.stringify(fields.resourceEnvelope),
      accepted_costs: JSON.stringify(fields.acceptedCosts), unknown_costs: JSON.stringify(fields.unknownCosts),
      exit_conditions: JSON.stringify(fields.exitConditions), reconsideration_conditions: JSON.stringify(fields.reconsiderationConditions),
      acknowledged_insufficient_evidence: fields.acknowledgedInsufficientEvidence,
      starts_at: fields.startsAt, review_at: fields.reviewAt, review_trigger: fields.reviewTrigger, expires_at: fields.expiresAt,
      authorship: JSON.stringify(fields.authorship), idempotency_key: fields.idempotencyKey,
    };
  }

  /** Create a NEW logical commitment (revision 1, CREATE) from an effective decision. Idempotent on (founder, key). */
  async create(founderId: string, decision: StrategicDecisionRecord, input: CommitmentInput, now: Date): Promise<StrategicCommitmentRecord> {
    const existing = await this.byIdempotencyKey(founderId, input.idempotencyKey, now);
    if (existing) return existing;
    const fields = buildCommitmentFields(decision, input, now);
    const values = this.values(fields, { founderId, logicalCommitmentId: generateId(), revision: 1, lifecycle: 'CREATE', supersedesId: null });
    try {
      const inserted = await this.db.insertInto('business.strategic_commitment_record').values(values).returningAll().executeTakeFirst();
      return this.toDomain(inserted, 'CREATE', now);
    } catch (e) {
      const again = await this.byIdempotencyKey(founderId, input.idempotencyKey, now);
      if (again) return again;
      throw e;
    }
  }

  /** Append a SUPERSEDE revision (a new commitment replaces the prior). Null if unknown or already terminal. */
  async supersede(founderId: string, logicalCommitmentId: string, decision: StrategicDecisionRecord, input: CommitmentInput, now: Date): Promise<StrategicCommitmentRecord | null> {
    const existing = await this.byIdempotencyKey(founderId, input.idempotencyKey, now);
    if (existing) return existing;
    const cur = await this.latest(founderId, logicalCommitmentId);
    if (!cur || cur.lifecycle === 'RELEASE' || cur.lifecycle === 'RETIRE') return null;
    const fields = buildCommitmentFields(decision, input, now);
    const values = this.values(fields, { founderId, logicalCommitmentId, revision: Number(cur.revision) + 1, lifecycle: 'SUPERSEDE', supersedesId: cur.id });
    const inserted = await this.db.insertInto('business.strategic_commitment_record').values(values).returningAll().executeTakeFirst();
    return this.toDomain(inserted, 'SUPERSEDE', now);
  }

  async release(founderId: string, logicalCommitmentId: string, note: string | null, idempotencyKey: string, now: Date): Promise<StrategicCommitmentRecord | null> {
    return this.appendTerminal(founderId, logicalCommitmentId, 'RELEASE', note, idempotencyKey, now);
  }
  async retire(founderId: string, logicalCommitmentId: string, note: string | null, idempotencyKey: string, now: Date): Promise<StrategicCommitmentRecord | null> {
    return this.appendTerminal(founderId, logicalCommitmentId, 'RETIRE', note, idempotencyKey, now);
  }

  private async appendTerminal(founderId: string, logicalCommitmentId: string, lifecycle: 'RELEASE' | 'RETIRE', note: string | null, idempotencyKey: string, now: Date): Promise<StrategicCommitmentRecord | null> {
    const existing = await this.byIdempotencyKey(founderId, idempotencyKey, now);
    if (existing) return existing;
    const cur = await this.latest(founderId, logicalCommitmentId);
    if (!cur || cur.lifecycle === 'RELEASE' || cur.lifecycle === 'RETIRE') return null;
    const prior = this.toDomain(cur, cur.lifecycle as CommitmentLifecycle, now);
    // copy prior content into the terminal version; the note is a founder-authored lifecycle reason (neutral).
    const values = {
      id: generateId(), founder_id: founderId, logical_commitment_id: logicalCommitmentId, revision: Number(cur.revision) + 1,
      lifecycle, supersedes_id: cur.id,
      decision_record_id: prior.decisionRecordId, decision_logical_id: prior.decisionLogicalId, decision_revision: prior.decisionRevision, decision_schema_version: prior.decisionSchemaVersion,
      recommendation_session_id: prior.recommendationSessionId, recommendation_schema_version: prior.recommendationSchemaVersion, provenance_manifest_version: prior.provenanceManifestVersion,
      alignment_at_commitment: prior.alignmentAtCommitment, grounding_status_at_commitment: prior.groundingStatusAtCommitment,
      statement: prior.statement, scope: prior.scope, exclusivity: prior.exclusivity,
      governed_behavior: JSON.stringify(prior.governedBehavior), resource_envelope: JSON.stringify(prior.resourceEnvelope),
      accepted_costs: JSON.stringify(prior.acceptedCosts), unknown_costs: JSON.stringify(prior.unknownCosts),
      exit_conditions: JSON.stringify(prior.exitConditions), reconsideration_conditions: JSON.stringify(prior.reconsiderationConditions),
      acknowledged_insufficient_evidence: prior.acknowledgedInsufficientEvidence,
      starts_at: prior.startsAt, review_at: prior.reviewAt, review_trigger: note != null && note.trim() ? note.trim().slice(0, 1000) : prior.reviewTrigger, expires_at: prior.expiresAt,
      authorship: JSON.stringify(prior.authorship), idempotency_key: idempotencyKey,
    };
    const inserted = await this.db.insertInto('business.strategic_commitment_record').values(values).returningAll().executeTakeFirst();
    return this.toDomain(inserted, lifecycle, now);
  }

  /** All EFFECTIVE commitments (latest revision per logical commitment), newest first, with derived status. */
  async listByFounder(founderId: string, now: Date): Promise<StrategicCommitmentRecord[]> {
    const rows = await this.db.selectFrom('business.strategic_commitment_record').selectAll().where('founder_id', '=', founderId).orderBy('logical_commitment_id').orderBy('revision', 'desc').execute();
    const seen = new Set<string>(); const eff: StrategicCommitmentRecord[] = [];
    for (const r of rows as AnyDB[]) { if (seen.has(r.logical_commitment_id)) continue; seen.add(r.logical_commitment_id); eff.push(this.toDomain(r, r.lifecycle as CommitmentLifecycle, now)); }
    return eff.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async getHistory(founderId: string, logicalCommitmentId: string, now: Date): Promise<StrategicCommitmentRecord[]> {
    const rows = await this.db.selectFrom('business.strategic_commitment_record').selectAll().where('founder_id', '=', founderId).where('logical_commitment_id', '=', logicalCommitmentId).orderBy('revision', 'asc').execute();
    const arr = rows as AnyDB[]; if (!arr.length) return [];
    return arr.map((r, i) => (i === arr.length - 1 ? this.toDomain(r, r.lifecycle as CommitmentLifecycle, now) : this.toDomainWith(r, 'SUPERSEDED')));
  }

  async getEffective(founderId: string, logicalCommitmentId: string, now: Date): Promise<StrategicCommitmentRecord | null> {
    const cur = await this.latest(founderId, logicalCommitmentId);
    return cur ? this.toDomain(cur, cur.lifecycle as CommitmentLifecycle, now) : null;
  }

  private async latest(founderId: string, logicalCommitmentId: string): Promise<AnyDB | null> {
    return (await this.db.selectFrom('business.strategic_commitment_record').selectAll().where('founder_id', '=', founderId).where('logical_commitment_id', '=', logicalCommitmentId).orderBy('revision', 'desc').limit(1).executeTakeFirst()) ?? null;
  }
  private async byIdempotencyKey(founderId: string, key: string, now: Date): Promise<StrategicCommitmentRecord | null> {
    if (!key?.trim()) return null;
    const r = await this.db.selectFrom('business.strategic_commitment_record').selectAll().where('founder_id', '=', founderId).where('idempotency_key', '=', key).executeTakeFirst();
    if (!r) return null;
    const cur = await this.latest(founderId, r.logical_commitment_id);
    return cur && cur.id === r.id ? this.toDomain(r, r.lifecycle as CommitmentLifecycle, now) : this.toDomainWith(r, 'SUPERSEDED');
  }

  private toDomain(r: AnyDB, latestLifecycle: CommitmentLifecycle, now: Date): StrategicCommitmentRecord {
    return this.toDomainWith(r, effectiveStatus(latestLifecycle, r.expires_at ? new Date(r.expires_at as string).toISOString() : null, now));
  }
  private toDomainWith(r: AnyDB, status: StrategicCommitmentRecord['status']): StrategicCommitmentRecord {
    const json = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
    const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
    return {
      id: r.id, founderId: r.founder_id, logicalCommitmentId: r.logical_commitment_id, revision: Number(r.revision), lifecycle: r.lifecycle,
      supersedesId: r.supersedes_id ?? null,
      decisionRecordId: r.decision_record_id, decisionLogicalId: r.decision_logical_id, decisionRevision: Number(r.decision_revision), decisionSchemaVersion: r.decision_schema_version,
      recommendationSessionId: r.recommendation_session_id ?? null, recommendationSchemaVersion: r.recommendation_schema_version ?? null, provenanceManifestVersion: r.provenance_manifest_version ?? null,
      alignmentAtCommitment: r.alignment_at_commitment, groundingStatusAtCommitment: r.grounding_status_at_commitment ?? null,
      statement: r.statement, scope: r.scope, exclusivity: r.exclusivity,
      governedBehavior: json(r.governed_behavior) ?? [], resourceEnvelope: json(r.resource_envelope) ?? [], acceptedCosts: json(r.accepted_costs) ?? [], unknownCosts: json(r.unknown_costs) ?? [],
      exitConditions: json(r.exit_conditions) ?? [], reconsiderationConditions: json(r.reconsideration_conditions) ?? [], acknowledgedInsufficientEvidence: r.acknowledged_insufficient_evidence === true,
      startsAt: iso(r.starts_at)!, reviewAt: iso(r.review_at), reviewTrigger: r.review_trigger ?? null, expiresAt: iso(r.expires_at),
      authorship: json(r.authorship) ?? {}, idempotencyKey: r.idempotency_key, createdAt: iso(r.created_at)!, status,
    };
  }
}
