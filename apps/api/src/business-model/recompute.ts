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

/**
 * Resolve one evidence ref to the stored observed fragment id(s) it came from — PAGE-SCOPED.
 * The engine is fed one page per source (source = page URL), so a ref names its exact page;
 * the quote must exact-substring-match within THAT page. Smaller space + exact match keeps
 * honesty intact (a ref resolves only to the page it genuinely came from) while raising
 * the hit rate structurally.
 */
export function resolveEvidenceRef(ref: EvidenceRef, stored: EvidenceFragment[]): string[] {
  const wantKey = norm(ref.source);
  const needle = norm(ref.fragment);
  if (!needle) return [];
  const ids: string[] = [];
  for (const f of stored) {
    if (norm(fragmentKey(f)) !== wantKey) continue; // same page only
    const text = typeof f.payload?.['text'] === 'string' ? norm(f.payload['text'] as string) : '';
    if (text.includes(needle)) ids.push(f.id);
  }
  return [...new Set(ids)];
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
  const pieces = shapePieces(selectForEngine(observed)); // high-signal, page-scoped
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
