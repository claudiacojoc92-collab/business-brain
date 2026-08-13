import type { KyselyDB } from '../client';
import { generateId } from '@bb/shared';
import type {
  IPlanRepository, PlanVersion, PlanLifecycleEvent, ActionStateEntry, CreateHandoff, Priority, ResourceEnvelope, NotNowItem, PlanGenerationTrace,
} from '@bb/application';

/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));
const parse = <T>(v: any, fb: T): T => { if (v == null) return fb; return typeof v === 'string' ? JSON.parse(v) : v; };

function toPlan(r: any): PlanVersion {
  return {
    planVersionId: r.plan_version_id, businessId: r.business_id, strategyVersionId: r.strategy_version_id,
    resourceEnvelope: parse<ResourceEnvelope>(r.resource_envelope, {} as ResourceEnvelope),
    contextVersionRefs: parse<string[]>(r.context_version_refs, []), monthDirection: r.month_direction,
    priorities: parse<Priority[]>(r.priorities, []), currentFocusPriorityId: r.current_focus_priority_id,
    notNow: parse<NotNowItem[]>(r.not_now, []), producedAt: iso(r.produced_at), contentHash: r.content_hash,
  };
}

/**
 * Slice 5 Plan persistence. plan_version is INSERT-ONLY (immutable content + content_hash). Lifecycle and
 * action-state are append-only event tables; adoption/status/readiness are projected in the service.
 */
export class PgPlanRepository implements IPlanRepository {
  constructor(private readonly db_: KyselyDB) {}

  async savePlanVersion(p: PlanVersion): Promise<void> {
    await (this.db_ as any).insertInto('workspace.plan_version').values({
      plan_version_id: p.planVersionId, business_id: p.businessId, strategy_version_id: p.strategyVersionId,
      resource_envelope: JSON.stringify(p.resourceEnvelope), context_version_refs: JSON.stringify(p.contextVersionRefs),
      month_direction: p.monthDirection, priorities: JSON.stringify(p.priorities), current_focus_priority_id: p.currentFocusPriorityId,
      not_now: JSON.stringify(p.notNow), produced_at: p.producedAt, content_hash: p.contentHash,
    }).execute();
  }

  async getPlanVersion(businessId: string, planVersionId: string): Promise<PlanVersion | null> {
    const r = await (this.db_ as any).selectFrom('workspace.plan_version').selectAll().where('business_id', '=', businessId).where('plan_version_id', '=', planVersionId).executeTakeFirst();
    return r ? toPlan(r) : null;
  }

  async recordLifecycle(e: Omit<PlanLifecycleEvent, 'id'>): Promise<void> {
    await (this.db_ as any).insertInto('workspace.plan_lifecycle_event').values({ id: generateId(), business_id: e.businessId, plan_version_id: e.planVersionId, kind: e.kind, at: e.at, reason: e.reason }).execute();
  }

  async listLifecycle(businessId: string): Promise<PlanLifecycleEvent[]> {
    const rows = await (this.db_ as any).selectFrom('workspace.plan_lifecycle_event').selectAll().where('business_id', '=', businessId).orderBy('at', 'asc').execute();
    return rows.map((r: any) => ({ id: r.id, businessId: r.business_id, planVersionId: r.plan_version_id, kind: r.kind, at: iso(r.at), reason: r.reason ?? null }));
  }

  async appendActionState(e: Omit<ActionStateEntry, 'id'>): Promise<void> {
    await (this.db_ as any).insertInto('workspace.plan_action_state').values({ id: generateId(), business_id: e.businessId, plan_version_id: e.planVersionId, action_id: e.actionId, outcome: e.outcome, reason: e.reason, at: e.at }).execute();
  }

  async listActionStates(businessId: string, planVersionId: string): Promise<ActionStateEntry[]> {
    const rows = await (this.db_ as any).selectFrom('workspace.plan_action_state').selectAll().where('business_id', '=', businessId).where('plan_version_id', '=', planVersionId).orderBy('at', 'asc').execute();
    return rows.map((r: any) => ({ id: r.id, businessId: r.business_id, planVersionId: r.plan_version_id, actionId: r.action_id, outcome: r.outcome, reason: r.reason ?? null, at: iso(r.at) }));
  }

  async saveCreateHandoff(h: CreateHandoff): Promise<void> {
    const pv = await (this.db_ as any).selectFrom('workspace.plan_version').select('business_id').where('plan_version_id', '=', h.planVersionId).executeTakeFirst();
    await (this.db_ as any).insertInto('workspace.plan_create_handoff').values({ create_handoff_id: h.createHandoffId, business_id: pv?.business_id ?? '', action_id: h.actionId, plan_version_id: h.planVersionId, payload: JSON.stringify(h), produced_at: h.producedAt }).execute();
  }

  async saveGenerationTrace(t: Omit<PlanGenerationTrace, 'id'>): Promise<void> {
    await (this.db_ as any).insertInto('workspace.plan_generation_trace').values({
      id: generateId(), business_id: t.businessId, strategy_version_id: t.strategyVersionId, plan_version_id: t.planVersionId,
      model_id: t.modelId, draft_contract_hash: t.draftContractHash, genericity_contract_hash: t.genericityContractHash,
      attempts: JSON.stringify(t.attempts), final_disposition: t.finalDisposition, at: t.at,
    }).execute();
  }
}
