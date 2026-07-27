/**
 * Deterministic evidence (Phase ②). Turns the real AccountMetrics + observations into the immutable
 * Evidence Version and the public Evidence Section. EVERY measure value is a deterministic number
 * (a real count/proportion/average over the observations) and carries provenance back to the exact
 * posts. The model never touches these numbers.
 */
import type {
  EvidenceClaim,
  EvidenceItem,
  EvidenceVersion,
  FounderId,
  MeasureKind,
  VersionId,
} from '../domain/model';
import type { AccountMetrics, ObservationRecord } from './model';

/** Below this many imported posts we cannot responsibly diagnose the account. */
export const MIN_POSTS_FOR_DIAGNOSIS = 5;

export interface DeterministicEvidence {
  readonly sufficient: boolean;
  readonly evidence?: EvidenceVersion;
  /** The Evidence Section the founder sees — one claim grouping the deterministic measures. */
  readonly claims?: readonly EvidenceClaim[];
}

const ref = (o: ObservationRecord): string => o.permalink ?? o.postExternalId;

export function buildDeterministicEvidence(
  versionId: VersionId,
  founderId: FounderId,
  metrics: AccountMetrics,
  observations: readonly ObservationRecord[],
): DeterministicEvidence {
  if (observations.length < MIN_POSTS_FOR_DIAGNOSIS) return { sufficient: false };

  const allRefs = observations.map(ref);
  type Spec = { key: string; label: string; kind: MeasureKind; value?: number; refs: readonly string[] };
  const specs: Spec[] = [];

  specs.push({ key: 'post_count', label: 'posts analysed', kind: 'count', value: metrics.postCount, refs: allRefs });
  if (metrics.postsPerWeek != null)
    specs.push({ key: 'posts_per_week', label: 'posts per week', kind: 'count', value: metrics.postsPerWeek, refs: allRefs });

  // Content-composition signals — deterministic proportions (real count / total).
  specs.push({
    key: 'cta_pct', label: 'posts with a clear call to action', kind: 'proportion',
    value: metrics.withCtaPct ?? 0, refs: observations.filter((o) => o.hasCta).map(ref),
  });
  specs.push({
    key: 'link_pct', label: 'posts that point somewhere to act', kind: 'proportion',
    value: metrics.withLinkPct ?? 0, refs: observations.filter((o) => o.hasLink).map(ref),
  });

  // Media-type shares (each a real proportion).
  for (const [type, pct] of Object.entries(metrics.mediaTypePct).sort((a, b) => b[1] - a[1])) {
    specs.push({
      key: `media_${type.toLowerCase()}_pct`, label: `${type.toLowerCase().replace(/_/g, ' ')} posts`,
      kind: 'proportion', value: pct, refs: observations.filter((o) => (o.mediaType ?? 'UNKNOWN').toUpperCase() === type).map(ref),
    });
  }

  // Engagement — averages only over posts where Instagram actually returned the metric; else absence.
  if (metrics.avgLikes != null)
    specs.push({ key: 'avg_likes', label: 'average likes per post', kind: 'count', value: metrics.avgLikes, refs: observations.filter((o) => o.likes != null).map(ref) });
  if (metrics.avgComments != null)
    specs.push({ key: 'avg_comments', label: 'average comments per post', kind: 'count', value: metrics.avgComments, refs: observations.filter((o) => o.comments != null).map(ref) });
  if (metrics.reachAvailableCount > 0 && metrics.avgReach != null)
    specs.push({ key: 'avg_reach', label: 'average reach per post', kind: 'count', value: metrics.avgReach, refs: observations.filter((o) => o.reach != null).map(ref) });
  else
    specs.push({ key: 'reach_absent', label: 'reach', kind: 'absence', refs: [] });

  const items: EvidenceItem[] = specs.map((s, i) => ({
    evidenceItemId: `${versionId}-ei-${i}`,
    versionId,
    kind: s.kind,
    ...(s.value !== undefined ? { value: s.value } : {}),
    claimLabel: s.label,
    provenance: { source: 'deterministic', metricKey: s.key, observationRefs: s.refs },
  }));

  const evidence: EvidenceVersion = { evidenceVersionId: `${versionId}-ev`, versionId, items };

  // One Evidence Section claim grouping the deterministic measures the founder sees.
  const claims: EvidenceClaim[] = [
    {
      claimStatement: `What your ${metrics.postCount} most recent posts show`,
      measures: items.map((it) => ({ descriptor: it.claimLabel, kind: it.kind, ...(it.value !== undefined ? { value: it.value } : {}) })),
    },
  ];

  return { sufficient: true, evidence, claims };
}
