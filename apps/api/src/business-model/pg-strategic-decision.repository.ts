/**
 * Pg repository for Strategic Decision Records (V072). Strictly APPEND-ONLY (mirrors the Founder-Strategic-Context
 * discipline): each row is an immutable revision keyed by (founder, logical_decision_id, revision); no method issues an
 * UPDATE (a BEFORE-UPDATE trigger forbids it at the DB). Effective status is derived from the latest revision's
 * lifecycle. Creation is idempotent on (founder, idempotency_key). Founder-isolated by construction.
 */
import { generateId } from '@bb/shared';
import { statusFromLifecycle, buildDecisionFields, type StrategicDecisionRecord, type DecisionInput, type DecisionLifecycle } from './strategic-decision';
import type { StrategicSession } from './strategy';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export class PgStrategicDecisionRepository {
  constructor(private readonly db: AnyDB) {}

  private row(fields: ReturnType<typeof buildDecisionFields>, base: { founderId: string; logicalDecisionId: string; revision: number; lifecycle: DecisionLifecycle; supersedesId: string | null; decidedAt: string }) {
    return {
      id: generateId(), founder_id: base.founderId, logical_decision_id: base.logicalDecisionId, revision: base.revision,
      lifecycle: base.lifecycle, supersedes_id: base.supersedesId,
      chosen_option: JSON.stringify(fields.chosenOption), decision_statement: fields.decisionStatement, rationale: fields.rationale,
      alternatives_considered: JSON.stringify(fields.alternativesConsidered), trade_offs_accepted: JSON.stringify(fields.tradeOffsAccepted),
      acknowledged_insufficient_evidence: fields.acknowledgedInsufficientEvidence, review_trigger: fields.reviewTrigger,
      recommendation_session_id: fields.recommendationSessionId, recommendation_schema_version: fields.recommendationSchemaVersion,
      provenance_manifest_version: fields.provenanceManifestVersion, business_understanding_version: fields.businessUnderstandingVersion,
      decision_horizon: fields.decisionHorizon, alignment: fields.alignment, grounding_status_at_decision: fields.groundingStatusAtDecision,
      scope: fields.scope, reversibility: fields.reversibility, uncertainty: JSON.stringify(fields.uncertainty),
      authorship: JSON.stringify(fields.authorship), idempotency_key: fields.idempotencyKey,
      decided_at: base.decidedAt, review_at: fields.reviewAt,
    };
  }

  /** Create a NEW logical decision (revision 1, lifecycle CREATE). Idempotent on (founder, idempotency_key). */
  async create(founderId: string, session: StrategicSession, input: DecisionInput, now: Date): Promise<StrategicDecisionRecord> {
    const existing = await this.byIdempotencyKey(founderId, input.idempotencyKey);
    if (existing) return existing; // idempotent — a retried create returns the same record, never a duplicate
    const fields = buildDecisionFields(session, input);
    const values = this.row(fields, { founderId, logicalDecisionId: generateId(), revision: 1, lifecycle: 'CREATE', supersedesId: null, decidedAt: now.toISOString() });
    try {
      const inserted = await this.db.insertInto('business.strategic_decision_record').values(values).returningAll().executeTakeFirst();
      return this.toDomain(inserted, 'ACTIVE');
    } catch (e) {
      const again = await this.byIdempotencyKey(founderId, input.idempotencyKey); // lost an idempotency race → return the winner
      if (again) return again;
      throw e;
    }
  }

  /** Append a SUPERSEDE revision (a new choice replaces the prior one). Returns null if the logical decision is unknown
   *  or already terminal (REVERSED/RETIRED). */
  async supersede(founderId: string, logicalDecisionId: string, session: StrategicSession, input: DecisionInput, now: Date): Promise<StrategicDecisionRecord | null> {
    return this.appendRevision(founderId, logicalDecisionId, 'SUPERSEDE', now, () => buildDecisionFields(session, input), input.idempotencyKey);
  }

  /** Append a terminal REVERSE revision (founder undoes the decision), copying prior content + an optional note. */
  async reverse(founderId: string, logicalDecisionId: string, note: string | null, idempotencyKey: string, now: Date): Promise<StrategicDecisionRecord | null> {
    return this.appendTerminal(founderId, logicalDecisionId, 'REVERSE', note, idempotencyKey, now);
  }
  /** Append a terminal RETIRE revision (founder ends the decision), copying prior content + an optional note. */
  async retire(founderId: string, logicalDecisionId: string, note: string | null, idempotencyKey: string, now: Date): Promise<StrategicDecisionRecord | null> {
    return this.appendTerminal(founderId, logicalDecisionId, 'RETIRE', note, idempotencyKey, now);
  }

  private async appendRevision(founderId: string, logicalDecisionId: string, lifecycle: DecisionLifecycle, now: Date, fieldsFn: () => ReturnType<typeof buildDecisionFields>, idempotencyKey: string): Promise<StrategicDecisionRecord | null> {
    const existing = await this.byIdempotencyKey(founderId, idempotencyKey);
    if (existing) return existing;
    const cur = await this.latest(founderId, logicalDecisionId);
    if (!cur || cur.lifecycle === 'REVERSE' || cur.lifecycle === 'RETIRE') return null; // unknown or already terminal
    const fields = fieldsFn();
    const values = this.row(fields, { founderId, logicalDecisionId, revision: Number(cur.revision) + 1, lifecycle, supersedesId: cur.id, decidedAt: now.toISOString() });
    const inserted = await this.db.insertInto('business.strategic_decision_record').values(values).returningAll().executeTakeFirst();
    return this.toDomain(inserted, statusFromLifecycle(lifecycle));
  }

  private async appendTerminal(founderId: string, logicalDecisionId: string, lifecycle: 'REVERSE' | 'RETIRE', note: string | null, idempotencyKey: string, now: Date): Promise<StrategicDecisionRecord | null> {
    const existing = await this.byIdempotencyKey(founderId, idempotencyKey);
    if (existing) return existing;
    const cur = await this.latest(founderId, logicalDecisionId);
    if (!cur) return null;
    if (cur.lifecycle === 'REVERSE' || cur.lifecycle === 'RETIRE') return null; // already terminal — append-only, no re-terminate
    const prior = this.toDomain(cur, 'ACTIVE');
    // copy the prior decision content into the terminal version; the note is a founder-authored lifecycle reason.
    const values = {
      id: generateId(), founder_id: founderId, logical_decision_id: logicalDecisionId, revision: Number(cur.revision) + 1,
      lifecycle, supersedes_id: cur.id,
      chosen_option: JSON.stringify(prior.chosenOption), decision_statement: prior.decisionStatement,
      rationale: note != null && note.trim() ? note.trim().slice(0, 4000) : prior.rationale,
      alternatives_considered: JSON.stringify(prior.alternativesConsidered), trade_offs_accepted: JSON.stringify(prior.tradeOffsAccepted),
      acknowledged_insufficient_evidence: prior.acknowledgedInsufficientEvidence, review_trigger: prior.reviewTrigger,
      recommendation_session_id: prior.recommendationSessionId, recommendation_schema_version: prior.recommendationSchemaVersion,
      provenance_manifest_version: prior.provenanceManifestVersion, business_understanding_version: prior.businessUnderstandingVersion,
      decision_horizon: prior.decisionHorizon, alignment: prior.alignment, grounding_status_at_decision: prior.groundingStatusAtDecision,
      scope: prior.scope, reversibility: prior.reversibility, uncertainty: JSON.stringify(prior.uncertainty),
      authorship: JSON.stringify(prior.authorship), idempotency_key: idempotencyKey, decided_at: now.toISOString(), review_at: prior.reviewAt,
    };
    const inserted = await this.db.insertInto('business.strategic_decision_record').values(values).returningAll().executeTakeFirst();
    return this.toDomain(inserted, statusFromLifecycle(lifecycle));
  }

  /** All EFFECTIVE decisions for a founder (latest revision per logical decision), newest first. */
  async listByFounder(founderId: string): Promise<StrategicDecisionRecord[]> {
    const rows = await this.db.selectFrom('business.strategic_decision_record').selectAll().where('founder_id', '=', founderId).orderBy('logical_decision_id').orderBy('revision', 'desc').execute();
    const seen = new Set<string>(); const effective: StrategicDecisionRecord[] = [];
    for (const r of rows as AnyDB[]) { if (seen.has(r.logical_decision_id)) continue; seen.add(r.logical_decision_id); effective.push(this.toDomain(r, statusFromLifecycle(r.lifecycle))); }
    return effective.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** The full revision history for one logical decision (oldest→newest), each with its derived status. */
  async getHistory(founderId: string, logicalDecisionId: string): Promise<StrategicDecisionRecord[]> {
    const rows = await this.db.selectFrom('business.strategic_decision_record').selectAll().where('founder_id', '=', founderId).where('logical_decision_id', '=', logicalDecisionId).orderBy('revision', 'asc').execute();
    const arr = rows as AnyDB[]; if (!arr.length) return [];
    const latestLifecycle = arr[arr.length - 1]!.lifecycle as DecisionLifecycle;
    return arr.map((r, i) => this.toDomain(r, i === arr.length - 1 ? statusFromLifecycle(latestLifecycle) : 'SUPERSEDED'));
  }

  /** The effective (latest) revision for one logical decision, or null. */
  async getEffective(founderId: string, logicalDecisionId: string): Promise<StrategicDecisionRecord | null> {
    const cur = await this.latest(founderId, logicalDecisionId);
    return cur ? this.toDomain(cur, statusFromLifecycle(cur.lifecycle as DecisionLifecycle)) : null;
  }

  private async latest(founderId: string, logicalDecisionId: string): Promise<AnyDB | null> {
    return (await this.db.selectFrom('business.strategic_decision_record').selectAll().where('founder_id', '=', founderId).where('logical_decision_id', '=', logicalDecisionId).orderBy('revision', 'desc').limit(1).executeTakeFirst()) ?? null;
  }
  private async byIdempotencyKey(founderId: string, key: string): Promise<StrategicDecisionRecord | null> {
    if (!key?.trim()) return null;
    const r = await this.db.selectFrom('business.strategic_decision_record').selectAll().where('founder_id', '=', founderId).where('idempotency_key', '=', key).executeTakeFirst();
    if (!r) return null;
    // its derived status depends on whether a later revision exists in the same logical decision
    const cur = await this.latest(founderId, r.logical_decision_id);
    const isLatest = cur && cur.id === r.id;
    return this.toDomain(r, isLatest ? statusFromLifecycle(cur.lifecycle as DecisionLifecycle) : 'SUPERSEDED');
  }

  private toDomain(r: AnyDB, status: StrategicDecisionRecord['status']): StrategicDecisionRecord {
    const json = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
    const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
    return {
      id: r.id, founderId: r.founder_id, logicalDecisionId: r.logical_decision_id, revision: Number(r.revision), lifecycle: r.lifecycle,
      supersedesId: r.supersedes_id ?? null,
      chosenOption: json(r.chosen_option), decisionStatement: r.decision_statement, rationale: r.rationale ?? null,
      alternativesConsidered: json(r.alternatives_considered) ?? [], tradeOffsAccepted: json(r.trade_offs_accepted) ?? [],
      acknowledgedInsufficientEvidence: r.acknowledged_insufficient_evidence === true, reviewTrigger: r.review_trigger ?? null,
      recommendationSessionId: r.recommendation_session_id ?? null, recommendationSchemaVersion: r.recommendation_schema_version ?? null,
      provenanceManifestVersion: r.provenance_manifest_version ?? null, businessUnderstandingVersion: r.business_understanding_version == null ? null : Number(r.business_understanding_version),
      decisionHorizon: r.decision_horizon ?? null, alignment: r.alignment, groundingStatusAtDecision: r.grounding_status_at_decision ?? null,
      scope: r.scope, reversibility: r.reversibility, uncertainty: json(r.uncertainty), authorship: json(r.authorship) ?? {},
      idempotencyKey: r.idempotency_key, decidedAt: iso(r.decided_at)!, reviewAt: iso(r.review_at), createdAt: iso(r.created_at)!, status,
    };
  }
}
