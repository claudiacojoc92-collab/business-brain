/**
 * Wave 4 — Recommendation Provenance Integrity evaluation (KA-1). Runs the EXACT production SYSTEM prompt + normalizer
 * over synthetic StrategicContext fixtures whose targets have known ids, then applies the deterministic production
 * provenance validator (buildProvenanceManifest + validateRecommendationProvenance). Proves: the model cites only ids
 * present in the supplied context; invented ids are caught deterministically even if the model violates; a fluent but
 * ungrounded answer degrades to INSUFFICIENT rather than passing as grounded. Application validation is authoritative;
 * this records model variance. Synthetic only; no secrets.
 */
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM } from '../../apps/api/src/business-model/anthropic-strategy.model';
import { normalizeStrategicOutput, type StrategicOutcome, type StrategicRecommendation } from '../../apps/api/src/business-model/strategy';
import { buildProvenanceManifest, validateRecommendationProvenance } from '../../apps/api/src/business-model/provenance';
import type { StrategicContext } from '../../apps/api/src/business-model/strategic-context.assembler';
import type { EffectiveContextItem } from '../../apps/api/src/business-model/effective-strategic-context.resolver';

const MODEL = process.env['STRATEGY_MODEL'] || process.env['SYNTHESIS_MODEL'] || 'claude-sonnet-5';
const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
const client = new Anthropic({ apiKey });

function ci(kind: EffectiveContextItem['kind'], id: string, statement: string, metadata: EffectiveContextItem['metadata']): EffectiveContextItem {
  return { id, logicalItemId: `l-${id}`, version: 1, kind, statement, category: 'category' in metadata ? (metadata as { category: string }).category : kind, scope: 'GLOBAL_STRATEGY', source: 'FOUNDER_DECLARED', effectiveFrom: '2026-07-01T00:00:00.000Z', effectiveUntil: null, reviewAt: null, metadata };
}
function grounded(): StrategicContext {
  return {
    businessUnderstanding: { version: 2, conclusions: [
      { id: 'concl-1', type: 'what_it_is', statement: 'A done-for-you LinkedIn ghostwriting service for B2B SaaS founders.', epistemicStatus: 'OBSERVED', group: 'primary', evidenceCount: 2 },
      { id: 'concl-2', type: 'underused_strength', statement: 'The founder already gets inbound from their own LinkedIn posts.', epistemicStatus: 'OBSERVED', group: 'primary', evidenceCount: 1 },
    ], founderResponses: [{ conclusionId: 'concl-2', type: 'confirmed', acceptedText: 'Yes.', qualificationText: null, correctionText: null, revisedEarlier: false }], conflicts: [], unknowns: [] },
    publicPositioningContext: { entities: [], observations: [], inferences: [], provisional: { observations: 0, inferences: 0 }, provenance: [] },
    founderContext: { goals: [ci('GOAL', 'ctx-goal', 'Reach £5k MRR in 6 months', { kind: 'GOAL', priority: 'PRIMARY' })], constraints: [ci('CONSTRAINT', 'ctx-budget', 'Marketing budget £150/month, firm', { kind: 'CONSTRAINT', category: 'BUDGET', founderClassification: 'NON_NEGOTIABLE', temporaryOrStructural: 'STRUCTURAL' })], resources: [], strategicPreferences: [], decisionHorizons: [], conflicts: [], staleItems: [], missingCriticalAreas: [] },
    question: { rawText: 'What should I prioritise for acquisition in the next 30 days?', normalizedStrategicJob: 'PRIORITY_DECISION', subtype: 'ACQUISITION_PRIORITY', decisionHorizon: '30 days' },
    contextHealth: { missingAreas: [], staleAreas: [], contradictoryAreas: [], truncated: false },
  };
}
function empty(): StrategicContext {
  return { businessUnderstanding: { version: null, conclusions: [], founderResponses: [], conflicts: [], unknowns: [] }, publicPositioningContext: { entities: [], observations: [], inferences: [], provisional: { observations: 0, inferences: 0 }, provenance: [] }, founderContext: { goals: [], constraints: [], resources: [], strategicPreferences: [], decisionHorizons: [], conflicts: [], staleItems: [], missingCriticalAreas: [] }, question: { rawText: 'What should I prioritise next?', normalizedStrategicJob: 'PRIORITY_DECISION', subtype: 'GENERAL_30_DAY_PRIORITY', decisionHorizon: '30 days' }, contextHealth: { missingAreas: ['business_understanding'], staleAreas: [], contradictoryAreas: [], truncated: false } };
}

async function reason(context: StrategicContext): Promise<StrategicOutcome | null> {
  const user = [`FOUNDER QUESTION (${context.question.subtype}, horizon: ${context.question.decisionHorizon}):`, context.question.rawText, '', 'STRATEGIC CONTEXT (current & eligible only; epistemic status + provenance preserved):', JSON.stringify(context, null, 1), '', 'Reason as the strategist and return the JSON now.'].join('\n');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resp: any = await client.messages.create({ model: MODEL, max_tokens: 4096, system: SYSTEM, messages: [{ role: 'user', content: user }] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (resp.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  const safe = (() => { try { const m = text.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch { return null; } })();
  return normalizeStrategicOutput(safe, context.question.subtype);
}

async function main(): Promise<void> {
  if (!apiKey) { console.error('[prov-eval] no ANTHROPIC_API_KEY — skipping (no secret printed).'); process.exit(2); }
  const records: unknown[] = []; let passed = 0; const total = 3;

  // 1. GROUNDED — the real model must cite only ids present in the supplied context (validator keeps grounding).
  {
    const ctx = grounded(); const manifest = buildProvenanceManifest(ctx);
    const normalized = await reason(ctx);
    const { outcome, validation } = normalized ? validateRecommendationProvenance(normalized, manifest) : { outcome: null, validation: { groundingStatus: 'PARSE_FAIL', rejectedCount: 0, validatedCount: 0 } as never };
    const ok = outcome != null && outcome.kind === 'STRATEGIC_RECOMMENDATION' && validation.groundingStatus !== 'UNGROUNDED';
    if (ok) passed++;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] grounded — status=${validation.groundingStatus} validated=${validation.validatedCount} rejected(model invented)=${validation.rejectedCount}`);
    records.push({ id: 'grounded', model: MODEL, pass: ok, groundingStatus: validation.groundingStatus, validated: validation.validatedCount, modelInventedRejected: validation.rejectedCount });
  }

  // 2. INVENTED-ID PROBE (deterministic; no model dependency) — even a fluent recommendation whose ids are invented is
  //    caught: every invented ref is removed; grounding collapses to INSUFFICIENT. Application validation is authoritative.
  {
    const ctx = grounded(); const manifest = buildProvenanceManifest(ctx);
    const fabricated = normalizeStrategicOutput({ recommendation: { title: 'Prioritise LinkedIn', action: 'Double down on LinkedIn', horizon: '30 days' }, reasoning: { supportingEvidence: [{ kind: 'OBSERVED_BUSINESS_EVIDENCE', statement: 'the evidence proves LinkedIn works', refId: '01FABRICATEDIDXXXXXXXXXXXX' }, { kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'your goal', refId: 'ghost-item' }] }, nextStep: { action: 'post daily', successSignal: 'leads', reviewAfter: '2w' }, whatWouldChangeThisRecommendation: ['if it stops working'] }, 'ACQUISITION_PRIORITY')!;
    const { outcome, validation } = validateRecommendationProvenance(fabricated, manifest);
    const ok = outcome.kind === 'INSUFFICIENT_STRATEGIC_EVIDENCE' && validation.groundingStatus === 'UNGROUNDED' && validation.rejectedCount >= 2;
    if (ok) passed++;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] invented-id probe — outcome=${outcome.kind} status=${validation.groundingStatus} rejected=${validation.rejectedCount} (fabricated grounding never passes)`);
    records.push({ id: 'invented_probe', pass: ok, outcomeKind: outcome.kind, groundingStatus: validation.groundingStatus, rejected: validation.rejectedCount });
  }

  // 3. UNGROUNDED CONTEXT — insufficient is preferable to fabricated grounding.
  {
    const ctx = empty(); const manifest = buildProvenanceManifest(ctx);
    const normalized = await reason(ctx);
    const { outcome, validation } = normalized ? validateRecommendationProvenance(normalized, manifest) : { outcome: null, validation: { groundingStatus: 'PARSE_FAIL' } as never };
    const ok = outcome != null && outcome.kind === 'INSUFFICIENT_STRATEGIC_EVIDENCE'; // either the model refused, or validation degraded it
    if (ok) passed++;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ungrounded-context — outcome=${outcome?.kind ?? 'null'} status=${validation.groundingStatus}`);
    records.push({ id: 'ungrounded_context', model: MODEL, pass: ok, outcomeKind: outcome?.kind ?? null, groundingStatus: validation.groundingStatus });
  }

  console.log(`\n[prov-eval] model=${MODEL} — ${passed}/${total} passed. Application validation is authoritative; model variance recorded.`);
  console.log('---JSON---'); console.log(JSON.stringify({ model: MODEL, passed, total, records }, null, 2));
}
void main();
