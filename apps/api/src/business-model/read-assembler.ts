/**
 * Business Read assembler (S1-T1, ADR-010). COMPOSES the six frozen Business Read sections from output
 * the nucleus ALREADY produced — it runs NO inference: it never imports the engine, never calls
 * recomputeFromSources / Anthropic / buildWhatMattersNow, never mutates evidence, and is DETERMINISTIC
 * given the same inputs. It consumes the persisted substrate (fragments + stored recommendations) and,
 * optionally, one already-computed MultiSourceResult (for the engine's transient rejects/ceiling signals).
 *
 * It is presentation-agnostic: it carries STRUCTURED claim data (statement + epistemic kind + provenance
 * + the internal category for traceability), never pre-rendered prose — the Language Blueprint governs
 * presentation later (S1-T6), and the S0-T5 founderCategory map applies the founder vocabulary at that
 * boundary. There is NO rank/stakes/priority field anywhere: attention-direction is not this service's job.
 */
import type { EvidenceFragment } from '@bb/domain';
import { groundedTensions } from './what-matters';
import { toRecommendationView, type StoredRecommendation } from './recommendation-service';
import type { MultiSourceResult } from './recompute';

export type EpistemicKind = 'observed' | 'declared' | 'inferred';
export type SectionId = 'what_i_read' | 'what_i_observe' | 'gaps' | 'bets' | 'my_read' | 'cannot_see';

export interface Provenance {
  fragmentIds: string[];              // every id must resolve to a real fragment (fail-closed)
  declaredFragmentIds?: string[];     // S3 only — the "story" (declared) side of a Gap
  observedFragmentIds?: string[];     // S3 only — the "evidence" (observed) side of a Gap
}
export interface ReadClaim {
  statement: string;                  // the engine's own text, VERBATIM — never rewritten here
  epistemicKind: EpistemicKind;       // observed | declared | inferred — never collapsed
  internalCategory?: string;          // frozen engine enum, carried for traceability — NEVER rendered
  provenance: Provenance;
}
export interface RecommendationClaim extends ReadClaim {
  disclosure: {
    evidenceBasis: Array<{ id: string; quote: string }>;
    assumptions: string[];
    confidence: string;
    truthStatus: 'inferred';          // the Layer-1 substrate stays inference (proven by toRecommendationView)
  };
}
export interface SourceManifestEntry { source: string; itemCount: number; earliest?: string; latest?: string }
export interface Limit { kind: 'absent_source' | 'engine_rejected' | 'ceiling'; detail: string; source?: string }
export interface ReadSection {
  id: SectionId;
  title: string;
  empty: boolean;
  claims?: Array<ReadClaim | RecommendationClaim>;
  manifest?: SourceManifestEntry[];
  limits?: Limit[];
}
export interface BusinessRead { founderId: string; sections: ReadSection[]; assembledAt: string }

// The known observed source types (mirrors what-matters' OBSERVED_SOURCES — a local presentation constant,
// not a shared internal enum). Fixed order = neutral, deterministic S1/S6 ordering (no importance).
const OBSERVED_SOURCES = ['website', 'upload', 'google', 'google-calendar'] as const;
const S2_MAX_OBSERVATIONS = 8; // conservative cap — empty/omission over padding weak content

const iso = (d: Date | null | undefined): string | undefined => (d == null ? undefined : new Date(d).toISOString());
const stmt = (f: EvidenceFragment | undefined, key: string): string => String(f?.payload?.[key] ?? '');
const isBlock = (f: EvidenceFragment): boolean => f.payload?.['kind'] === 'block';

/**
 * assembleRead — compose the six sections. founderId is explicit (correct for the empty case and a
 * defensive isolation boundary: only this founder's fragments are ever composed). `now` is injectable so
 * the result is fully deterministic (assembledAt included) for identical inputs.
 */
export function assembleRead(
  founderId: string,
  fragments: EvidenceFragment[],
  recommendations: StoredRecommendation[],
  result?: MultiSourceResult,
  now: Date = new Date(),
): BusinessRead {
  // Defensive isolation: never compose another founder's fragment, even if a caller passes mixed input.
  const own = fragments.filter((f) => f.founderId === founderId);
  const byId = new Map(own.map((f) => [f.id, f]));
  const resolves = (ids: readonly string[] | null | undefined): boolean =>
    Array.isArray(ids) && ids.length > 0 && ids.every((id) => byId.has(id));

  return {
    founderId,
    assembledAt: now.toISOString(),
    sections: [
      sectionWhatIRead(own),
      sectionWhatIObserve(own),
      sectionGaps(own, byId, resolves),
      sectionBets(),
      sectionMyRead(recommendations, byId),
      sectionCannotSee(own, result),
    ],
  };
}

// ── S1 · What I Read — factual ingest manifest (no interpretation) ─────────────────────────────
function sectionWhatIRead(own: EvidenceFragment[]): ReadSection {
  // "Read" = the CONNECTED SOURCES ingested from the world (observed only). Declared answers are "what you
  // told me" (the Position side, surfaced via S3 provenance), not an ingested source; inferred is what the
  // instrument PRODUCED, not read. Count units (non-block).
  const bySource = new Map<string, EvidenceFragment[]>();
  for (const f of own) {
    if (f.confidenceKind !== 'observed' || isBlock(f)) continue;
    (bySource.get(f.source) ?? bySource.set(f.source, []).get(f.source)!).push(f);
  }
  const order = (s: string): number => { const i = (OBSERVED_SOURCES as readonly string[]).indexOf(s); return i === -1 ? OBSERVED_SOURCES.length : i; };
  const manifest: SourceManifestEntry[] = [...bySource.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
    .map(([source, frs]) => {
      const dates = frs.map((f) => (f.occurredAt ?? f.capturedAt).getTime()).sort((x, y) => x - y);
      return { source, itemCount: frs.length, earliest: iso(new Date(dates[0]!)), latest: iso(new Date(dates[dates.length - 1]!)) };
    });
  return { id: 'what_i_read', title: 'What I Read', empty: manifest.length === 0, manifest };
}

// ── S2 · What I Observe — observed grounded content ONLY (no inferred leak) ─────────────────────
function sectionWhatIObserve(own: EvidenceFragment[]): ReadSection {
  const observed = own
    .filter((f) => f.confidenceKind === 'observed' && !isBlock(f) && stmt(f, 'text'))
    .sort((a, b) => a.source.localeCompare(b.source) || a.capturedAt.getTime() - b.capturedAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, S2_MAX_OBSERVATIONS);
  const claims: ReadClaim[] = observed.map((f) => ({
    statement: stmt(f, 'text'),
    epistemicKind: 'observed',
    provenance: { fragmentIds: [f.id] },
  }));
  return { id: 'what_i_observe', title: 'What I Observe', empty: claims.length === 0, claims };
}

// ── S3 · Where Story & Evidence Diverge (Gap) — the pure grounded-tension FILTER (no rank/stakes) ──
function sectionGaps(own: EvidenceFragment[], byId: Map<string, EvidenceFragment>, resolves: (ids: readonly string[] | null | undefined) => boolean): ReadSection {
  const inferred = own.filter((f) => f.confidenceKind === 'inferred');
  const grounded = groundedTensions(inferred, byId) // spans declared∧observed, tension category — fail-closed
    .filter((g) => resolves(g.f.derivedFrom) && g.declaredIds.length > 0 && g.observedIds.length > 0)
    .sort((a, b) => a.f.id.localeCompare(b.f.id)); // NEUTRAL deterministic order (content-hash) — never TENSION_RANK
  const claims: ReadClaim[] = grounded.map((g) => ({
    statement: stmt(g.f, 'statement'),
    epistemicKind: 'inferred',
    internalCategory: stmt(g.f, 'category'), // frozen enum, for traceability — never rendered
    provenance: { fragmentIds: [...(g.f.derivedFrom ?? [])], declaredFragmentIds: g.declaredIds, observedFragmentIds: g.observedIds },
  }));
  return { id: 'gaps', title: 'Where Story & Evidence Diverge', empty: claims.length === 0, claims };
}

// ── S4 · What You're Betting On — INTENTIONALLY EMPTY ───────────────────────────────────────────
function sectionBets(): ReadSection {
  // INTENTIONALLY EMPTY — no honest Bet source in frozen engine output. Bets are founder-authored; S4
  // fills only when a genuine Bet primitive exists. Empty here is epistemic honesty (Art I/V), NOT
  // technical debt. Do NOT infer Bets from coreBeliefs, recommendations, tensions, or any existing output.
  // See S1-T1 plan §1 + approved decision.
  return { id: 'bets', title: "What You're Betting On", empty: true, claims: [] };
}

// ── S5 · My Read — the EXISTING Recommendation primitive + disclosure (no generation here) ──────
function sectionMyRead(recommendations: StoredRecommendation[], byId: Map<string, EvidenceFragment>): ReadSection {
  const claims: RecommendationClaim[] = [];
  for (const stored of [...recommendations].sort((a, b) => a.claimFragmentId.localeCompare(b.claimFragmentId))) {
    const view = toRecommendationView(stored, byId); // fail-closed: null when the claim is missing or not 'inferred'
    if (!view) continue;
    claims.push({
      statement: view.recommendation, // = the engine's claim statement, framed as a read (recommendation-service)
      epistemicKind: 'inferred',
      internalCategory: stmt(byId.get(view.claimFragmentId), 'category'),
      provenance: { fragmentIds: view.evidenceBasis.map((b) => b.id) },
      disclosure: { evidenceBasis: view.evidenceBasis, assumptions: view.assumptions, confidence: view.confidence, truthStatus: 'inferred' },
    });
  }
  return { id: 'my_read', title: 'My Read', empty: claims.length === 0, claims };
}

// ── S6 · What I Cannot See Yet — instrument limits, never founder incompleteness ────────────────
function sectionCannotSee(own: EvidenceFragment[], result?: MultiSourceResult): ReadSection {
  const present = new Set(own.filter((f) => f.confidenceKind === 'observed').map((f) => f.source));
  const limits: Limit[] = [];
  for (const s of OBSERVED_SOURCES) {
    if (!present.has(s)) limits.push({ kind: 'absent_source', source: s, detail: `No ${s} source is connected yet — a dimension of your business I cannot see.` });
  }
  // The engine's TRANSIENT known-unknowns (only when a recompute result is supplied).
  if (result) {
    for (const r of result.rejected) limits.push({ kind: 'engine_rejected', detail: `A read was dropped for lack of resolvable evidence: ${r.reason}` });
    for (const c of result.ceilingRejected) limits.push({ kind: 'ceiling', detail: `External-reality claim held back (not founder evidence): ${c.reason}` });
  }
  return { id: 'cannot_see', title: 'What I Cannot See Yet', empty: limits.length === 0, limits };
}
