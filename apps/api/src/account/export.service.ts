import type { PgEvidenceRepository } from '@bb/infrastructure';
import type { PgThreadRepository } from '../business-model/pg-thread.repository';
import type { PgRecommendationRepository } from '../business-model/pg-recommendation.repository';
import type { PgBusinessReadRepository } from '../business-model/pg-business-read.repository';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

/**
 * Complete founder export (S0-T4, Article XIII — "leave as easily as you stay"). Assembles EVERYTHING the
 * session founder owns into one JSON document, reusing the existing founder-scoped repo reads. Persisted
 * Business Read snapshots (S1-T3) are founder-owned data and ARE exported (the `reads` section); other
 * derived views ("what matters now" / gaps) remain recomputed-not-stored, so the evidence they derive from
 * is what represents them here.
 *
 * SECRETS ARE NEVER EXPORTED: OAuth rows contribute METADATA ONLY (provider / scopes / connectedAt /
 * tokenExpiresAt) — the encrypted access/refresh tokens are never read here. Session ids and magic-link
 * token hashes are excluded (transient auth secrets). The query is founder-scoped, so no other founder's
 * data can appear.
 */
export interface FounderExport {
  exportedAt: string;
  founder: { founderId: string; email: string; createdAt: string | null };
  evidence: unknown[];
  threads: unknown[];
  recommendations: unknown[];
  reads: Array<{ readId: string; createdAt: string | null; schemaVersion: number; read: unknown }>;
  integrations: Array<{ provider: string; scopes: string | null; connectedAt: string | null; tokenExpiresAt: string | null }>;
  login: { hasPassword: boolean; passwordSetAt: string | null; federatedLogins: Array<{ provider: string; email: string | null; connectedAt: string | null }> };
  understanding: unknown[];
  conclusionResponses: unknown[];
  marketEntities: unknown[];
  marketReviews: unknown[];
  marketFindings: unknown[];
  marketFindingResponses: unknown[];
  understandingRuns: unknown[];
  strategicSessions: unknown[];
  strategicResponses: unknown[];
  meta: { note: string };
}

const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string | number | Date).toISOString());

export async function buildFounderExport(args: {
  founderId: string;
  db: AnyDB;
  evidence: PgEvidenceRepository;
  threads: PgThreadRepository;
  recommendations: PgRecommendationRepository;
  reads: PgBusinessReadRepository;
  now: Date;
}): Promise<FounderExport | null> {
  const { founderId, db, evidence, threads, recommendations, reads, now } = args;

  const founder = await db
    .selectFrom('identity.founders')
    .select(['founder_id', 'email', 'created_at'])
    .where('founder_id', '=', founderId)
    .executeTakeFirst();
  if (!founder) return null; // unknown founder → caller 404s

  const fragments = await evidence.findByFounder(founderId);              // observed + declared + inferred
  const threadList = await threads.load(founderId);                       // threads WITH their events (history)
  const recs = await recommendations.load(founderId);                    // Layer-2 contracts (stored)
  const readList = await reads.listByFounder(founderId);                 // immutable Business Read snapshots (S1-T3)

  // OAuth METADATA ONLY — the encrypted token columns are never selected.
  const creds = (await db
    .selectFrom('app.oauth_credentials')
    .select(['provider', 'scopes', 'created_at', 'token_expires_at'])
    .where('founder_id', '=', founderId)
    .execute()) as Array<Record<string, unknown>>;

  // Wave 1 LOGIN identity — metadata only. The password HASH is NEVER selected/exported; only its existence.
  const credential = await db.selectFrom('identity.founder_credentials').select(['created_at']).where('founder_id', '=', founderId).executeTakeFirst();
  const logins = (await db
    .selectFrom('identity.oauth_identities')
    .select(['provider', 'email', 'created_at'])
    .where('founder_id', '=', founderId)
    .execute()) as Array<Record<string, unknown>>;

  // Wave 2 — versioned business understanding (all versions, oldest first; full lineage).
  const understandings = (await db
    .selectFrom('business.understanding')
    .select(['id', 'version', 'supersedes_id', 'model_version', 'conclusions', 'created_at'])
    .where('founder_id', '=', founderId)
    .orderBy('version', 'asc')
    .execute()) as Array<Record<string, unknown>>;

  // Founder response history — full lineage (all responses, oldest first), with the fields kept separate.
  const conclusionResponses = (await db
    .selectFrom('business.conclusion_response')
    .select(['id', 'understanding_id', 'conclusion_id', 'response_type', 'accepted_text', 'qualification_text', 'correction_text', 'superseded_by', 'created_at'])
    .where('founder_id', '=', founderId)
    .orderBy('created_at', 'asc')
    .execute()) as Array<Record<string, unknown>>;

  // Wave 3 — market context (entities + findings; observation and inference kept separate).
  const marketEntities = (await db.selectFrom('business.market_entity').selectAll().where('founder_id', '=', founderId).orderBy('created_at', 'asc').execute()) as Array<Record<string, unknown>>;
  const marketFindings = (await db.selectFrom('business.market_finding')
    .select(['id', 'market_entity_id', 'review_id', 'source_url', 'source_title', 'source_type', 'retrieved_at', 'retrieval_adapter', 'extraction_version', 'model_version', 'prompt_version', 'observed_text', 'inference_text', 'epistemic_status', 'founder_response', 'founder_qualification', 'created_at'])
    .where('founder_id', '=', founderId).orderBy('created_at', 'asc').execute()) as Array<Record<string, unknown>>;

  const marketReviews = (await db.selectFrom('business.market_review')
    .select(['id', 'market_entity_id', 'status', 'attempt_count', 'failure_category', 'prior_successful_review_id', 'retrieval_adapter', 'extraction_version', 'inference_model', 'inference_prompt_version', 'created_at', 'finished_at'])
    .where('founder_id', '=', founderId).orderBy('created_at', 'asc').execute()) as Array<Record<string, unknown>>;

  // Founder responses to findings — full history (both dimensions, qualifications, supersession lineage).
  const marketFindingResponses = (await db.selectFrom('business.market_finding_response')
    .select(['id', 'market_finding_id', 'accurately_reflects_source', 'relevance_status', 'accuracy_qualification', 'relevance_qualification', 'supersedes_id', 'superseded_at', 'created_at'])
    .where('founder_id', '=', founderId).orderBy('created_at', 'asc').execute()) as Array<Record<string, unknown>>;
  const effectiveResponseByFinding = new Map<string, Record<string, unknown>>();
  for (const r of marketFindingResponses) if (r['superseded_at'] == null) effectiveResponseByFinding.set(String(r['market_finding_id']), r);

  // Wave 4 — Founder Strategy sessions (founder-safe: recommendation/insufficient reason + provenance + failure
  // CATEGORY; the internal_error_detail and lease/claim internals are never selected).
  const strategicSessions = (await db.selectFrom('business.strategic_session')
    .select(['id', 'status', 'strategic_job', 'subtype', 'question_text', 'decision_horizon', 'understanding_version', 'context_health', 'recommendation', 'insufficient_reason', 'failure_category', 'founder_safe_error', 'prior_successful_session_id', 'model_id', 'prompt_version', 'schema_version', 'attempt_count', 'created_at', 'finished_at'])
    .where('founder_id', '=', founderId).orderBy('created_at', 'asc').execute()) as Array<Record<string, unknown>>;

  // Append-only founder responses to recommendations (effective = superseded_at null).
  const strategicResponses = (await db.selectFrom('business.strategic_response')
    .select(['id', 'session_id', 'response_type', 'qualification', 'supersedes_id', 'superseded_at', 'created_at'])
    .where('founder_id', '=', founderId).orderBy('created_at', 'asc').execute()) as Array<Record<string, unknown>>;

  // Run history — founder-safe (error CATEGORY only; never the internal error_detail).
  const runs = (await db
    .selectFrom('business.understanding_run')
    .select(['id', 'source_key', 'status', 'attempt_count', 'error_code', 'understanding_version', 'created_at', 'completed_at', 'failed_at'])
    .where('founder_id', '=', founderId)
    .orderBy('created_at', 'asc')
    .execute()) as Array<Record<string, unknown>>;

  return {
    exportedAt: now.toISOString(),
    founder: { founderId: founder.founder_id as string, email: founder.email as string, createdAt: iso(founder.created_at) },
    evidence: fragments.map((f) => ({
      id: f.id, source: f.source, platform: f.platform, sourceUrl: f.sourceUrl, confidenceKind: f.confidenceKind,
      occurredAt: iso(f.occurredAt), capturedAt: iso(f.capturedAt), visibility: f.visibility,
      payload: f.payload, derivedFrom: f.derivedFrom,
    })),
    threads: threadList.map((t) => ({
      signature: t.signature, category: t.category, declaredFields: t.declaredFields, observedKeys: t.observedKeys,
      status: t.status, currentTensionId: t.currentTensionId, resolvedReason: t.resolvedReason,
      recurrenceCount: t.recurrenceCount, firstSeenAt: iso(t.firstSeenAt), lastSeenAt: iso(t.lastSeenAt),
      events: t.history.map((e) => ({ event: e.event, at: iso(e.at), tensionId: e.tensionId, reason: e.reason ?? null })),
    })),
    recommendations: recs.map((r) => ({
      claimFragmentId: r.claimFragmentId, threadSignature: r.threadSignature, evidenceBasis: r.evidenceBasis,
      assumptions: r.assumptions, confidence: r.confidence, recommendationText: r.recommendationText,
    })),
    // Immutable Read snapshots, chronological (oldest first). The whole stored Read is included verbatim.
    reads: [...readList].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.readId.localeCompare(b.readId))
      .map((s) => ({ readId: s.readId, createdAt: iso(s.createdAt), schemaVersion: s.schemaVersion, read: s.read })),
    integrations: creds.map((c) => ({
      provider: String(c['provider']), scopes: (c['scopes'] as string | null) ?? null,
      connectedAt: iso(c['created_at']), tokenExpiresAt: iso(c['token_expires_at']),
    })),
    login: {
      hasPassword: Boolean(credential),                                    // existence only — never the hash
      passwordSetAt: credential ? iso((credential as Record<string, unknown>)['created_at']) : null,
      federatedLogins: logins.map((l) => ({ provider: String(l['provider']), email: (l['email'] as string | null) ?? null, connectedAt: iso(l['created_at']) })),
    },
    understanding: understandings.map((u) => ({
      id: String(u['id']), version: Number(u['version']), supersedesId: (u['supersedes_id'] as string | null) ?? null,
      modelVersion: String(u['model_version']),
      conclusions: typeof u['conclusions'] === 'string' ? JSON.parse(u['conclusions'] as string) : u['conclusions'],
      createdAt: iso(u['created_at']),
    })),
    conclusionResponses: conclusionResponses.map((r) => ({
      id: String(r['id']), understandingId: String(r['understanding_id']), conclusionId: String(r['conclusion_id']),
      responseType: String(r['response_type']), acceptedText: (r['accepted_text'] as string | null) ?? null,
      qualificationText: (r['qualification_text'] as string | null) ?? null, correctionText: (r['correction_text'] as string | null) ?? null,
      supersededBy: (r['superseded_by'] as string | null) ?? null, at: iso(r['created_at']),
    })),
    marketEntities: marketEntities.map((e) => ({ id: String(e['id']), name: String(e['name']), entityType: String(e['entity_type']), origin: String(e['origin']), relevanceStatus: String(e['relevance_status']), websiteUrl: (e['website_url'] as string | null) ?? null, relevanceNote: (e['relevance_note'] as string | null) ?? null, createdAt: iso(e['created_at']), updatedAt: iso(e['updated_at']), websiteChangedAt: iso(e['website_changed_at']) })),
    marketReviews: marketReviews.map((r) => ({ id: String(r['id']), marketEntityId: String(r['market_entity_id']), status: String(r['status']), attempts: Number(r['attempt_count']), failureCategory: (r['failure_category'] as string | null) ?? null, priorSuccessfulReviewId: (r['prior_successful_review_id'] as string | null) ?? null, provenance: { retrievalAdapter: (r['retrieval_adapter'] as string | null) ?? null, extractionVersion: (r['extraction_version'] as string | null) ?? null, inferenceModel: (r['inference_model'] as string | null) ?? null, inferencePromptVersion: (r['inference_prompt_version'] as string | null) ?? null }, createdAt: iso(r['created_at']), finishedAt: iso(r['finished_at']) })),
    marketFindings: marketFindings.map((f) => {
      const eff = effectiveResponseByFinding.get(String(f['id']));
      return { id: String(f['id']), marketEntityId: String(f['market_entity_id']), reviewId: (f['review_id'] as string | null) ?? null, sourceUrl: String(f['source_url']), sourceTitle: (f['source_title'] as string | null) ?? null, sourceType: String(f['source_type']), retrievedAt: iso(f['retrieved_at']), retrievalAdapter: String(f['retrieval_adapter']), extractionVersion: (f['extraction_version'] as string | null) ?? null, modelVersion: (f['model_version'] as string | null) ?? null, promptVersion: (f['prompt_version'] as string | null) ?? null, observedText: (f['observed_text'] as string | null) ?? null, inferenceText: (f['inference_text'] as string | null) ?? null, epistemicStatus: String(f['epistemic_status']), createdAt: iso(f['created_at']),
        effectiveResponse: eff ? { accuratelyReflectsSource: String(eff['accurately_reflects_source']), relevanceStatus: String(eff['relevance_status']), accuracyQualification: (eff['accuracy_qualification'] as string | null) ?? null, relevanceQualification: (eff['relevance_qualification'] as string | null) ?? null, at: iso(eff['created_at']) } : null };
    }),
    // Append-only response history — both dimensions, qualifications, supersession lineage (effective = supersededAt null).
    marketFindingResponses: marketFindingResponses.map((r) => ({ id: String(r['id']), marketFindingId: String(r['market_finding_id']), accuratelyReflectsSource: String(r['accurately_reflects_source']), relevanceStatus: String(r['relevance_status']), accuracyQualification: (r['accuracy_qualification'] as string | null) ?? null, relevanceQualification: (r['relevance_qualification'] as string | null) ?? null, supersedesId: (r['supersedes_id'] as string | null) ?? null, supersededAt: iso(r['superseded_at']), at: iso(r['created_at']) })),
    strategicSessions: strategicSessions.map((s) => {
      const j = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
      return { id: String(s['id']), status: String(s['status']), strategicJob: String(s['strategic_job']), subtype: (s['subtype'] as string | null) ?? null, question: String(s['question_text']), decisionHorizon: (s['decision_horizon'] as string | null) ?? null, understandingVersion: s['understanding_version'] == null ? null : Number(s['understanding_version']), contextHealth: j(s['context_health']), recommendation: j(s['recommendation']), insufficientReason: j(s['insufficient_reason']), failureCategory: (s['failure_category'] as string | null) ?? null, founderSafeError: (s['founder_safe_error'] as string | null) ?? null, priorSuccessfulSessionId: (s['prior_successful_session_id'] as string | null) ?? null, provenance: { modelId: (s['model_id'] as string | null) ?? null, promptVersion: (s['prompt_version'] as string | null) ?? null, schemaVersion: (s['schema_version'] as string | null) ?? null }, attempts: Number(s['attempt_count']), createdAt: iso(s['created_at']), finishedAt: iso(s['finished_at']) };
    }),
    strategicResponses: strategicResponses.map((r) => ({ id: String(r['id']), sessionId: String(r['session_id']), responseType: String(r['response_type']), qualification: (r['qualification'] as string | null) ?? null, supersedesId: (r['supersedes_id'] as string | null) ?? null, supersededAt: iso(r['superseded_at']), at: iso(r['created_at']) })),
    understandingRuns: runs.map((r) => ({
      id: String(r['id']), sourceKey: String(r['source_key']), status: String(r['status']), attempts: Number(r['attempt_count']),
      errorCode: (r['error_code'] as string | null) ?? null, understandingVersion: r['understanding_version'] == null ? null : Number(r['understanding_version']),
      createdAt: iso(r['created_at']), completedAt: iso(r['completed_at']), failedAt: iso(r['failed_at']),
    })),
    meta: {
      note: 'This is the complete stored data for your account, including your saved Business Read snapshots (immutable — each is exactly what you saw when it was generated). Other derived views ("what matters now", gaps) are recomputed from your evidence and are not stored, so they are represented here by the evidence they derive from. Excluded for security: encrypted access/refresh tokens, session identifiers, and magic-link token hashes. No other founder’s data is included.',
    },
  };
}
