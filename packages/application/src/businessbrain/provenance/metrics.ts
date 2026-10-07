/**
 * Deterministic account metrics (Phase ②). Every value is a real computation over the persisted
 * observations — no model, no fixtures, nothing invented. A quantity that cannot be computed
 * (no posts, or a metric Instagram never returned) is null. Percentages are exact count/total.
 */
import type { AccountMetrics, ObservationRecord } from './model';

function round(n: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
function avg(nums: readonly number[], dp = 0): number | null {
  if (nums.length === 0) return null;
  return round(nums.reduce((a, b) => a + b, 0) / nums.length, dp);
}
function pct(count: number, total: number): number | null {
  if (total <= 0) return null;
  return round((count / total) * 100, 0);
}

export function computeAccountMetrics(
  observations: readonly ObservationRecord[],
  followersCount: number | null,
): AccountMetrics {
  const postCount = observations.length;

  const times = observations
    .map((o) => (o.postedAt ? Date.parse(o.postedAt) : NaN))
    .filter((t) => Number.isFinite(t)) as number[];
  const minT = times.length ? Math.min(...times) : null;
  const maxT = times.length ? Math.max(...times) : null;
  const windowFrom = minT != null ? new Date(minT).toISOString() : null;
  const windowTo = maxT != null ? new Date(maxT).toISOString() : null;
  const spanDays = minT != null && maxT != null ? round((maxT - minT) / 86_400_000, 1) : null;
  const postsPerWeek =
    spanDays != null && spanDays > 0 ? round(postCount / (spanDays / 7), 1) : null;

  const mediaTypeCounts: Record<string, number> = {};
  for (const o of observations) {
    const k = (o.mediaType ?? 'UNKNOWN').toUpperCase();
    mediaTypeCounts[k] = (mediaTypeCounts[k] ?? 0) + 1;
  }
  const mediaTypePct: Record<string, number> = {};
  for (const [k, v] of Object.entries(mediaTypeCounts)) mediaTypePct[k] = pct(v, postCount) ?? 0;

  const withCtaCount = observations.filter((o) => o.hasCta).length;
  const withLinkCount = observations.filter((o) => o.hasLink).length;

  const reachVals = observations.map((o) => o.reach).filter((n): n is number => n != null);
  const likeVals = observations.map((o) => o.likes).filter((n): n is number => n != null);
  const commentVals = observations.map((o) => o.comments).filter((n): n is number => n != null);

  return {
    postCount,
    windowFrom,
    windowTo,
    spanDays,
    postsPerWeek,
    mediaTypeCounts,
    mediaTypePct,
    withCtaCount,
    withCtaPct: pct(withCtaCount, postCount),
    withLinkCount,
    withLinkPct: pct(withLinkCount, postCount),
    avgCaptionChars: avg(observations.map((o) => o.captionLength)),
    avgHashtags: avg(observations.map((o) => o.hashtagCount), 1),
    reachAvailableCount: reachVals.length,
    avgReach: avg(reachVals),
    avgLikes: avg(likeVals),
    avgComments: avg(commentVals),
    followersCount,
  };
}
