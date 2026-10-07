/**
 * The single structured context handed to the ONE LLM call (Phase ②), plus its canonical hash.
 *
 * This object is the model's ENTIRE input: deterministic metrics + account facts + the bounded,
 * ordered post digests (full caption + deterministic signals). It is persisted verbatim and hashed
 * (SHA-256 over a canonical serialization) so a diagnosis is reproducible and every narrative claim
 * traces to exactly what the model saw. No per-post model calls — the model reads this once.
 */
import { createHash } from 'node:crypto';
import type { EvidenceItem } from '../domain/model';
import type { AccountMetrics, GenerationContext, ImportedAccount, ObservationRecord } from './model';

/** Deterministic JSON: object keys sorted recursively, arrays preserved. */
export function canonicalSerialize(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v as object)) throw new Error('cannot canonicalize a cyclic value');
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = walk((v as Record<string, unknown>)[k]);
    return out;
  };
  return JSON.stringify(walk(value));
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function assembleGenerationContext(
  account: ImportedAccount,
  metrics: AccountMetrics,
  observations: readonly ObservationRecord[],
  evidenceItems: readonly EvidenceItem[],
): GenerationContext {
  return {
    account: {
      username: account.username,
      accountType: account.accountType,
      followersCount: account.followersCount,
      mediaCount: account.mediaCount,
    },
    window: { from: metrics.windowFrom, to: metrics.windowTo, postCount: metrics.postCount },
    metrics,
    evidence: evidenceItems.map((it) => ({
      key: it.provenance?.metricKey ?? it.evidenceItemId,
      label: it.claimLabel,
      kind: it.kind,
      ...(it.value !== undefined ? { value: it.value } : {}),
    })),
    posts: observations.map((o) => ({
      ref: o.permalink ?? o.postExternalId,
      mediaType: o.mediaType,
      postedAt: o.postedAt,
      caption: o.caption,
      likes: o.likes,
      comments: o.comments,
      reach: o.reach,
      hasCta: o.hasCta,
      hasLink: o.hasLink,
      hashtagCount: o.hashtagCount,
    })),
  };
}

export function hashGenerationContext(ctx: GenerationContext): string {
  return sha256Hex(canonicalSerialize(ctx));
}
