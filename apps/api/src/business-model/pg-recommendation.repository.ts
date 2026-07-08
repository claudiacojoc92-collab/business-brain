/**
 * Pg recommendation repository (ADR-010 Layer 2) — persists the Recommendation PRODUCT PRIMITIVE
 * (memory.recommendations, V053): its disclosure contract (basis/assumptions/confidence/language)
 * referencing the Layer-1 `inferred` claim by id. The claim's inferred truth status is NOT copied here —
 * it stays in evidence.fragments; this table only holds the Layer-2 contract that wraps it. Idempotent
 * upsert per (founder, claim).
 */
import type { Recommendation } from './recommendation';
import type { StoredRecommendation } from './recommendation-service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export class PgRecommendationRepository {
  constructor(private readonly db: AnyDB) {}

  async save(founderId: string, rec: Recommendation, threadSignature: string | null): Promise<void> {
    const row = {
      founder_id: founderId,
      claim_fragment_id: rec.claim.id,
      thread_signature: threadSignature,
      evidence_basis: JSON.stringify(rec.contract.evidenceBasis),
      assumptions: JSON.stringify(rec.contract.assumptions),
      confidence: rec.contract.confidence,
      recommendation_text: rec.contract.recommendation,
    };
    await this.db
      .insertInto('memory.recommendations')
      .values(row)
      .onConflict((oc: AnyDB) => oc.columns(['founder_id', 'claim_fragment_id']).doUpdateSet({
        thread_signature: threadSignature,
        evidence_basis: row.evidence_basis,
        assumptions: row.assumptions,
        confidence: row.confidence,
        recommendation_text: row.recommendation_text,
      }))
      .execute();
  }

  async load(founderId: string): Promise<StoredRecommendation[]> {
    const rows = (await this.db.selectFrom('memory.recommendations').selectAll().where('founder_id', '=', founderId).execute()) as AnyDB[];
    const parse = (v: unknown): string[] => (typeof v === 'string' ? JSON.parse(v) as string[] : Array.isArray(v) ? (v as string[]) : []);
    return rows.map((r) => ({
      claimFragmentId: r.claim_fragment_id,
      threadSignature: r.thread_signature ?? null,
      evidenceBasis: parse(r.evidence_basis),
      assumptions: parse(r.assumptions),
      confidence: r.confidence,
      recommendationText: r.recommendation_text,
    }));
  }
}
