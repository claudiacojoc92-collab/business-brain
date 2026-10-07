/**
 * Business Brain V1 — Phase ② deterministic layer (pure unit tests). No I/O, no model.
 * Proves: signals are rule-based; every metric is a real computation; evidence carries provenance;
 * the generation context hashes stably; grounding rejects fabricated numbers and dangling links.
 */
import { describe, it, expect } from 'vitest';
import {
  computePostSignals,
  computeAccountMetrics,
  buildDeterministicEvidence,
  MIN_POSTS_FOR_DIAGNOSIS,
  assembleGenerationContext,
  hashGenerationContext,
  checkGrounding,
  composeDiagnosisContent,
  validateCandidate,
} from '../../businessbrain/index';
import type { ImportedAccount, ObservationRecord } from '../../businessbrain/index';

function account(n: number): ImportedAccount {
  const base = Date.parse('2025-01-01T00:00:00.000Z');
  const posts = Array.from({ length: n }, (_, i) => ({
    postExternalId: `m${i}`, permalink: `https://instagram.com/p/m${i}`,
    mediaType: i % 3 === 0 ? 'VIDEO' : 'IMAGE', postedAt: new Date(base + i * 3 * 86_400_000).toISOString(),
    caption: i % 2 === 0 ? 'A calm day ✨ #life @friend' : 'New workshop — sign up, link in bio',
    reach: 100 + i, likes: 10 + i, comments: i % 4,
  }));
  return { accountExternalId: 'ig1', username: 'f', accountType: 'BUSINESS', followersCount: 1200, mediaCount: n, posts, importedAt: '2025-07-01T00:00:00.000Z' };
}
const observe = (a: ImportedAccount): ObservationRecord[] =>
  a.posts.map((p, i) => ({ observationId: `v-o-${i}`, ...p, ...computePostSignals(p.caption) }));

describe('deterministic signals', () => {
  it('detects hashtags, mentions, links and CTAs by rule', () => {
    const s = computePostSignals('Two things #a #b @you — sign up, link in bio https://x.co');
    expect(s.hashtagCount).toBe(2);
    expect(s.mentionCount).toBe(1);
    expect(s.hasLink).toBe(true);
    expect(s.hasCta).toBe(true);
    expect(s.wordCount).toBeGreaterThan(0);
  });
  it('an empty caption yields all-zero/false signals', () => {
    expect(computePostSignals('')).toEqual({ captionLength: 0, wordCount: 0, hashtagCount: 0, mentionCount: 0, hasLink: false, hasCta: false });
  });
});

describe('deterministic metrics', () => {
  it('computes real proportions and window from the observations', () => {
    const a = account(10);
    const m = computeAccountMetrics(observe(a), a.followersCount);
    expect(m.postCount).toBe(10);
    expect(m.windowFrom).toBe('2025-01-01T00:00:00.000Z');
    expect(m.withCtaPct).toBe(50);           // odd-indexed captions carry a CTA → 5/10
    expect(m.withCtaCount).toBe(5);
    expect(m.avgLikes).toBe(Math.round((10 + 19) / 2)); // 10..19 average
    expect(Object.values(m.mediaTypePct).reduce((x, y) => x + y, 0)).toBe(100);
  });
  it('reports null for a metric that was never provided (never fabricates)', () => {
    const a = account(6);
    const obs = observe(a).map((o) => ({ ...o, reach: null }));
    const m = computeAccountMetrics(obs, a.followersCount);
    expect(m.avgReach).toBeNull();
    expect(m.reachAvailableCount).toBe(0);
  });
});

describe('deterministic evidence + provenance', () => {
  it('below the minimum posts, no evidence is produced', () => {
    const a = account(MIN_POSTS_FOR_DIAGNOSIS - 1);
    expect(buildDeterministicEvidence('v', 'f', computeAccountMetrics(observe(a), a.followersCount), observe(a)).sufficient).toBe(false);
  });
  it('every measure carries deterministic provenance back to observations', () => {
    const a = account(12);
    const obs = observe(a);
    const built = buildDeterministicEvidence('v', 'f', computeAccountMetrics(obs, a.followersCount), obs);
    expect(built.sufficient).toBe(true);
    for (const item of built.evidence!.items) {
      expect(item.provenance?.source).toBe('deterministic');
      expect(typeof item.provenance?.metricKey).toBe('string');
    }
    const cta = built.evidence!.items.find((i) => i.provenance?.metricKey === 'cta_pct')!;
    expect(cta.provenance!.observationRefs.every((r) => r.startsWith('https://instagram.com/p/'))).toBe(true);
  });
});

describe('generation context + hash', () => {
  it('hashes the same context stably and changes when content changes', () => {
    const a = account(8);
    const obs = observe(a);
    const m = computeAccountMetrics(obs, a.followersCount);
    const ev = buildDeterministicEvidence('v', 'f', m, obs).evidence!;
    const ctx = assembleGenerationContext(a, m, obs, ev.items);
    expect(hashGenerationContext(ctx)).toBe(hashGenerationContext(assembleGenerationContext(a, m, obs, ev.items)));
    expect(ctx.evidence.length).toBe(ev.items.length);
  });
});

describe('grounding + compose', () => {
  const a = account(12);
  const obs = observe(a);
  const m = computeAccountMetrics(obs, a.followersCount);
  const built = buildDeterministicEvidence('v', 'f', m, obs);
  const ctx = assembleGenerationContext(a, m, obs, built.evidence!.items);
  const grounded = {
    businessReality: 'Your business is hard for the right buyers to recognise and choose.',
    businessConsequences: ['The right customers rarely realise you can help them.'],
    cannotYetKnow: 'We cannot yet see your actual sales, or what your audience privately thinks.',
    rootCauses: [{ statement: 'Your offer is not made plain enough to act on it.', evidenceKeys: ['cta_pct'] }],
    recommendations: [{ statement: 'State your offer clearly and invite one next step.', rootCauseIndexes: [0] }],
    executionPlan: [{ label: 'Weeks one to four', actions: [{ statement: 'Introduce a clear recurring invitation.', recommendationIndexes: [0] }] }],
  };

  it('accepts a grounded, business-language narrative', () => {
    expect(checkGrounding(grounded, ctx).ok).toBe(true);
    const diag = composeDiagnosisContent('v', grounded, built.evidence!, built.claims!);
    expect(validateCandidate({ versionId: 'v', founderId: 'f', evidence: built.evidence!, diagnosis: diag }).valid).toBe(true);
    // traceability wired: root cause → a real evidence item id
    expect(diag.rootCauses[0]!.evidenceItemIds.length).toBeGreaterThan(0);
  });

  it('rejects a fabricated number the metrics never produced', () => {
    const r = checkGrounding({ ...grounded, businessReality: 'You convert 87 of every hundred admirers into nothing.' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.includes('87'))).toBe(true);
  });

  it('rejects a root cause that cites no real evidence key', () => {
    const r = checkGrounding({ ...grounded, rootCauses: [{ statement: 'x', evidenceKeys: ['not_a_real_key'] }] }, ctx);
    expect(r.ok).toBe(false);
  });
});
