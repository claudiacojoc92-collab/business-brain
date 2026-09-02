import type { KyselyDB } from '../client';
import type {
  IConversationRepository,
  IInformationNeedRepository,
  IFounderStateRepository,
  IFounderObservationRepository,
  IAha2Repository,
  ConversationSession,
  ConversationTurn,
  ConversationStatus,
  FounderStateItem,
  FounderStateKind,
  FounderObservation,
  InformationNeed,
  Aha2Record,
  Aha2FindingResolved,
} from '@bb/application';
import { generateId } from '@bb/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

export class PgConversationRepository implements IConversationRepository {
  constructor(private readonly db: KyselyDB) {}

  async getByBusiness(businessId: string): Promise<ConversationSession | null> {
    const r = await (this.db as any).selectFrom('workspace.conversation_sessions').selectAll().where('business_id', '=', businessId).executeTakeFirst();
    return r ? { id: r.id, businessId: r.business_id, conversationLanguage: r.conversation_language, status: r.status, currentFocus: r.current_focus ?? null } : null;
  }

  async create(input: { id: string; businessId: string; founderId: string; conversationLanguage: string }): Promise<ConversationSession> {
    const r = await (this.db as any).insertInto('workspace.conversation_sessions')
      .values({ id: input.id, business_id: input.businessId, founder_id: input.founderId, conversation_language: input.conversationLanguage, status: 'active' })
      .returningAll().executeTakeFirstOrThrow();
    return { id: r.id, businessId: r.business_id, conversationLanguage: r.conversation_language, status: r.status, currentFocus: r.current_focus ?? null };
  }

  async setStatus(sessionId: string, status: ConversationStatus, currentFocus: string | null): Promise<void> {
    await (this.db as any).updateTable('workspace.conversation_sessions').set({ status, current_focus: currentFocus }).where('id', '=', sessionId).execute();
  }
  async setLanguage(sessionId: string, language: string): Promise<void> {
    await (this.db as any).updateTable('workspace.conversation_sessions').set({ conversation_language: language }).where('id', '=', sessionId).execute();
  }

  async appendTurn(input: { id: string; sessionId: string; businessId: string; role: 'founder' | 'bb'; content: string; language: string; infoNeedKey: string | null }): Promise<ConversationTurn> {
    const maxRow = await (this.db as any).selectFrom('workspace.conversation_turns').select((eb: any) => eb.fn.max('seq').as('m')).where('session_id', '=', input.sessionId).executeTakeFirst();
    const seq = (maxRow?.m ?? 0) + 1;
    const r = await (this.db as any).insertInto('workspace.conversation_turns')
      .values({ id: input.id, session_id: input.sessionId, business_id: input.businessId, seq, role: input.role, content: input.content, language: input.language, info_need_key: input.infoNeedKey })
      .returningAll().executeTakeFirstOrThrow();
    return { id: r.id, role: r.role, content: r.content, language: r.language, seq: r.seq, createdAt: iso(r.created_at) };
  }

  async listTurns(sessionId: string): Promise<ConversationTurn[]> {
    const rows = await (this.db as any).selectFrom('workspace.conversation_turns').selectAll().where('session_id', '=', sessionId).orderBy('seq', 'asc').execute();
    return rows.map((r: any) => ({ id: r.id, role: r.role, content: r.content, language: r.language, seq: r.seq, createdAt: iso(r.created_at) }));
  }
}

export class PgInformationNeedRepository implements IInformationNeedRepository {
  constructor(private readonly db: KyselyDB) {}
  async seed(sessionId: string, businessId: string, needs: { key: string; whatMissing: string; whyMatters: string }[]): Promise<void> {
    for (const n of needs) {
      await (this.db as any).insertInto('workspace.information_needs')
        .values({ id: generateId(), session_id: sessionId, business_id: businessId, key: n.key, what_missing: n.whatMissing, why_matters: n.whyMatters, status: 'open' })
        .onConflict((oc: any) => oc.columns(['session_id', 'key']).doNothing()).execute();
    }
  }
  async listOpen(sessionId: string): Promise<InformationNeed[]> {
    const rows = await (this.db as any).selectFrom('workspace.information_needs').selectAll().where('session_id', '=', sessionId).where('status', '=', 'open').execute();
    return rows.map((r: any) => ({ id: r.id, key: r.key, whatMissing: r.what_missing, whyMatters: r.why_matters, status: r.status }));
  }
  async markAnswered(sessionId: string, keys: string[]): Promise<void> {
    if (!keys.length) return;
    await (this.db as any).updateTable('workspace.information_needs').set({ status: 'answered', updated_at: new Date().toISOString() }).where('session_id', '=', sessionId).where('key', 'in', keys).execute();
  }
}

function toState(r: any): FounderStateItem {
  return { id: r.id, kind: r.kind, statement: r.statement, scope: r.scope ?? null, temporary: r.temporary, status: r.status };
}
export class PgFounderStateRepository implements IFounderStateRepository {
  constructor(private readonly db: KyselyDB) {}
  async append(input: { id: string; businessId: string; founderId: string; kind: FounderStateKind; statement: string; scope: string | null; language: string; sourceTurnId: string | null }): Promise<FounderStateItem> {
    const r = await (this.db as any).insertInto('workspace.founder_state')
      .values({ id: input.id, business_id: input.businessId, founder_id: input.founderId, kind: input.kind, statement: input.statement, scope: input.scope, language: input.language, source_turn_id: input.sourceTurnId, status: 'active' })
      .returningAll().executeTakeFirstOrThrow();
    return toState(r);
  }
  async listActive(businessId: string): Promise<FounderStateItem[]> {
    const rows = await (this.db as any).selectFrom('workspace.founder_state').selectAll().where('business_id', '=', businessId).where('status', '=', 'active').orderBy('created_at', 'asc').execute();
    return rows.map(toState);
  }
  async setStatus(businessId: string, id: string, status: 'superseded' | 'deleted'): Promise<FounderStateItem | null> {
    const r = await (this.db as any).updateTable('workspace.founder_state').set({ status }).where('business_id', '=', businessId).where('id', '=', id).returningAll().executeTakeFirst();
    return r ? toState(r) : null;
  }
  async setTemporary(businessId: string, id: string, temporary: boolean): Promise<void> {
    await (this.db as any).updateTable('workspace.founder_state').set({ temporary }).where('business_id', '=', businessId).where('id', '=', id).execute();
  }
}

function toObs(r: any): FounderObservation {
  return { id: r.id, behavior: r.behavior, status: r.status, turnRefs: typeof r.turn_refs === 'string' ? JSON.parse(r.turn_refs) : (r.turn_refs ?? []) };
}
export class PgFounderObservationRepository implements IFounderObservationRepository {
  constructor(private readonly db: KyselyDB) {}
  async listActive(businessId: string): Promise<FounderObservation[]> {
    const rows = await (this.db as any).selectFrom('workspace.founder_observations').selectAll().where('business_id', '=', businessId).where('status', 'in', ['candidate', 'supported', 'confirmed']).orderBy('created_at', 'asc').execute();
    return rows.map(toObs);
  }
  async observe(businessId: string, behavior: string, turnId: string): Promise<FounderObservation> {
    const existing = (await this.listActive(businessId)).find((o) => norm(o.behavior) === norm(behavior));
    if (existing) {
      const turnRefs = existing.turnRefs.includes(turnId) ? existing.turnRefs : [...existing.turnRefs, turnId];
      // A repeated candidate becomes a real (supported) observation; confirmed stays confirmed.
      const nextStatus = existing.status === 'candidate' ? 'supported' : existing.status;
      const r = await (this.db as any).updateTable('workspace.founder_observations')
        .set({ status: nextStatus, turn_refs: JSON.stringify(turnRefs), updated_at: new Date().toISOString() })
        .where('business_id', '=', businessId).where('id', '=', existing.id).returningAll().executeTakeFirstOrThrow();
      return toObs(r);
    }
    const r = await (this.db as any).insertInto('workspace.founder_observations')
      .values({ id: generateId(), business_id: businessId, behavior, turn_refs: JSON.stringify([turnId]), status: 'candidate' })
      .returningAll().executeTakeFirstOrThrow();
    return toObs(r);
  }
  async setStatus(businessId: string, id: string, status: 'confirmed' | 'rejected' | 'deleted'): Promise<FounderObservation | null> {
    const r = await (this.db as any).updateTable('workspace.founder_observations').set({ status, updated_at: new Date().toISOString() }).where('business_id', '=', businessId).where('id', '=', id).returningAll().executeTakeFirst();
    return r ? toObs(r) : null;
  }
}

function toAha2(r: any): Aha2Record {
  return { id: r.id, businessId: r.business_id, language: r.language, status: r.status, findings: typeof r.findings === 'string' ? JSON.parse(r.findings) : r.findings, createdAt: iso(r.created_at) };
}
export class PgAha2Repository implements IAha2Repository {
  constructor(private readonly db: KyselyDB) {}
  async save(input: { id: string; businessId: string; sessionId: string | null; understandingSnapshotId: string | null; language: string; contentHash: string; modelId: string; status: 'produced' | 'insufficient'; findings: Aha2FindingResolved[] }): Promise<Aha2Record> {
    const r = await (this.db as any).insertInto('workspace.aha2_versions')
      .values({ id: input.id, business_id: input.businessId, session_id: input.sessionId, understanding_snapshot_id: input.understandingSnapshotId, language: input.language, content_hash: input.contentHash, model_id: input.modelId, findings: JSON.stringify(input.findings), status: input.status })
      .returningAll().executeTakeFirstOrThrow();
    return toAha2(r);
  }
  async latest(businessId: string): Promise<Aha2Record | null> {
    const r = await (this.db as any).selectFrom('workspace.aha2_versions').selectAll().where('business_id', '=', businessId).orderBy('created_at', 'desc').executeTakeFirst();
    return r ? toAha2(r) : null;
  }
}
