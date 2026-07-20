/**
 * Wave 3 — NON-PRODUCTION controlled-outcome market adapter (dev/test only). It lets the REAL durable review
 * worker + state machine + polling + UI exercise every terminal/failure outcome deterministically, WITHOUT a
 * frontend simulator and WITHOUT touching normal public-site retrieval.
 *
 * Safety (all required):
 *  - disabled by default (only active when MARKET_FIXTURE_ADAPTER is truthy);
 *  - refuses to start in production-capable mode (throws);
 *  - delegates EVERY real URL to the wrapped real adapter/model — the ONLY trigger is the reserved dev host
 *    `fixture.market.test` (a .test TLD that can never resolve to a real founder site);
 *  - no credentials/internal details are ever surfaced (outcomes flow through the normal founder-safe messages).
 *
 * Fixture URLs: https://fixture.market.test/<outcome> where <outcome> ∈ ready | robots-blocked | unreachable |
 * unsupported | insufficient | retrieval-failed | inference-failed.
 */
import { isProductionCapable } from './model-config';
import type { MarketInferenceInput, MarketInferenceModel, MarketInferenceResult, ResearchAdapter, RetrievalResult } from './market-context';

export const FIXTURE_HOST = 'fixture.market.test';
export const FIXTURE_ENV = 'MARKET_FIXTURE_ADAPTER';
const INFERENCE_FAIL_SENTINEL = '__FIXTURE_INFERENCE_FAILED__';

export type FixtureOutcome = 'ready' | 'robots-blocked' | 'unreachable' | 'unsupported' | 'insufficient' | 'retrieval-failed' | 'inference-failed';
export const FIXTURE_OUTCOMES: readonly FixtureOutcome[] = ['ready', 'robots-blocked', 'unreachable', 'unsupported', 'insufficient', 'retrieval-failed', 'inference-failed'];

export function isFixtureUrl(url: string): boolean {
  try { return new URL(url).host.toLowerCase() === FIXTURE_HOST; } catch { return false; }
}
export function fixtureOutcomeOf(url: string): FixtureOutcome | null {
  try {
    if (new URL(url).host.toLowerCase() !== FIXTURE_HOST) return null;
    const seg = new URL(url).pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
    return (FIXTURE_OUTCOMES as readonly string[]).includes(seg) ? (seg as FixtureOutcome) : null;
  } catch { return null; }
}

function readablePages(url: string, text: string): RetrievalResult {
  return { pages: [{ url, canonicalUrl: url, title: 'Controlled fixture', text, sourceType: 'homepage' }], attempted: [url], retrieved: [url], skipped: [], blocked: [], outcomes: [{ url, outcome: 'retrieved' }] };
}
function emptyResult(url: string, outcome: 'blocked' | 'unreachable' | 'unsupported' | 'empty'): RetrievalResult {
  return { pages: [], attempted: [url], retrieved: [], skipped: [], blocked: outcome === 'blocked' ? [url] : [], outcomes: [{ url, outcome }] };
}

/** Decorator: controlled outcomes for the reserved fixture host; real URLs delegate to the wrapped adapter. */
export class FixtureResearchAdapter implements ResearchAdapter {
  readonly name: string;
  readonly extractionVersion: string;
  readonly supportsDiscovery: boolean;
  constructor(private readonly real: ResearchAdapter) {
    this.name = real.name; this.extractionVersion = real.extractionVersion; this.supportsDiscovery = real.supportsDiscovery;
  }
  async retrieve(url: string): Promise<RetrievalResult> {
    const outcome = fixtureOutcomeOf(url);
    if (outcome === null) return this.real.retrieve(url); // normal public-site retrieval — untouched
    switch (outcome) {
      case 'ready': return readablePages(url, 'Controlled fixture: a demo studio offering brand strategy and positioning for early-stage founders, with a clear services page and pricing from $1,500/mo.');
      case 'inference-failed': return readablePages(url, `Controlled fixture with readable content. ${INFERENCE_FAIL_SENTINEL}`);
      case 'robots-blocked': return emptyResult(url, 'blocked');
      case 'unreachable': return emptyResult(url, 'unreachable');
      case 'unsupported': return emptyResult(url, 'unsupported');
      case 'insufficient': return emptyResult(url, 'empty');
      case 'retrieval-failed': throw new Error('fixture: controlled retrieval failure');
    }
  }
}

/** Decorator: throws on the inference-failed fixture sentinel; every other input delegates to the real model. */
export class FixtureInferenceModel implements MarketInferenceModel {
  readonly version: string;
  readonly modelId?: string;
  readonly promptVersion?: string;
  constructor(private readonly real: MarketInferenceModel) {
    this.version = real.version; this.modelId = real.modelId; this.promptVersion = real.promptVersion;
  }
  async infer(input: MarketInferenceInput): Promise<MarketInferenceResult> {
    if (input.observed.some((p) => p.text.includes(INFERENCE_FAIL_SENTINEL))) throw new Error('fixture: controlled inference failure');
    return this.real.infer(input);
  }
}

/**
 * Gate: wrap the real adapter + inference model with the fixture decorators ONLY when explicitly enabled and
 * NOT in production-capable mode. Off → returns the real pair unchanged (zero effect). Enabled in production →
 * throws (impossible to activate accidentally in production).
 */
export function maybeWrapMarketFixtures(adapter: ResearchAdapter, inferenceModel: MarketInferenceModel): { adapter: ResearchAdapter; inferenceModel: MarketInferenceModel; fixturesEnabled: boolean } {
  const enabled = ['1', 'true', 'yes', 'on'].includes((process.env[FIXTURE_ENV] ?? '').trim().toLowerCase());
  if (!enabled) return { adapter, inferenceModel, fixturesEnabled: false };
  if (isProductionCapable()) throw new Error(`[fixtures] ${FIXTURE_ENV} must NEVER be enabled in production-capable mode (NODE_ENV=production).`);
  return { adapter: new FixtureResearchAdapter(adapter), inferenceModel: new FixtureInferenceModel(inferenceModel), fixturesEnabled: true };
}
