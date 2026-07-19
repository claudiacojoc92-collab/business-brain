/**
 * Pg repository for founder market-finding responses (Wave 3 hardening, V063). Append-only with supersession,
 * mirroring the conclusion-response discipline: recording a new response marks the prior EFFECTIVE response
 * (superseded_at IS NULL) for that finding as superseded, then inserts the new one — in one transaction, so
 * exactly one effective response exists per (founder, finding) and full history is preserved. Source accuracy
 * and business relevance are kept as TWO independent dimensions. The underlying finding is never mutated.
 * Identical no-op re-submissions add no duplicate history.
 */
import { generateId } from '@bb/shared';
import type { AccuracyStatus, FindingResponseRecord, RelevanceResponseStatus } from './market-context';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export class PgMarketFindingResponseRepository {
  constructor(private readonly db: AnyDB) {}

  /** Append a response, superseding the prior effective one for this finding (one tx). An identical
   *  re-submission (same accuracy + relevance + both qualifications) is a no-op — returns the existing
   *  effective response, adds no new history row. */
  async record(args: {
    founderId: string; marketFindingId: string;
    accuratelyReflectsSource: AccuracyStatus; relevanceStatus: RelevanceResponseStatus;
    accuracyQualification: string | null; relevanceQualification: string | null; now: Date;
  }): Promise<FindingResponseRecord> {
    const prior = await this.effectiveByFindingId(args.founderId, args.marketFindingId);
    if (prior
      && prior.accuratelyReflectsSource === args.accuratelyReflectsSource
      && prior.relevanceStatus === args.relevanceStatus
      && (prior.accuracyQualification ?? null) === (args.accuracyQualification ?? null)
      && (prior.relevanceQualification ?? null) === (args.relevanceQualification ?? null)) {
      return prior; // identical no-op — preserve the single effective response, no duplicate history
    }
    const id = generateId();
    const nowIso = args.now.toISOString();
    await this.db.transaction().execute(async (tx: AnyDB) => {
      await tx.updateTable('business.market_finding_response').set({ superseded_at: nowIso })
        .where('founder_id', '=', args.founderId).where('market_finding_id', '=', args.marketFindingId).where('superseded_at', 'is', null).execute();
      await tx.insertInto('business.market_finding_response').values({
        id, founder_id: args.founderId, market_finding_id: args.marketFindingId,
        accurately_reflects_source: args.accuratelyReflectsSource, relevance_status: args.relevanceStatus,
        accuracy_qualification: args.accuracyQualification, relevance_qualification: args.relevanceQualification,
        supersedes_id: prior?.id ?? null, superseded_at: null, created_at: nowIso,
      }).execute();
    });
    return {
      id, founderId: args.founderId, marketFindingId: args.marketFindingId,
      accuratelyReflectsSource: args.accuratelyReflectsSource, relevanceStatus: args.relevanceStatus,
      accuracyQualification: args.accuracyQualification, relevanceQualification: args.relevanceQualification,
      supersedesId: prior?.id ?? null, supersededAt: null, createdAt: nowIso,
    };
  }

  /** The single effective (non-superseded) response for one finding, or null. */
  async effectiveByFindingId(founderId: string, marketFindingId: string): Promise<FindingResponseRecord | null> {
    const r = await this.db.selectFrom('business.market_finding_response').selectAll()
      .where('founder_id', '=', founderId).where('market_finding_id', '=', marketFindingId).where('superseded_at', 'is', null).executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }

  /** All effective responses for a founder, keyed by findingId (exactly one per finding). */
  async effectiveByFounder(founderId: string): Promise<Map<string, FindingResponseRecord>> {
    const rows = await this.db.selectFrom('business.market_finding_response').selectAll()
      .where('founder_id', '=', founderId).where('superseded_at', 'is', null).execute();
    const m = new Map<string, FindingResponseRecord>();
    for (const r of rows as AnyDB[]) m.set(r.market_finding_id, this.toDomain(r));
    return m;
  }

  /** Finding ids that have ANY response history (for the "a prior response exists / was revised" flag). */
  async findingsWithHistory(founderId: string): Promise<Set<string>> {
    const rows = await this.db.selectFrom('business.market_finding_response').select('market_finding_id')
      .where('founder_id', '=', founderId).execute();
    return new Set((rows as AnyDB[]).map((r) => r.market_finding_id as string));
  }

  /** Full history for one finding (oldest first). */
  async listByFinding(founderId: string, marketFindingId: string): Promise<FindingResponseRecord[]> {
    const rows = await this.db.selectFrom('business.market_finding_response').selectAll()
      .where('founder_id', '=', founderId).where('market_finding_id', '=', marketFindingId).orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }

  /** Full history for a founder (oldest first) — export. */
  async listByFounder(founderId: string): Promise<FindingResponseRecord[]> {
    const rows = await this.db.selectFrom('business.market_finding_response').selectAll()
      .where('founder_id', '=', founderId).orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }

  private toDomain(r: AnyDB): FindingResponseRecord {
    return {
      id: r.id, founderId: r.founder_id, marketFindingId: r.market_finding_id,
      accuratelyReflectsSource: r.accurately_reflects_source, relevanceStatus: r.relevance_status,
      accuracyQualification: r.accuracy_qualification ?? null, relevanceQualification: r.relevance_qualification ?? null,
      supersedesId: r.supersedes_id ?? null, supersededAt: r.superseded_at ? new Date(r.superseded_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }
}
