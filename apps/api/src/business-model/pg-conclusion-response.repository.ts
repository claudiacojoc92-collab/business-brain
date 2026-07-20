/**
 * Pg repository for founder conclusion responses (Wave 2 item 4, V060). Append-only with supersession:
 * recording a new response marks the prior EFFECTIVE response (superseded_by IS NULL) for that conclusion as
 * superseded, then inserts the new one — inside one transaction, so exactly one effective response exists per
 * (founder, conclusion) and full history is preserved. Never mutates the understanding synthesis.
 */
import { generateId } from '@bb/shared';
import type { ConclusionResponse, ResponseType } from './understanding';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export class PgConclusionResponseRepository {
  constructor(private readonly db: AnyDB) {}

  /** Append a response, superseding the prior effective one for this conclusion. Returns the new record.
   *  Accepts a caller tx so the response + any declared-evidence write commit atomically. */
  async record(args: {
    founderId: string; understandingId: string; conclusionId: string; type: ResponseType;
    acceptedText: string | null; qualificationText: string | null; correctionText: string | null; now: Date;
  }, tx?: unknown): Promise<ConclusionResponse> {
    const id = generateId();
    const run = async (db: AnyDB) => {
      await db.updateTable('business.conclusion_response').set({ superseded_by: id })
        .where('founder_id', '=', args.founderId).where('conclusion_id', '=', args.conclusionId).where('superseded_by', 'is', null).execute();
      await db.insertInto('business.conclusion_response').values({
        id, founder_id: args.founderId, understanding_id: args.understandingId, conclusion_id: args.conclusionId,
        response_type: args.type, accepted_text: args.acceptedText, qualification_text: args.qualificationText,
        correction_text: args.correctionText, superseded_by: null, created_at: args.now.toISOString(),
      }).execute();
    };
    if (tx) await run(tx as AnyDB); else await this.db.transaction().execute(run);
    return { id, conclusionId: args.conclusionId, type: args.type, acceptedText: args.acceptedText, qualificationText: args.qualificationText, correctionText: args.correctionText, at: args.now.toISOString(), supersededBy: null };
  }

  /** The single effective (non-superseded) response per conclusion → keyed by conclusionId. */
  async effectiveByConclusion(founderId: string): Promise<Map<string, ConclusionResponse>> {
    const rows = await this.db.selectFrom('business.conclusion_response').selectAll()
      .where('founder_id', '=', founderId).where('superseded_by', 'is', null).execute();
    const m = new Map<string, ConclusionResponse>();
    for (const r of rows as AnyDB[]) m.set(r.conclusion_id, this.toDomain(r));
    return m;
  }

  /** Conclusion ids whose effective response REVISED an earlier one (≥1 superseded response exists). */
  async revisedConclusionIds(founderId: string): Promise<Set<string>> {
    const rows = await this.db.selectFrom('business.conclusion_response').select('conclusion_id')
      .where('founder_id', '=', founderId).where('superseded_by', 'is not', null).execute();
    return new Set((rows as AnyDB[]).map((r) => r.conclusion_id as string));
  }

  /** Full history (all responses, oldest first) — for export. */
  async listByFounder(founderId: string): Promise<ConclusionResponse[]> {
    const rows = await this.db.selectFrom('business.conclusion_response').selectAll().where('founder_id', '=', founderId).orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }

  private toDomain(r: AnyDB): ConclusionResponse {
    return {
      id: r.id, conclusionId: r.conclusion_id, type: r.response_type as ResponseType,
      acceptedText: r.accepted_text ?? null, qualificationText: r.qualification_text ?? null, correctionText: r.correction_text ?? null,
      at: new Date(r.created_at).toISOString(), supersededBy: r.superseded_by ?? null,
    };
  }
}
