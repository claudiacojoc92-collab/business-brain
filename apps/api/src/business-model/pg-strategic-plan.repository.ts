/**
 * Pg repository for Strategic Plan Records (V074). Strictly APPEND-ONLY (mirrors the Strategic-Commitment discipline):
 * each row is an immutable revision keyed by (founder, logical_plan_id, revision); no method issues an UPDATE (a
 * BEFORE-UPDATE trigger forbids it). Effective status is derived from the latest revision's lifecycle, plus a read-time
 * EXPIRED derivation from expires_at. Creation is idempotent on (founder, idempotency_key). Founder-isolated.
 */
import { generateId } from '@bb/shared';
import { effectiveStatus, buildPlanFields, type StrategicPlanRecord, type PlanInput, type PlanLifecycle, type PlanConflict } from './strategic-plan';
import type { StrategicCommitmentRecord } from './strategic-commitment';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export class PgStrategicPlanRepository {
  constructor(private readonly db: AnyDB) {}

  private values(fields: ReturnType<typeof buildPlanFields>, base: { founderId: string; logicalPlanId: string; revision: number; lifecycle: PlanLifecycle; supersedesId: string | null }) {
    return {
      id: generateId(), founder_id: base.founderId, logical_plan_id: base.logicalPlanId, revision: base.revision, lifecycle: base.lifecycle, supersedes_id: base.supersedesId,
      commitment_record_id: fields.commitmentRecordId, commitment_logical_id: fields.commitmentLogicalId, commitment_revision: fields.commitmentRevision, commitment_schema_version: fields.commitmentSchemaVersion,
      decision_record_id: fields.decisionRecordId, recommendation_session_id: fields.recommendationSessionId, provenance_manifest_version: fields.provenanceManifestVersion,
      business_understanding_version: fields.businessUnderstandingVersion, alignment_at_planning: fields.alignmentAtPlanning, grounding_status_at_planning: fields.groundingStatusAtPlanning,
      title: fields.title, strategic_intent: fields.strategicIntent, scope: fields.scope, planning_horizon: fields.planningHorizon,
      milestones: JSON.stringify(fields.milestones), assumptions: JSON.stringify(fields.assumptions), dependencies: JSON.stringify(fields.dependencies),
      resource_constraints: JSON.stringify(fields.resourceConstraints), review_conditions: JSON.stringify(fields.reviewConditions), exit_conditions: JSON.stringify(fields.exitConditions),
      no_milestone_rationale: fields.noMilestoneRationale, acknowledged_insufficient_evidence: fields.acknowledgedInsufficientEvidence,
      uncertainty_at_planning: JSON.stringify(fields.uncertaintyAtPlanning), conflicts: JSON.stringify(fields.conflicts), authorship: JSON.stringify(fields.authorship),
      expires_at: fields.expiresAt, activated_at: fields.activatedAt, idempotency_key: fields.idempotencyKey,
    };
  }

  /** Create + activate a NEW logical plan (revision 1, CREATE) from an effective commitment. Idempotent. */
  async create(founderId: string, commitment: StrategicCommitmentRecord, input: PlanInput, conflicts: PlanConflict[], now: Date): Promise<StrategicPlanRecord> {
    const existing = await this.byIdempotencyKey(founderId, input.idempotencyKey, now);
    if (existing) return existing;
    const values = this.values(buildPlanFields(commitment, input, conflicts, now), { founderId, logicalPlanId: generateId(), revision: 1, lifecycle: 'CREATE', supersedesId: null });
    try { return this.toDomain(await this.db.insertInto('business.strategic_plan_record').values(values).returningAll().executeTakeFirst(), 'CREATE', now); }
    catch (e) { const again = await this.byIdempotencyKey(founderId, input.idempotencyKey, now); if (again) return again; throw e; }
  }

  /** Append a SUPERSEDE revision (a new plan replaces the prior). Null if unknown or already terminal. */
  async supersede(founderId: string, logicalPlanId: string, commitment: StrategicCommitmentRecord, input: PlanInput, conflicts: PlanConflict[], now: Date): Promise<StrategicPlanRecord | null> {
    const existing = await this.byIdempotencyKey(founderId, input.idempotencyKey, now);
    if (existing) return existing;
    const cur = await this.latest(founderId, logicalPlanId);
    if (!cur || cur.lifecycle === 'RETIRE' || cur.lifecycle === 'CANCEL') return null;
    const values = this.values(buildPlanFields(commitment, input, conflicts, now), { founderId, logicalPlanId, revision: Number(cur.revision) + 1, lifecycle: 'SUPERSEDE', supersedesId: cur.id });
    return this.toDomain(await this.db.insertInto('business.strategic_plan_record').values(values).returningAll().executeTakeFirst(), 'SUPERSEDE', now);
  }

  async retire(founderId: string, logicalPlanId: string, note: string | null, key: string, now: Date): Promise<StrategicPlanRecord | null> { return this.appendTerminal(founderId, logicalPlanId, 'RETIRE', note, key, now); }
  async cancel(founderId: string, logicalPlanId: string, note: string | null, key: string, now: Date): Promise<StrategicPlanRecord | null> { return this.appendTerminal(founderId, logicalPlanId, 'CANCEL', note, key, now); }

  private async appendTerminal(founderId: string, logicalPlanId: string, lifecycle: 'RETIRE' | 'CANCEL', note: string | null, key: string, now: Date): Promise<StrategicPlanRecord | null> {
    const existing = await this.byIdempotencyKey(founderId, key, now);
    if (existing) return existing;
    const cur = await this.latest(founderId, logicalPlanId);
    if (!cur || cur.lifecycle === 'RETIRE' || cur.lifecycle === 'CANCEL') return null;
    const p = this.toDomain(cur, cur.lifecycle as PlanLifecycle, now);
    const values = {
      id: generateId(), founder_id: founderId, logical_plan_id: logicalPlanId, revision: Number(cur.revision) + 1, lifecycle, supersedes_id: cur.id,
      commitment_record_id: p.commitmentRecordId, commitment_logical_id: p.commitmentLogicalId, commitment_revision: p.commitmentRevision, commitment_schema_version: p.commitmentSchemaVersion,
      decision_record_id: p.decisionRecordId, recommendation_session_id: p.recommendationSessionId, provenance_manifest_version: p.provenanceManifestVersion,
      business_understanding_version: p.businessUnderstandingVersion, alignment_at_planning: p.alignmentAtPlanning, grounding_status_at_planning: p.groundingStatusAtPlanning,
      title: p.title, strategic_intent: p.strategicIntent, scope: p.scope, planning_horizon: p.planningHorizon,
      milestones: JSON.stringify(p.milestones), assumptions: JSON.stringify(p.assumptions), dependencies: JSON.stringify(p.dependencies),
      resource_constraints: JSON.stringify(p.resourceConstraints), review_conditions: JSON.stringify(p.reviewConditions), exit_conditions: JSON.stringify(p.exitConditions),
      no_milestone_rationale: note != null && note.trim() ? note.trim().slice(0, 1000) : p.noMilestoneRationale, acknowledged_insufficient_evidence: p.acknowledgedInsufficientEvidence,
      uncertainty_at_planning: JSON.stringify(p.uncertaintyAtPlanning), conflicts: JSON.stringify(p.conflicts), authorship: JSON.stringify(p.authorship),
      expires_at: p.expiresAt, activated_at: now.toISOString(), idempotency_key: key,
    };
    return this.toDomain(await this.db.insertInto('business.strategic_plan_record').values(values).returningAll().executeTakeFirst(), lifecycle, now);
  }

  async listByFounder(founderId: string, now: Date): Promise<StrategicPlanRecord[]> {
    const rows = await this.db.selectFrom('business.strategic_plan_record').selectAll().where('founder_id', '=', founderId).orderBy('logical_plan_id').orderBy('revision', 'desc').execute();
    const seen = new Set<string>(); const eff: StrategicPlanRecord[] = [];
    for (const r of rows as AnyDB[]) { if (seen.has(r.logical_plan_id)) continue; seen.add(r.logical_plan_id); eff.push(this.toDomain(r, r.lifecycle as PlanLifecycle, now)); }
    return eff.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  async getHistory(founderId: string, logicalPlanId: string, now: Date): Promise<StrategicPlanRecord[]> {
    const rows = await this.db.selectFrom('business.strategic_plan_record').selectAll().where('founder_id', '=', founderId).where('logical_plan_id', '=', logicalPlanId).orderBy('revision', 'asc').execute();
    const arr = rows as AnyDB[]; if (!arr.length) return [];
    return arr.map((r, i) => (i === arr.length - 1 ? this.toDomain(r, r.lifecycle as PlanLifecycle, now) : this.toDomainWith(r, 'SUPERSEDED')));
  }
  async getEffective(founderId: string, logicalPlanId: string, now: Date): Promise<StrategicPlanRecord | null> {
    const cur = await this.latest(founderId, logicalPlanId);
    return cur ? this.toDomain(cur, cur.lifecycle as PlanLifecycle, now) : null;
  }

  private async latest(founderId: string, logicalPlanId: string): Promise<AnyDB | null> {
    return (await this.db.selectFrom('business.strategic_plan_record').selectAll().where('founder_id', '=', founderId).where('logical_plan_id', '=', logicalPlanId).orderBy('revision', 'desc').limit(1).executeTakeFirst()) ?? null;
  }
  private async byIdempotencyKey(founderId: string, key: string, now: Date): Promise<StrategicPlanRecord | null> {
    if (!key?.trim()) return null;
    const r = await this.db.selectFrom('business.strategic_plan_record').selectAll().where('founder_id', '=', founderId).where('idempotency_key', '=', key).executeTakeFirst();
    if (!r) return null;
    const cur = await this.latest(founderId, r.logical_plan_id);
    return cur && cur.id === r.id ? this.toDomain(r, r.lifecycle as PlanLifecycle, now) : this.toDomainWith(r, 'SUPERSEDED');
  }

  private toDomain(r: AnyDB, latestLifecycle: PlanLifecycle, now: Date): StrategicPlanRecord {
    return this.toDomainWith(r, effectiveStatus(latestLifecycle, r.expires_at ? new Date(r.expires_at as string).toISOString() : null, now));
  }
  private toDomainWith(r: AnyDB, status: StrategicPlanRecord['status']): StrategicPlanRecord {
    const json = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
    const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
    return {
      id: r.id, founderId: r.founder_id, logicalPlanId: r.logical_plan_id, revision: Number(r.revision), lifecycle: r.lifecycle, supersedesId: r.supersedes_id ?? null,
      commitmentRecordId: r.commitment_record_id, commitmentLogicalId: r.commitment_logical_id, commitmentRevision: Number(r.commitment_revision), commitmentSchemaVersion: r.commitment_schema_version,
      decisionRecordId: r.decision_record_id ?? null, recommendationSessionId: r.recommendation_session_id ?? null, provenanceManifestVersion: r.provenance_manifest_version ?? null,
      businessUnderstandingVersion: r.business_understanding_version == null ? null : Number(r.business_understanding_version), alignmentAtPlanning: r.alignment_at_planning, groundingStatusAtPlanning: r.grounding_status_at_planning ?? null,
      title: r.title, strategicIntent: r.strategic_intent, scope: r.scope, planningHorizon: r.planning_horizon ?? null,
      milestones: json(r.milestones) ?? [], assumptions: json(r.assumptions) ?? [], dependencies: json(r.dependencies) ?? [], resourceConstraints: json(r.resource_constraints) ?? [],
      reviewConditions: json(r.review_conditions) ?? [], exitConditions: json(r.exit_conditions) ?? [], noMilestoneRationale: r.no_milestone_rationale ?? null,
      acknowledgedInsufficientEvidence: r.acknowledged_insufficient_evidence === true,
      uncertaintyAtPlanning: json(r.uncertainty_at_planning) ?? { groundingStatus: null, unknowns: [] }, conflicts: json(r.conflicts) ?? [], authorship: json(r.authorship) ?? {},
      expiresAt: iso(r.expires_at), activatedAt: iso(r.activated_at)!, idempotencyKey: r.idempotency_key, createdAt: iso(r.created_at)!, status,
    };
  }
}
