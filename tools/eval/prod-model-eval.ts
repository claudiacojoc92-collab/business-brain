/**
 * Wave-2 debt B — production-model evaluation harness. Evaluates the two model-dependent Layer-2 capabilities
 * SEPARATELY (Business Understanding synthesis, Market-context inference) for the configured model
 * (claude-sonnet-5) vs the claude-sonnet-4-6 baseline, on identical synthetic fixtures with the EXACT
 * production prompts (imported, never copied) and the EXACT production normalizers. Deterministic (temperature 0).
 * Emits one structured JSON record per (capability, fixture, model). No secrets are printed. Synthetic
 * fixtures only. Run via the bundled runner: tools/eval/run-prod-model-eval.cjs.
 */
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM as SYNTH_SYSTEM } from '../../apps/api/src/business-model/anthropic-synthesis.model';
import { SYSTEM as MARKET_SYSTEM } from '../../apps/api/src/business-model/anthropic-market-inference';
import { normalizeConclusions, MARKET_TYPES } from '../../apps/api/src/business-model/understanding';
import { capMarketEpistemics } from '../../apps/api/src/business-model/market-context';

const MODELS = { baseline: 'claude-sonnet-4-6', configured: 'claude-sonnet-5' } as const;
const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
const client = new Anthropic({ apiKey });

type Pair = [string, string];
interface SynthFixture { id: string; note: string; pages: Pair[]; declared?: Pair }        // declared = founder claim conflicting with site
interface MarketFixture { id: string; note: string; entityName: string; entityType: string; founderBusiness: string; pages: Pair[] }

// ── Synthesis fixtures (Step 4 catalogue) ──────────────────────────────────────────────────────────────
const SYNTH: SynthFixture[] = [
  { id: 'clear', note: 'information-rich', pages: [['h', '(home) Fractional CFO services for seed-stage SaaS. Monthly financial modeling, fundraising prep, board reporting from $2,500/mo.'], ['a', '(about) Ex-Big-4 CFO; we plug in 2 days/week for founders not ready for a full-time hire.']] },
  { id: 'ambiguous', note: 'ambiguous positioning', pages: [['h', '(home) We tell stories that move people. A creative studio for brands that dare.'], ['a', '(about) Strategy, design, magic. We partner with visionaries.']] },
  { id: 'sparse', note: 'sparse website', pages: [['h', '(home) Welcome to Rivera Consulting.']] },
  { id: 'contradictory', note: 'contradictory pages', pages: [['h', '(home) Bespoke, premium branding for luxury clients — fully custom, from $25,000.'], ['p', '(pricing) Grab our $19 logo template pack — DIY branding for anyone on a budget.']] },
  { id: 'empty', note: 'empty/nearly empty', pages: [] },
  { id: 'promo_no_evidence', note: 'promotional claims without evidence', pages: [['h', "(home) The #1 growth partner for ambitious brands. Proven results. Award-winning. Trusted by the best."], ['a', '(about) We deliver unmatched ROI and industry-leading outcomes, every time.']] },
  { id: 'multi_offer', note: 'multiple offers/audiences', pages: [['h', '(home) We help solo coaches, dental clinics, and Series-B SaaS teams grow.'], ['s', '(services) 1:1 coaching packages, local SEO for clinics, and enterprise demand-gen retainers.']] },
  { id: 'elegant_vague', note: 'elegant but operationally vague', pages: [['h', '(home) We craft resonance. Where meaning meets momentum, transformation follows.'], ['a', '(about) Our practice lives at the intersection of intention and impact.']] },
  { id: 'founder_conflict', note: 'founder claim conflicts with website evidence', pages: [['h', '(home) Freelance Webflow developer. I build marketing sites for early-stage startups, solo.']], declared: ['d', '(founder-declared) We are a 40-person full-service agency serving Fortune 500 enterprises.'] },
];

// ── Market-inference fixtures (Step 5 catalogue) ───────────────────────────────────────────────────────
const FB = 'An AI marketing strategist for solo founders.';
const MARKET: MarketFixture[] = [
  { id: 'clear_positioning', note: 'clear positioning', entityName: 'LedgerLoop', entityType: 'direct', founderBusiness: FB, pages: [['home', 'Automated bookkeeping for Shopify merchants. Connect your store; we reconcile daily and file sales tax. $79/mo.']] },
  { id: 'ambiguous_positioning', note: 'ambiguous positioning', entityName: 'Northwind', entityType: 'direct', founderBusiness: FB, pages: [['home', 'We unlock potential. Northwind partners with bold teams to build what matters.']] },
  { id: 'sparse_source', note: 'sparse source', entityName: 'Quill & Co', entityType: 'alternative', founderBusiness: FB, pages: [['home', 'Quill & Co. Coming soon.']] },
  { id: 'contradictory_pages', note: 'contradictory pages', entityName: 'Duality', entityType: 'direct', founderBusiness: FB, pages: [['home', 'Enterprise-grade security platform for regulated banks.'], ['pricing', 'Free forever for hobbyists and side projects. No credit card.']] },
  { id: 'promo_superiority', note: 'promotional superiority language', entityName: 'ApexRank', entityType: 'direct', founderBusiness: FB, pages: [['home', 'The best SEO tool on the market. Rank #1 faster than anyone. Unbeatable results, guaranteed.']] },
  { id: 'pricing_no_response', note: 'pricing without market-response evidence', entityName: 'Pricepoint', entityType: 'direct', founderBusiness: FB, pages: [['pricing', 'Simple pricing: Starter $49, Growth $199, Scale $999. Most popular: Growth.']] },
  { id: 'leadership_no_proof', note: 'claims leadership without independent proof', entityName: 'MarketLead', entityType: 'direct', founderBusiness: FB, pages: [['home', 'The market leader in founder analytics. We define the category and set the standard.']] },
  { id: 'trusted_by_logos', note: '"trusted by" logos without verifiable outcomes', entityName: 'LogoWall', entityType: 'reference', founderBusiness: FB, pages: [['home', 'Trusted by teams at Acme, Globex, Initech and 5,000+ others. Join the movement.']] },
  { id: 'category_creation', note: 'claims category creation', entityName: 'FirstMover', entityType: 'reference', founderBusiness: FB, pages: [['home', 'We invented Revenue Intelligence. A brand-new category we pioneered and continue to lead.']] },
  { id: 'reference_not_competitor', note: 'reference brand, not a direct competitor', entityName: 'Patagonia', entityType: 'reference', founderBusiness: FB, pages: [['home', 'Outdoor apparel built to last. We are in business to save our home planet.']] },
  { id: 'twin_a', note: 'similar language, different offer structure (A: productized subscription)', entityName: 'BrandForge A', entityType: 'direct', founderBusiness: FB, pages: [['home', 'Premium brand strategy for ambitious founders. A flat $2,000/mo subscription; pause anytime; unlimited requests, one at a time.']] },
  { id: 'twin_b', note: 'similar language, different offer structure (B: bespoke retainer)', entityName: 'BrandForge B', entityType: 'direct', founderBusiness: FB, pages: [['home', 'Premium brand strategy for ambitious founders. Bespoke 6-month engagements from $75,000, scoped per client, senior partner led.']] },
];

async function call(model: string, system: string, user: string, maxTokens: number): Promise<{ text: string; latencyMs: number; usage: { input: number; output: number } | null }> {
  const t0 = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resp: any = await client.messages.create({ model, max_tokens: maxTokens, temperature: 0, system, messages: [{ role: 'user', content: user }] });
  const latencyMs = Date.now() - t0;
  const text = (resp.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
  const usage = resp.usage ? { input: resp.usage.input_tokens ?? 0, output: resp.usage.output_tokens ?? 0 } : null;
  return { text, latencyMs, usage };
}
function parseJson(s: string): Record<string, unknown> | null { try { const m = s.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch { return null; } }

async function evalSynthesis(fx: SynthFixture, model: string) {
  const pages = [...fx.pages, ...(fx.declared ? [fx.declared] : [])];
  const srcIds = pages.map((p) => p[0]);
  if (fx.pages.length === 0) return { capability: 'synthesis', fixture: fx.id, note: fx.note, model, insufficient: true, checks: { insufficientEvidenceGuard: true } };
  const evidence = pages.map(([id, t]) => `[${id}] (website) ${t}`).join('\n');
  const user = `EVIDENCE (cite by [id]):\n${evidence}\n\nENGINE INFERENCE:\n(none)\n\nEngine confidence: thin\n\nReturn the JSON now.`;
  const { text, latencyMs, usage } = await call(model, SYNTH_SYSTEM, user, 2000);
  const parsed = parseJson(text);
  const rawArr = Array.isArray(parsed?.['conclusions']) ? (parsed!['conclusions'] as unknown[]) : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const norm = normalizeConclusions(rawArr as any, srcIds, (i) => `c${i}`);
  const bands: Record<string, number> = {}; norm.forEach((c) => { bands[c.epistemicStatus] = (bands[c.epistemicStatus] ?? 0) + 1; });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawMarketDemonstrated = rawArr.filter((r: any) => MARKET_TYPES.has(r?.type) && (r?.epistemicStatus === 'OBSERVED' || r?.epistemicStatus === 'SYNTHESIZED_FROM_OBSERVED')).length;
  const statements = norm.map((c) => c.statement.toLowerCase());
  const duplicates = statements.length - new Set(statements).size;
  const groundedAllCited = norm.filter((c) => c.epistemicStatus === 'OBSERVED' || c.epistemicStatus === 'SYNTHESIZED_FROM_OBSERVED').every((c) => c.evidenceRefs.length > 0 && c.evidenceRefs.every((r) => srcIds.includes(r)));
  return {
    capability: 'synthesis', fixture: fx.id, note: fx.note, model, latencyMs, usage,
    checks: {
      schemaValid: parsed != null && Array.isArray(parsed['conclusions']),
      parseFailure: parsed == null,
      rawCount: rawArr.length, keptCount: norm.length, bands,
      rawMarketDemonstrated,                 // model attempted a demonstrated market claim (0 = disciplined)
      groundedAllCited,                      // every observed/synth conclusion cites a real source id
      duplicates,
    },
    conclusions: norm.map((c) => ({ type: c.type, band: c.epistemicStatus, refs: c.evidenceRefs.length, statement: c.statement })),
  };
}

async function evalMarket(fx: MarketFixture, model: string) {
  const obs = fx.pages.map(([title, t]) => `[${title}] ${t.replace(/\s+/g, ' ').slice(0, 700)}`).join('\n');
  const user = `Founder's business: ${fx.founderBusiness}\n\nEntity: ${fx.entityName} (${fx.entityType})\n\nPUBLIC PAGES:\n${obs}\n\nReturn the JSON.`;
  const { text, latencyMs, usage } = await call(model, MARKET_SYSTEM, user, 900);
  const parsed = parseJson(text);
  const inferenceText = String(parsed?.['inferenceText'] ?? '');
  const rawStatus = String(parsed?.['epistemicStatus'] ?? '');
  const cappedStatus = capMarketEpistemics((['SYNTHESIZED_FROM_OBSERVED', 'HYPOTHESIS', 'NEEDS_MORE_EVIDENCE'].includes(rawStatus) ? rawStatus : 'HYPOTHESIS') as never, inferenceText);
  const hedged = /(the site presents|appears|may |might |publicly|does not establish|this does not|claims to|positions itself|seems)/i.test(inferenceText);
  const forbiddenTriggered = cappedStatus !== rawStatus || capMarketEpistemics('SYNTHESIZED_FROM_OBSERVED' as never, inferenceText) === 'HYPOTHESIS';
  return {
    capability: 'market-inference', fixture: fx.id, note: fx.note, model, entityType: fx.entityType, latencyMs, usage,
    checks: {
      schemaValid: parsed != null && typeof parsed['inferenceText'] === 'string' && typeof parsed['epistemicStatus'] === 'string',
      parseFailure: parsed == null,
      rawStatus, cappedStatus,
      neverObserved: rawStatus !== 'OBSERVED',                 // inference must never be OBSERVED
      forbiddenMarketLanguageTriggersCap: forbiddenTriggered,  // did the text reach for a demonstrated market claim
      hedged,
      inferenceLen: inferenceText.length,
    },
    inferenceText, relevanceToFounder: String(parsed?.['relevanceToFounder'] ?? ''),
  };
}

async function main() {
  if (!apiKey) { console.error('NO_KEY'); process.exit(2); }
  const results: unknown[] = [];
  for (const model of [MODELS.baseline, MODELS.configured]) {
    for (const fx of SYNTH) { try { results.push(await evalSynthesis(fx, model)); } catch (e) { results.push({ capability: 'synthesis', fixture: fx.id, model, error: String((e as Error).message) }); } }
    for (const fx of MARKET) { try { results.push(await evalMarket(fx, model)); } catch (e) { results.push({ capability: 'market-inference', fixture: fx.id, model, error: String((e as Error).message) }); } }
  }
  console.log(JSON.stringify({ meta: { models: MODELS, synthFixtures: SYNTH.length, marketFixtures: MARKET.length, temperature: 0 }, results }, null, 1));
}
void main();
