import type { PgEvidenceRepository } from '@bb/infrastructure';
import type { PgThreadRepository } from '../business-model/pg-thread.repository';
import type { PgRecommendationRepository } from '../business-model/pg-recommendation.repository';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

/**
 * Complete founder export (S0-T4, Article XIII — "leave as easily as you stay"). Assembles EVERYTHING the
 * session founder owns into one JSON document, reusing the existing founder-scoped repo reads. It is the
 * stored substrate only: derived views ("what matters now" / gaps / Reads) are RECOMPUTED from evidence,
 * never persisted, so they are not a separate section — the evidence they derive from IS exported.
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
  integrations: Array<{ provider: string; scopes: string | null; connectedAt: string | null; tokenExpiresAt: string | null }>;
  meta: { note: string };
}

const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string | number | Date).toISOString());

export async function buildFounderExport(args: {
  founderId: string;
  db: AnyDB;
  evidence: PgEvidenceRepository;
  threads: PgThreadRepository;
  recommendations: PgRecommendationRepository;
  now: Date;
}): Promise<FounderExport | null> {
  const { founderId, db, evidence, threads, recommendations, now } = args;

  const founder = await db
    .selectFrom('identity.founders')
    .select(['founder_id', 'email', 'created_at'])
    .where('founder_id', '=', founderId)
    .executeTakeFirst();
  if (!founder) return null; // unknown founder → caller 404s

  const fragments = await evidence.findByFounder(founderId);              // observed + declared + inferred
  const threadList = await threads.load(founderId);                       // threads WITH their events (history)
  const recs = await recommendations.load(founderId);                    // Layer-2 contracts (stored)

  // OAuth METADATA ONLY — the encrypted token columns are never selected.
  const creds = (await db
    .selectFrom('app.oauth_credentials')
    .select(['provider', 'scopes', 'created_at', 'token_expires_at'])
    .where('founder_id', '=', founderId)
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
    integrations: creds.map((c) => ({
      provider: String(c['provider']), scopes: (c['scopes'] as string | null) ?? null,
      connectedAt: iso(c['created_at']), tokenExpiresAt: iso(c['token_expires_at']),
    })),
    meta: {
      note: 'This is the complete stored data for your account. Derived views ("what matters now", gaps, Reads) are recomputed from your evidence and are not stored, so they are not listed separately. Excluded for security: encrypted access/refresh tokens, session identifiers, and magic-link token hashes. No other founder’s data is included.',
    },
  };
}
