/**
 * Recompute adapter (M2.1 payoff). Reads observed website evidence from the store, runs
 * the FROZEN engine (@bb/business-model-engine) over it, then resolves each inferred
 * claim's evidence refs back to real stored fragment ids — FAIL CLOSED.
 *
 * Fail-closed resolution (the anti-fabrication rule, engine-output→store edge):
 *   - An inferred claim is persisted ONLY if every ref in its evidenceChain resolves to a
 *     real stored observed fragment. If ANY ref is unresolvable, the claim is REJECTED —
 *     never persisted with a partial/guessed link.
 *   - marketContext (i-know) is prior knowledge, NOT founder evidence: never persisted.
 *
 * The engine is ESM; apps/api is CJS — so it is loaded with a dynamic import().
 * The adapter emits data only; it renders nothing (reflection UI is a later slice).
 */
import type { BusinessModel, Insight, EvidenceRef } from '@bb/business-model-engine';
import { makeFragment, type EvidenceFragment, type IEvidenceRepository } from '@bb/domain';
import { createAnthropicClient } from '@bb/infrastructure';

const INSIGHT_CATEGORIES: ReadonlyArray<keyof BusinessModel> = [
  'contradictions', 'blindSpots', 'hiddenStrengths', 'hiddenWeaknesses', 'positioningOpportunities',
];

export interface RejectedClaim { category: string; statement: string; reason: string }
export interface ResolveResult { toPersist: EvidenceFragment[]; rejected: RejectedClaim[] }

/**
 * Normalize for matching: lowercase, unify smart punctuation (curly quotes, dashes,
 * ellipsis) to ASCII, collapse whitespace. This removes false-negatives from punctuation
 * differences WITHOUT weakening honesty — it's still "the same text, modulo punctuation,
 * within the same page." Not token-overlap; not fuzzy.
 */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")   // ' ' ‛ ′  → '
    .replace(/[“”‟″]/g, '"')   // " " ‟ ″  → "
    .replace(/[–—―]/g, '-')          // – — ―     → -
    .replace(/…/g, '...')                       // …        → ...
    .replace(/\s+/g, ' ')
    .trim();
}

/** Per-page identity a ref is scoped to. Engine cites the page URL (page-scoped input). */
function fragmentKey(f: EvidenceFragment): string {
  return f.sourceUrl ?? f.source;
}
const isBlock = (f: EvidenceFragment): boolean => f.payload?.['kind'] === 'block';
const pageText = (f: EvidenceFragment): string => (typeof f.payload?.['text'] === 'string' ? norm(f.payload['text'] as string) : '');

// The floor gates COINCIDENTAL BLOCK CREDIT: a block is credited in derived_from only if it
// shares a run of the quote at least this long. It NEVER rejects whole refs (that misread tanked
// hit-rate). A block — LEAF OR GROUP — sharing only a short run must not be credited; the ≤700c
// group block makes this gate matter MORE, so it applies with equal force. Not fuzzy — the
// credited run is an exact contiguous word-sequence from the quote, present verbatim in the block.
const CREDIT_MIN_WORDS = 5;
const CREDIT_MIN_CHARS = 25;

/** The quote-word indices this block covers via verbatim contiguous runs ≥ the floor. */
function coveredIndices(blockNorm: string, quoteWords: string[]): Set<number> {
  const hay = ` ${blockNorm} `;
  const cov = new Set<number>();
  for (let i = 0; i < quoteWords.length; i++) {
    for (let L = quoteWords.length - i; L >= CREDIT_MIN_WORDS; L--) {
      const run = quoteWords.slice(i, i + L).join(' ');
      if (run.length >= CREDIT_MIN_CHARS && hay.includes(` ${run} `)) { for (let k = i; k < i + L; k++) cov.add(k); break; }
    }
  }
  return cov;
}

/**
 * Resolve one evidence ref — PAGE-SCOPED. PASS test: the quote must be an EXACT contiguous
 * (normalized) substring of a PAGE fragment on the cited page (the proven mechanism). If it
 * passes, map it to the MOST SPECIFIC block fragment(s) covering it: smallest blocks first
 * (leaf/sentence), a group/section block only for spans no leaf covers. derived_from NEVER
 * regresses to the page fragment — if the span passes the page but no block covers a substantive
 * run, it is unmappable → dropped (fail closed). Not fuzzy, not a score.
 */
export function resolveEvidenceRef(ref: EvidenceRef, stored: EvidenceFragment[]): string[] {
  const wantKey = norm(ref.source);
  const needle = norm(ref.fragment);
  if (!needle) return [];
  // PASS: exact contiguous substring within a page blob on the cited page.
  const onPage = stored.some((f) => !isBlock(f) && norm(fragmentKey(f)) === wantKey && pageText(f).includes(needle));
  if (!onPage) return [];
  // Candidate blocks on the cited page with the quote-indices each covers (floor-gated).
  const quoteWords = needle.split(' ').filter(Boolean);
  const candidates: Array<{ id: string; len: number; covered: Set<number> }> = [];
  for (const b of stored) {
    if (!isBlock(b) || norm(fragmentKey(b)) !== wantKey) continue;
    const text = pageText(b);
    const covered = coveredIndices(text, quoteWords);
    if (covered.size > 0) candidates.push({ id: b.id, len: text.length, covered });
  }
  if (candidates.length === 0) return []; // unmappable → drop; NEVER credit the page fragment.
  // MOST-SPECIFIC-WINS: smallest blocks first; add a block only if it covers a not-yet-covered index.
  candidates.sort((a, b) => a.len - b.len);
  const used = new Set<number>();
  const ids: string[] = [];
  for (const c of candidates) {
    let adds = false;
    for (const idx of c.covered) if (!used.has(idx)) { adds = true; break; }
    if (adds) { ids.push(c.id); for (const idx of c.covered) used.add(idx); }
  }
  return ids;
}

/**
 * Turn the engine's inferred relational insights into persistable inferred fragments,
 * resolving derived_from to real stored ids. Fail closed on any unresolvable ref.
 * Observed register fields are the recomputed model view (trace to the raw observed
 * page fragments already in the store) and are NOT re-persisted here. marketContext is
 * never persisted.
 */
export function resolveDerivedFrom(
  founderId: string,
  model: BusinessModel,
  stored: EvidenceFragment[],
): ResolveResult {
  const toPersist: EvidenceFragment[] = [];
  const rejected: RejectedClaim[] = [];

  for (const category of INSIGHT_CATEGORIES) {
    const insights = (model[category] ?? []) as Insight[];
    for (const ins of insights) {
      const chain = ins.evidenceChain ?? [];
      if (chain.length === 0) {
        rejected.push({ category: String(category), statement: ins.statement, reason: 'no evidence chain — rejected (fail closed)' });
        continue;
      }
      const resolvedIds: string[] = [];
      let unresolvable: string | null = null;
      for (const ref of chain) {
        const ids = resolveEvidenceRef(ref, stored);
        if (ids.length === 0) { unresolvable = `${ref.source}: "${ref.fragment.slice(0, 60)}"`; break; }
        resolvedIds.push(...ids);
      }
      if (unresolvable) {
        rejected.push({ category: String(category), statement: ins.statement, reason: `evidence ref does not resolve to a stored fragment (${unresolvable}) — rejected, not persisted (fail closed)` });
        continue;
      }
      const derivedFrom = [...new Set(resolvedIds)];
      try {
        toPersist.push(makeFragment({
          founderId,
          source: 'business-model',
          sourceUrl: null,
          confidenceKind: 'inferred',
          visibility: 'founder_only',
          derivedFrom,
          payload: {
            statement: ins.statement,
            category: String(category),
            contributingFields: ins.contributingFields ?? [],
            evidenceChain: chain,
          },
        }));
      } catch (e) {
        rejected.push({ category: String(category), statement: ins.statement, reason: `honesty gate rejected: ${(e as Error).message}` });
      }
    }
  }
  return { toPersist, rejected };
}

// Highest-signal page types (timing + hit-rate): fewer, cleaner pages fed to the engine.
const HIGH_SIGNAL_TYPES = ['home', 'about', 'services', 'pricing'];
const ENGINE_PAGE_CAP = 5;

/**
 * Select the high-signal subset of stored pages to FEED the engine (all pages remain in
 * the store as durable evidence — this only narrows what's synthesized). Fewer, cleaner
 * pages = faster recompute AND cleaner per-page ref resolution.
 */
function selectForEngine(observed: EvidenceFragment[], cap = ENGINE_PAGE_CAP): EvidenceFragment[] {
  const typeOf = (f: EvidenceFragment) => String(f.payload?.['pageType'] ?? 'other');
  const primary = observed.filter((f) => HIGH_SIGNAL_TYPES.includes(typeOf(f)));
  const rest = observed.filter((f) => !HIGH_SIGNAL_TYPES.includes(typeOf(f)));
  return [...primary, ...rest].slice(0, cap);
}

/** Page-scoped engine input: one piece per page, source = page URL (so refs name their page). */
function shapePieces(selected: EvidenceFragment[]): Array<{ source: string; content: string }> {
  return selected
    .filter((f) => typeof f.payload?.['text'] === 'string' && (f.payload['text'] as string).length > 0)
    .map((f) => ({ source: fragmentKey(f), content: f.payload['text'] as string }));
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced && fenced[1] ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in engine response.');
  return JSON.parse(body.slice(start, end + 1));
}

export interface RecomputeResult {
  model: BusinessModel;
  persisted: number;
  deduped: number;
  rejected: RejectedClaim[];
  observedCount: number;
  enginePages: string[]; // the page-URL source labels fed to the engine (diagnostic)
}

/**
 * Live recompute: observed website evidence → frozen engine → fail-closed resolution →
 * persist inferred fragments. Returns data only (no reflection rendering).
 */
export async function recomputeFromWebsite(args: {
  founderId: string;
  repo: IEvidenceRepository;
  anthropicApiKey: string;
  model?: string;
}): Promise<RecomputeResult> {
  const engine = await import('@bb/business-model-engine');
  const observed = await args.repo.findObserved(args.founderId, 'website');
  const pageFragments = observed.filter((f) => f.payload?.['kind'] !== 'block'); // engine input stays page-scoped (blocks are resolution-only)
  const pieces = shapePieces(selectForEngine(pageFragments)); // high-signal, page-scoped
  const sourceNames = [...new Set(pieces.map((p) => p.source))];
  const declared = sourceNames.filter((s) => engine.DECLARED_PATTERN.test(s));

  const client = createAnthropicClient(args.anthropicApiKey);
  const resp = await client.messages.create({
    model: args.model ?? 'claude-sonnet-4-6',
    max_tokens: 8000, // must clear the engine's verbose artifact to avoid truncation; makes timing worse — the core tension (see M2.1 tuning findings).
    system: engine.buildSystemPrompt(sourceNames, declared),
    messages: [{ role: 'user', content: engine.buildUserMessage(pieces) }],
  });
  const text = resp.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
  const { model } = engine.validateModel(extractJson(text), sourceNames);

  const { toPersist, rejected } = resolveDerivedFrom(args.founderId, model, observed);
  const { stored, deduped } = await args.repo.appendMany(toPersist);
  return { model, persisted: stored, deduped, rejected, observedCount: observed.length, enginePages: sourceNames };
}

// ── M2.2: recompute ACROSS sources (website + upload), shared path, engine unchanged ─────────
const ENGINE_MULTI_CAP = 8;

/** Select high-signal engine input across sources. Upload AND google units are fresh, founder-
 * specific PRIVATE evidence → included first (both authenticated and unauthenticated sources are
 * first-class, ADR-009 Inv 1), then high-signal website pages. Page-scoped; blocks stay
 * resolution-only. */
const FRESH_SOURCES = ['upload', 'google'];
function selectForEngineMulti(pageFragments: EvidenceFragment[], cap = ENGINE_MULTI_CAP): EvidenceFragment[] {
  const fresh = pageFragments.filter((f) => FRESH_SOURCES.includes(f.source));
  const web = pageFragments.filter((f) => !FRESH_SOURCES.includes(f.source));
  const typeOf = (f: EvidenceFragment) => String(f.payload?.['pageType'] ?? 'other');
  const primaryWeb = web.filter((f) => HIGH_SIGNAL_TYPES.includes(typeOf(f)));
  const restWeb = web.filter((f) => !HIGH_SIGNAL_TYPES.includes(typeOf(f)));
  return [...fresh, ...primaryWeb, ...restWeb].slice(0, cap);
}

export interface CeilingViolation { statement: string; reason: string }

/**
 * EPISTEMIC CEILING (spec §5.2 / §13.4). External-reality claims are the engine's marketContext
 * class — prior knowledge (i-know), never founder evidence. Enforce: a marketContext item may
 * NOT carry an evidence chain (citing an upload or website fragment would launder a founder's
 * private document into a claim about the outside world). Such items are rejected. Founder-
 * business insights (the insight categories) may cite upload evidence — that is a legitimate
 * inference from the founder's own document, not an external-reality claim.
 */
export function enforceEpistemicCeiling(model: BusinessModel): CeilingViolation[] {
  const mc = (model.marketContext ?? []) as Array<{ statement?: string; evidenceChain?: unknown[] }>;
  const violations: CeilingViolation[] = [];
  for (const item of mc) {
    const chain = Array.isArray(item.evidenceChain) ? item.evidenceChain : [];
    if (chain.length > 0) violations.push({
      statement: String(item.statement ?? ''),
      reason: 'marketContext (external reality) must be prior knowledge — may not cite a founder evidence chain (upload or website); rejected (epistemic ceiling)',
    });
  }
  return violations;
}

export interface MultiSourceResult extends RecomputeResult { ceilingRejected: CeilingViolation[] }

/**
 * Live recompute across ALL observed sources (website + upload) → frozen engine → fail-closed
 * resolution spanning sources (per-source by source_url — upload:// vs https:// resolve to their
 * own fragments) → epistemic-ceiling enforcement → persist inferred. Shared path; engine unchanged.
 */
export async function recomputeFromSources(args: {
  founderId: string; repo: IEvidenceRepository; anthropicApiKey: string; model?: string;
}): Promise<MultiSourceResult> {
  const engine = await import('@bb/business-model-engine');
  const observed = await args.repo.findObserved(args.founderId); // ALL sources
  const pageFragments = observed.filter((f) => f.payload?.['kind'] !== 'block');
  const pieces = shapePieces(selectForEngineMulti(pageFragments));
  const sourceNames = [...new Set(pieces.map((p) => p.source))];
  const declared = sourceNames.filter((s) => engine.DECLARED_PATTERN.test(s));

  const client = createAnthropicClient(args.anthropicApiKey);
  const resp = await client.messages.create({
    model: args.model ?? 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: engine.buildSystemPrompt(sourceNames, declared),
    // Document/website text enters ONLY here, as evidence CONTENT (data) — never the system
    // (instruction) position. Prompt-injection in a doc is inert-by-position; fail-closed
    // resolution is defense-in-depth (a fabricated instruction can't produce a traceable claim).
    messages: [{ role: 'user', content: engine.buildUserMessage(pieces) }],
  });
  const text = resp.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
  const { model } = engine.validateModel(extractJson(text), sourceNames);

  const ceilingRejected = enforceEpistemicCeiling(model); // drop laundered external-reality claims
  const { toPersist, rejected } = resolveDerivedFrom(args.founderId, model, observed); // fail-closed, spans sources
  const { stored, deduped } = await args.repo.appendMany(toPersist);
  return { model, persisted: stored, deduped, rejected, observedCount: observed.length, enginePages: sourceNames, ceilingRejected };
}
