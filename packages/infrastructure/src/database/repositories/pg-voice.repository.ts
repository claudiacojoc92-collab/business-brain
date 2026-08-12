import type { KyselyDB } from '../client';
import { generateId } from '@bb/shared';
import type {
  IVoiceRepository,
  VoiceSubject,
  ExampleSubject,
  SpeakingRole,
  SampleChannel,
  VoiceExample,
  VoiceExampleKind,
  VoiceSource,
  VoiceBoundary,
  BoundaryType,
  VoiceNegativeSpace,
  NegativeSpaceCategory,
  VoicePattern,
  PatternStatus,
  VoiceSample,
  SampleContent,
  AuthorizationSnapshot,
  SafetyDecision,
  CalibrationSession,
  FeedbackTarget,
  FeedbackSignal,
  VoiceWorkingSet,
} from '@bb/application';

/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));
const parse = <T>(v: any, fb: T): T => { if (v == null) return fb; return typeof v === 'string' ? JSON.parse(v) : v; };

function toExample(r: any): VoiceExample {
  return { id: r.id, subject: r.subject, kind: r.kind, text: r.text, language: r.language, market: r.market ?? null, channel: r.channel ?? null, speakingRole: r.speaking_role ?? null, source: r.source, status: r.status, editGroupId: r.edit_group_id ?? null, createdAt: iso(r.created_at) };
}
function toSample(r: any): VoiceSample {
  return { id: r.id, sessionId: r.session_id ?? null, subject: r.subject, language: r.language, market: r.market ?? null, channel: r.channel, speakingRole: r.speaking_role, objective: r.objective, content: parse<SampleContent>(r.content, {}), status: r.status, createdAt: iso(r.created_at), authorizationSnapshot: parse<AuthorizationSnapshot>(r.authorization_snapshot, {} as AuthorizationSnapshot), safetyDecision: parse<SafetyDecision>(r.safety_decision, {} as SafetyDecision) };
}

export class PgVoiceRepository implements IVoiceRepository {
  constructor(private readonly db: KyselyDB) {}
  private get db_(): any { return this.db as any; }

  async getOrCreateProfile(businessId: string, subject: VoiceSubject): Promise<{ id: string; subject: VoiceSubject }> {
    const existing = await this.db_.selectFrom('workspace.voice_profiles').selectAll().where('business_id', '=', businessId).where('subject', '=', subject).executeTakeFirst();
    if (existing) return { id: existing.id, subject: existing.subject };
    const r = await this.db_.insertInto('workspace.voice_profiles').values({ id: generateId(), business_id: businessId, subject })
      .onConflict((oc: any) => oc.columns(['business_id', 'subject']).doNothing()).returningAll().executeTakeFirst();
    if (r) return { id: r.id, subject: r.subject };
    const again = await this.db_.selectFrom('workspace.voice_profiles').selectAll().where('business_id', '=', businessId).where('subject', '=', subject).executeTakeFirstOrThrow();
    return { id: again.id, subject: again.subject };
  }

  async addExample(input: { businessId: string; subject: ExampleSubject; kind: VoiceExampleKind; text: string; language: string; market: string | null; channel: string | null; speakingRole: SpeakingRole | null; source: VoiceSource; editGroupId?: string | null; provenance?: Record<string, unknown> }): Promise<VoiceExample> {
    const r = await this.db_.insertInto('workspace.voice_examples').values({
      id: generateId(), business_id: input.businessId, subject: input.subject, kind: input.kind, text: input.text,
      language: input.language, market: input.market, channel: input.channel, speaking_role: input.speakingRole,
      source: input.source, edit_group_id: input.editGroupId ?? null, provenance: JSON.stringify(input.provenance ?? {}),
    }).returningAll().executeTakeFirstOrThrow();
    return toExample(r);
  }
  async listExamples(businessId: string, subject: ExampleSubject, language?: string): Promise<VoiceExample[]> {
    let q = this.db_.selectFrom('workspace.voice_examples').selectAll().where('business_id', '=', businessId).where('subject', '=', subject);
    if (language) q = q.where('language', '=', language);
    const rows = await q.orderBy('created_at', 'asc').execute();
    return rows.map(toExample);
  }

  async addBoundary(input: { businessId: string; subject: string; type: BoundaryType; statement: string; language: string | null }): Promise<VoiceBoundary> {
    const r = await this.db_.insertInto('workspace.voice_boundaries').values({ id: generateId(), business_id: input.businessId, subject: input.subject, type: input.type, statement: input.statement, language: input.language }).returningAll().executeTakeFirstOrThrow();
    return { id: r.id, subject: r.subject, type: r.type, statement: r.statement, language: r.language ?? null, status: r.status };
  }
  async listBoundaries(businessId: string, subject: string): Promise<VoiceBoundary[]> {
    const rows = await this.db_.selectFrom('workspace.voice_boundaries').selectAll().where('business_id', '=', businessId).where('subject', '=', subject).execute();
    return rows.map((r: any) => ({ id: r.id, subject: r.subject, type: r.type, statement: r.statement, language: r.language ?? null, status: r.status }));
  }
  async setBoundaryStatus(businessId: string, id: string, status: 'removed'): Promise<void> {
    await this.db_.updateTable('workspace.voice_boundaries').set({ status }).where('business_id', '=', businessId).where('id', '=', id).execute();
  }

  async addNegativeSpace(input: { businessId: string; subject: string; category: NegativeSpaceCategory; value: string; language: string | null }): Promise<VoiceNegativeSpace> {
    const r = await this.db_.insertInto('workspace.voice_negative_space').values({ id: generateId(), business_id: input.businessId, subject: input.subject, category: input.category, value: input.value, language: input.language }).returningAll().executeTakeFirstOrThrow();
    return { id: r.id, subject: r.subject, category: r.category, value: r.value, language: r.language ?? null, status: r.status };
  }
  async listNegativeSpace(businessId: string, subject: string): Promise<VoiceNegativeSpace[]> {
    const rows = await this.db_.selectFrom('workspace.voice_negative_space').selectAll().where('business_id', '=', businessId).where('subject', '=', subject).execute();
    return rows.map((r: any) => ({ id: r.id, subject: r.subject, category: r.category, value: r.value, language: r.language ?? null, status: r.status }));
  }
  async setNegativeSpaceStatus(businessId: string, id: string, status: 'removed'): Promise<void> {
    await this.db_.updateTable('workspace.voice_negative_space').set({ status }).where('business_id', '=', businessId).where('id', '=', id).execute();
  }

  async listPatterns(businessId: string, subject: string, language: string): Promise<VoicePattern[]> {
    const rows = await this.db_.selectFrom('workspace.voice_patterns').selectAll().where('business_id', '=', businessId).where('subject', '=', subject).where('language', '=', language).execute();
    return rows.map((r: any) => ({ id: r.id, subject: r.subject, language: r.language, dimension: r.dimension, statement: r.statement, status: r.status, observations: r.observations, exampleRefs: parse<string[]>(r.example_refs, []) }));
  }
  async upsertPattern(input: { businessId: string; subject: string; language: string; dimension: string; statement: string; exampleRef: string | null }): Promise<VoicePattern> {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const existing = (await this.listPatterns(input.businessId, input.subject, input.language)).find((p) => p.status !== 'superseded' && p.dimension === input.dimension && norm(p.statement) === norm(input.statement));
    if (existing) {
      const refs = input.exampleRef && !existing.exampleRefs.includes(input.exampleRef) ? [...existing.exampleRefs, input.exampleRef] : existing.exampleRefs;
      const r = await this.db_.updateTable('workspace.voice_patterns').set({ observations: existing.observations + 1, example_refs: JSON.stringify(refs), updated_at: new Date().toISOString() }).where('id', '=', existing.id).returningAll().executeTakeFirstOrThrow();
      return { id: r.id, subject: r.subject, language: r.language, dimension: r.dimension, statement: r.statement, status: r.status, observations: r.observations, exampleRefs: parse<string[]>(r.example_refs, []) };
    }
    const r = await this.db_.insertInto('workspace.voice_patterns').values({ id: generateId(), business_id: input.businessId, subject: input.subject, language: input.language, dimension: input.dimension, statement: input.statement, status: 'candidate', observations: 1, example_refs: JSON.stringify(input.exampleRef ? [input.exampleRef] : []) }).returningAll().executeTakeFirstOrThrow();
    return { id: r.id, subject: r.subject, language: r.language, dimension: r.dimension, statement: r.statement, status: r.status, observations: r.observations, exampleRefs: parse<string[]>(r.example_refs, []) };
  }
  async promotePattern(businessId: string, id: string, status: PatternStatus): Promise<void> {
    await this.db_.updateTable('workspace.voice_patterns').set({ status, updated_at: new Date().toISOString() }).where('business_id', '=', businessId).where('id', '=', id).execute();
  }

  async createSession(input: { businessId: string; subject: VoiceSubject; language: string; market: string | null }): Promise<CalibrationSession> {
    const r = await this.db_.insertInto('workspace.voice_calibration_sessions').values({ id: generateId(), business_id: input.businessId, subject: input.subject, language: input.language, market: input.market, status: 'active' })
      .onConflict((oc: any) => oc.columns(['business_id', 'subject', 'language', 'market']).doUpdateSet({ updated_at: new Date().toISOString() })).returningAll().executeTakeFirstOrThrow();
    return { id: r.id, subject: r.subject, language: r.language, market: r.market ?? null, status: r.status };
  }
  async getSession(businessId: string, subject: VoiceSubject, language: string, market: string | null): Promise<CalibrationSession | null> {
    let q = this.db_.selectFrom('workspace.voice_calibration_sessions').selectAll().where('business_id', '=', businessId).where('subject', '=', subject).where('language', '=', language);
    q = market == null ? q.where('market', 'is', null) : q.where('market', '=', market);
    const r = await q.executeTakeFirst();
    return r ? { id: r.id, subject: r.subject, language: r.language, market: r.market ?? null, status: r.status } : null;
  }
  async setSessionStatus(id: string, status: 'active' | 'sufficient' | 'paused'): Promise<void> {
    await this.db_.updateTable('workspace.voice_calibration_sessions').set({ status, updated_at: new Date().toISOString() }).where('id', '=', id).execute();
  }

  async addSample(input: { businessId: string; sessionId: string | null; subject: VoiceSubject; language: string; market: string | null; channel: SampleChannel; speakingRole: SpeakingRole; objective: string; content: SampleContent; authorizationSnapshot: AuthorizationSnapshot; safetyDecision: SafetyDecision }): Promise<VoiceSample> {
    const r = await this.db_.insertInto('workspace.voice_samples').values({ id: generateId(), business_id: input.businessId, session_id: input.sessionId, subject: input.subject, language: input.language, market: input.market, channel: input.channel, speaking_role: input.speakingRole, objective: input.objective, content: JSON.stringify(input.content), authorization_snapshot: JSON.stringify(input.authorizationSnapshot), safety_decision: JSON.stringify(input.safetyDecision), status: 'pending' }).returningAll().executeTakeFirstOrThrow();
    return toSample(r);
  }
  async getSample(businessId: string, id: string): Promise<VoiceSample | null> {
    const r = await this.db_.selectFrom('workspace.voice_samples').selectAll().where('business_id', '=', businessId).where('id', '=', id).executeTakeFirst();
    return r ? toSample(r) : null;
  }
  async listSamples(businessId: string, sessionId: string): Promise<VoiceSample[]> {
    const rows = await this.db_.selectFrom('workspace.voice_samples').selectAll().where('business_id', '=', businessId).where('session_id', '=', sessionId).orderBy('created_at', 'asc').execute();
    return rows.map(toSample);
  }
  async setSampleStatus(businessId: string, id: string, status: 'reacted' | 'superseded'): Promise<void> {
    await this.db_.updateTable('workspace.voice_samples').set({ status }).where('business_id', '=', businessId).where('id', '=', id).execute();
  }

  async addFeedback(input: { businessId: string; sessionId: string | null; sampleId: string | null; target: FeedbackTarget; signal: FeedbackSignal; reactionText: string | null }): Promise<void> {
    await this.db_.insertInto('workspace.voice_feedback').values({ id: generateId(), business_id: input.businessId, session_id: input.sessionId, sample_id: input.sampleId, target: input.target, signal: input.signal, reaction_text: input.reactionText }).execute();
  }

  async nextVoiceVersion(businessId: string, subject: VoiceSubject, language: string, market: string | null): Promise<number> {
    let q = this.db_.selectFrom('workspace.voice_versions').select((eb: any) => eb.fn.max('version').as('m')).where('business_id', '=', businessId).where('subject', '=', subject).where('language', '=', language);
    q = market == null ? q.where('market', 'is', null) : q.where('market', '=', market);
    const r = await q.executeTakeFirst();
    return (r?.m ?? 0) + 1;
  }
  async saveVoiceVersion(input: { businessId: string; subject: VoiceSubject; language: string; market: string | null; version: number; contentHash: string; resolved: VoiceWorkingSet }): Promise<{ version: number }> {
    const r = await this.db_.insertInto('workspace.voice_versions').values({ id: generateId(), business_id: input.businessId, subject: input.subject, language: input.language, market: input.market, version: input.version, content_hash: input.contentHash, resolved: JSON.stringify(input.resolved) }).returningAll().executeTakeFirstOrThrow();
    return { version: r.version };
  }
}
