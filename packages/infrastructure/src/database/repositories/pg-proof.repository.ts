import type { KyselyDB } from '../client';
import type { IProofFactRepository, ProofFact, UnsourcedClaim } from '@bb/application';

/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));

/** Part 1 persistence — durable proof provenance (V080). Each proofFact keeps its source_url + anchor quote so
 *  "where did this come from" is answerable months later from the DB, without re-running extraction. */
export class PgProofRepository implements IProofFactRepository {
  constructor(private readonly db: KyselyDB) {}

  async latestFingerprint(businessId: string): Promise<string | null> {
    const row = (await (this.db as any)
      .selectFrom('workspace.proof_fact')
      .select('source_fingerprint')
      .where('business_id', '=', businessId)
      .orderBy('extracted_at', 'desc')
      .limit(1)
      .executeTakeFirst()) as any;
    // Also consider the unsourced table so an all-unsourced extraction (0 proofs) is still cached.
    const row2 = (await (this.db as any)
      .selectFrom('workspace.unsourced_claim')
      .select('source_fingerprint')
      .where('business_id', '=', businessId)
      .orderBy('extracted_at', 'desc')
      .limit(1)
      .executeTakeFirst()) as any;
    return row?.source_fingerprint ?? row2?.source_fingerprint ?? null;
  }

  async replaceForBusiness(businessId: string, fingerprint: string, proofs: ProofFact[], unsourced: UnsourcedClaim[]): Promise<void> {
    await (this.db as any).transaction().execute(async (tx: any) => {
      await tx.deleteFrom('workspace.proof_fact').where('business_id', '=', businessId).execute();
      await tx.deleteFrom('workspace.unsourced_claim').where('business_id', '=', businessId).execute();
      if (proofs.length) await tx.insertInto('workspace.proof_fact').values(proofs.map((p) => ({
        id: p.id, business_id: businessId, kind: p.kind, licensed_text: p.licensedText, anchor_quote: p.anchorQuote,
        attribution: p.attribution, source_ref: p.sourceRef, source_url: p.sourceUrl, source_fingerprint: fingerprint,
        model_id: p.modelId, extracted_at: p.extractedAt,
      }))).execute();
      if (unsourced.length) await tx.insertInto('workspace.unsourced_claim').values(unsourced.map((u) => ({
        id: u.id, business_id: businessId, claim_text: u.claimText, anchor_quote: u.anchorQuote, exclusion_reason: u.exclusionReason,
        source_ref: u.sourceRef, source_url: u.sourceUrl, source_fingerprint: fingerprint, extracted_at: u.extractedAt,
      }))).execute();
      // An empty extraction still records the fingerprint (so we do not re-run every call) via a marker row is
      // unnecessary: latestFingerprint falls back to null and re-extracts, but that only re-runs when BOTH tables
      // are empty — acceptable (rare) and never produces wrong data.
    });
  }

  async listProof(businessId: string): Promise<ProofFact[]> {
    const rows = (await (this.db as any)
      .selectFrom('workspace.proof_fact').selectAll()
      .where('business_id', '=', businessId).orderBy('extracted_at', 'asc').execute()) as any[];
    return rows.map((r) => ({
      id: r.id, businessId: r.business_id, kind: r.kind, licensedText: r.licensed_text, anchorQuote: r.anchor_quote,
      attribution: r.attribution ?? null, sourceRef: r.source_ref, sourceUrl: r.source_url,
      sourceFingerprint: r.source_fingerprint, modelId: r.model_id ?? null, extractedAt: iso(r.extracted_at),
    }));
  }

  async listUnsourced(businessId: string): Promise<UnsourcedClaim[]> {
    const rows = (await (this.db as any)
      .selectFrom('workspace.unsourced_claim').selectAll()
      .where('business_id', '=', businessId).orderBy('extracted_at', 'asc').execute()) as any[];
    return rows.map((r) => ({
      id: r.id, businessId: r.business_id, claimText: r.claim_text, anchorQuote: r.anchor_quote,
      exclusionReason: r.exclusion_reason, sourceRef: r.source_ref, sourceUrl: r.source_url,
      sourceFingerprint: r.source_fingerprint, extractedAt: iso(r.extracted_at),
    }));
  }
}
