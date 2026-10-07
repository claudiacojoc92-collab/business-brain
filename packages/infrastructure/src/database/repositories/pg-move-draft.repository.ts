import type { KyselyDB } from '../client';
import type { IMoveDraftRepository, MoveDraft, LandingDraft, LandingAuthorizationSnapshot, MoveDraftKind, MoveDraftStatus, MoveSafetyDecision } from '@bb/application';

/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));
const parse = <T>(v: any, fb: T): T => { if (v == null) return fb; return typeof v === 'string' ? JSON.parse(v) : v; };

function toDraft(r: any): MoveDraft {
  return {
    moveDraftId: r.move_draft_id, businessId: r.business_id, actionId: r.action_id, planVersionId: r.plan_version_id,
    kind: r.kind as MoveDraftKind, language: r.language,
    draft: r.draft == null ? null : parse<LandingDraft>(r.draft, null as unknown as LandingDraft),
    snapshot: parse<LandingAuthorizationSnapshot>(r.snapshot, {} as LandingAuthorizationSnapshot),
    safetyDecision: parse<MoveSafetyDecision>(r.safety_decision, {} as MoveSafetyDecision),
    status: r.status as MoveDraftStatus, version: Number(r.version), producedAt: iso(r.produced_at),
  };
}

/**
 * MoveDraft persistence. Append-only: save() inserts a new row; the latest version per (business, action)
 * wins. The draft, authorization snapshot and safety decision are stored as immutable JSONB for audit replay.
 */
export class PgMoveDraftRepository implements IMoveDraftRepository {
  constructor(private readonly db_: KyselyDB) {}

  async save(d: MoveDraft): Promise<void> {
    await (this.db_ as any).insertInto('workspace.move_draft').values({
      move_draft_id: d.moveDraftId, business_id: d.businessId, action_id: d.actionId, plan_version_id: d.planVersionId,
      kind: d.kind, language: d.language,
      draft: d.draft == null ? null : JSON.stringify(d.draft),
      snapshot: JSON.stringify(d.snapshot), safety_decision: JSON.stringify(d.safetyDecision),
      status: d.status, version: d.version, produced_at: d.producedAt,
    }).execute();
  }

  async latestForAction(businessId: string, actionId: string): Promise<MoveDraft | null> {
    const r = await (this.db_ as any).selectFrom('workspace.move_draft').selectAll()
      .where('business_id', '=', businessId).where('action_id', '=', actionId)
      .orderBy('version', 'desc').orderBy('produced_at', 'desc').limit(1).executeTakeFirst();
    return r ? toDraft(r) : null;
  }

  async get(businessId: string, moveDraftId: string): Promise<MoveDraft | null> {
    const r = await (this.db_ as any).selectFrom('workspace.move_draft').selectAll()
      .where('business_id', '=', businessId).where('move_draft_id', '=', moveDraftId).executeTakeFirst();
    return r ? toDraft(r) : null;
  }
}
