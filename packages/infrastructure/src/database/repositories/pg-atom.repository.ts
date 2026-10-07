import type { KyselyDB } from '../client';
import type { IAtomRepository, BusinessAtom } from '@bb/application';

/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));

/** Licensed-atoms persistence (V083). Each atom keeps its exact source span (source_url + char offsets) so the
 *  provenance is answerable months later from the DB, without re-running extraction. Replace-on-fingerprint. */
export class PgAtomRepository implements IAtomRepository {
  constructor(private readonly db: KyselyDB) {}

  async latestFingerprint(businessId: string): Promise<string | null> {
    const row = (await (this.db as any)
      .selectFrom('workspace.business_atom')
      .select('source_fingerprint')
      .where('business_id', '=', businessId)
      .orderBy('extracted_at', 'desc')
      .limit(1)
      .executeTakeFirst()) as any;
    return row?.source_fingerprint ?? null;
  }

  async listAtoms(businessId: string): Promise<BusinessAtom[]> {
    const rows = (await (this.db as any)
      .selectFrom('workspace.business_atom').selectAll()
      .where('business_id', '=', businessId).orderBy('extracted_at', 'asc').execute()) as any[];
    return rows.map((r) => ({
      id: r.id, businessId: r.business_id, atomClass: r.atom_class, value: r.value,
      sourceRef: r.source_ref, sourceUrl: r.source_url, charStart: r.char_start, charEnd: r.char_end,
      sourceFingerprint: r.source_fingerprint, modelId: r.model_id ?? null, extractedAt: iso(r.extracted_at),
    }));
  }

  async replaceForBusiness(businessId: string, fingerprint: string, atoms: readonly BusinessAtom[]): Promise<void> {
    await (this.db as any).transaction().execute(async (tx: any) => {
      await tx.deleteFrom('workspace.business_atom').where('business_id', '=', businessId).execute();
      if (atoms.length) await tx.insertInto('workspace.business_atom').values(atoms.map((a) => ({
        id: a.id, business_id: businessId, atom_class: a.atomClass, value: a.value,
        source_ref: a.sourceRef, source_url: a.sourceUrl, char_start: a.charStart, char_end: a.charEnd,
        source_fingerprint: fingerprint, model_id: a.modelId, extracted_at: a.extractedAt,
      }))).execute();
      // An all-empty extraction records no row, so latestFingerprint returns null and re-extracts next call —
      // the same (rare, harmless) tradeoff as proof_fact; never produces wrong data.
    });
  }
}
