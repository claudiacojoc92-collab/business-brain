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
  understandingRuns: unknown[];
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
