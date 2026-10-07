import type { KyselyDB } from '../client';
import type {
  IStrategyRepository,
  IStrategyPointerRepository,
  StrategyVersionRecord,
  StrategyPointer,
  SaveStrategyVersionInput,
  StrategyBundle,
  StrategyGateResult,
} from '@bb/application';

/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));
const parse = <T>(v: any): T => (typeof v === 'string' ? JSON.parse(v) : v);

function toRecord(r: any): StrategyVersionRecord {
  return {
    id: r.id,
    businessId: r.business_id,
    version: r.version,
    status: r.status,
    bundle: {
      core: parse<StrategyBundle['core']>(r.core),
      branch: parse<StrategyBundle['branch']>(r.branch),
      decisions: parse<StrategyBundle['decisions']>(r.decisions),
    },
    gateResults: parse<StrategyGateResult[]>(r.gate_results),
    language: r.language,
    createdAt: iso(r.created_at),
  };
}

export class PgStrategyRepository implements IStrategyRepository {
  constructor(private readonly db: KyselyDB) {}

  async nextVersion(businessId: string): Promise<number> {
    const row = await (this.db as any).selectFrom('workspace.strategy_versions')
      .select((eb: any) => eb.fn.max('version').as('m')).where('business_id', '=', businessId).executeTakeFirst();
    return (row?.m ?? 0) + 1;
  }

  async save(input: SaveStrategyVersionInput): Promise<StrategyVersionRecord> {
    const r = await (this.db as any).insertInto('workspace.strategy_versions')
      .values({
        id: input.id, business_id: input.businessId, version: input.version, status: input.status,
        core: JSON.stringify(input.bundle.core), branch: JSON.stringify(input.bundle.branch),
        decisions: JSON.stringify(input.bundle.decisions), gate_results: JSON.stringify(input.gateResults),
        context_hash: input.contextHash, model_id: input.modelId, language: input.language,
      })
      .returningAll().executeTakeFirstOrThrow();
    return toRecord(r);
  }

  async getById(businessId: string, id: string): Promise<StrategyVersionRecord | null> {
    const r = await (this.db as any).selectFrom('workspace.strategy_versions').selectAll()
      .where('business_id', '=', businessId).where('id', '=', id).executeTakeFirst();
    return r ? toRecord(r) : null;
  }

  async latestProposal(businessId: string): Promise<StrategyVersionRecord | null> {
    const r = await (this.db as any).selectFrom('workspace.strategy_versions').selectAll()
      .where('business_id', '=', businessId).where('status', '=', 'proposal')
      .orderBy('version', 'desc').executeTakeFirst();
    return r ? toRecord(r) : null;
  }
}

export class PgStrategyPointerRepository implements IStrategyPointerRepository {
  constructor(private readonly db: KyselyDB) {}

  async get(businessId: string): Promise<StrategyPointer | null> {
    const r = await (this.db as any).selectFrom('workspace.strategy_pointer').selectAll().where('business_id', '=', businessId).executeTakeFirst();
    return r ? { businessId: r.business_id, currentVersionId: r.current_version_id ?? null, adoptedAt: r.adopted_at ? iso(r.adopted_at) : null } : null;
  }

  async setCurrent(businessId: string, versionId: string, adoptedBy: string): Promise<void> {
    await (this.db as any).insertInto('workspace.strategy_pointer')
      .values({ business_id: businessId, current_version_id: versionId, adopted_at: new Date().toISOString(), adopted_by: adoptedBy })
      .onConflict((oc: any) => oc.column('business_id').doUpdateSet({ current_version_id: versionId, adopted_at: new Date().toISOString(), adopted_by: adoptedBy }))
      .execute();
  }
}
