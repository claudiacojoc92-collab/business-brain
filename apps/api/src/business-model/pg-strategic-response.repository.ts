/**
 * Pg repository for founder responses to a strategic recommendation (V066). Append-only with supersession
 * (mirrors the conclusion/finding-response discipline): recording a new response marks the prior effective
 * response for that session superseded, then inserts the new one — in one transaction, so exactly one effective
 * response per session and full history is preserved. An ACCEPT here is a recorded decision candidate; it does
 * NOT write accepted business context (contract §8). Identical no-op re-submissions add no history.
 */
import { generateId } from '@bb/shared';
import type { StrategicResponseRecord, StrategicResponseType } from './strategy';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export class PgStrategicResponseRepository {
  constructor(private readonly db: AnyDB) {}

  async record(args: { founderId: string; sessionId: string; responseType: StrategicResponseType; qualification: string | null; now: Date }): Promise<StrategicResponseRecord> {
    const prior = await this.effectiveBySession(args.founderId, args.sessionId);
    if (prior && prior.responseType === args.responseType && (prior.qualification ?? null) === (args.qualification ?? null)) return prior; // identical no-op
    const id = generateId(); const nowIso = args.now.toISOString();
    await this.db.transaction().execute(async (tx: AnyDB) => {
      await tx.updateTable('business.strategic_response').set({ superseded_at: nowIso }).where('founder_id', '=', args.founderId).where('session_id', '=', args.sessionId).where('superseded_at', 'is', null).execute();
      await tx.insertInto('business.strategic_response').values({ id, founder_id: args.founderId, session_id: args.sessionId, response_type: args.responseType, qualification: args.qualification, supersedes_id: prior?.id ?? null, superseded_at: null, created_at: nowIso }).execute();
    });
    return { id, founderId: args.founderId, sessionId: args.sessionId, responseType: args.responseType, qualification: args.qualification, supersedesId: prior?.id ?? null, supersededAt: null, createdAt: nowIso };
  }

  async effectiveBySession(founderId: string, sessionId: string): Promise<StrategicResponseRecord | null> {
    const r = await this.db.selectFrom('business.strategic_response').selectAll().where('founder_id', '=', founderId).where('session_id', '=', sessionId).where('superseded_at', 'is', null).executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }
  async listBySession(founderId: string, sessionId: string): Promise<StrategicResponseRecord[]> {
    const rows = await this.db.selectFrom('business.strategic_response').selectAll().where('founder_id', '=', founderId).where('session_id', '=', sessionId).orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }
  async listByFounder(founderId: string): Promise<StrategicResponseRecord[]> {
    const rows = await this.db.selectFrom('business.strategic_response').selectAll().where('founder_id', '=', founderId).orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }

  private toDomain(r: AnyDB): StrategicResponseRecord {
    return { id: r.id, founderId: r.founder_id, sessionId: r.session_id, responseType: r.response_type, qualification: r.qualification ?? null, supersedesId: r.supersedes_id ?? null, supersededAt: r.superseded_at ? new Date(r.superseded_at).toISOString() : null, createdAt: new Date(r.created_at).toISOString() };
  }
}
