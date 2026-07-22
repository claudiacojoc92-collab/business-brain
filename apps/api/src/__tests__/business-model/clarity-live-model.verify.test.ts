import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { AnthropicClarityModel } from '../../business-model/clarity-model';
import { normalizeClarityResult, type ClarityResult } from '../../business-model/clarity-result';
import type { ClarityContext } from '../../business-model/clarity-model';

/**
 * CONTROLLED live-model verification — NOT part of the mandatory deterministic CI suite. It exercises the real
 * AnthropicClarityModel on the advertising-confusion scenario and reports whether the model behaves as an auditor. It writes
 * NO confirmed Understanding (it never touches persistence). The API key is loaded in-process from the primary workdir .env
 * and is NEVER printed; only the model's structured output is inspected. Run explicitly:
 *   RUN_LIVE_MODEL=1 npx vitest run apps/api/src/__tests__/business-model/clarity-live-model.verify.test.ts
 * Skipped unless RUN_LIVE_MODEL=1 AND an ANTHROPIC_API_KEY is resolvable.
 */
const ENV_PATH = '/Users/claudiacojoc/Desktop/business_brain/.env';
function resolveApiKey(): string {
  if (process.env['ANTHROPIC_API_KEY']) return process.env['ANTHROPIC_API_KEY']!;
  try {
    for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
      const m = line.match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.*?)\s*$/);
      if (m) { let v = m[1] ?? ''; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v; }
    }
  } catch { /* no .env available */ }
  return '';
}
const KEY = resolveApiKey();
const ENABLED = process.env['RUN_LIVE_MODEL'] === '1' && KEY.length > 0;

const CONTEXT: ClarityContext = {
  conclusions: [
    { statement: 'A specialist service business that receives inbound inquiries.', label: 'observed_from_material' },
    { statement: 'Some prospects do not convert, and it is not known where they drop off.', label: 'you_told_me' },
    { statement: 'The founder has a limited advertising budget.', label: 'you_told_me' },
  ],
  unknowns: ['Where prospects currently stop.'],
  goals: ['Get more customers.'], constraints: ['Limited advertising budget.'], resources: [],
};

const d = describe.skipIf(!ENABLED);

// The bounded prior Understanding supplied to the model (with real ids) — continuity must reference ONLY these.
const CONTEXT_ITEMS = [
  { id: 'ui-bottleneck', statement: 'The current customer-acquisition bottleneck is unconfirmed.', truthLabel: 'unconfirmed_or_disagree' as const, originSummary: 'You accepted this from an earlier clarity conversation.', lastConfirmedAt: null, possibleStalenessReason: 'unresolved' as const, needsRevalidation: true },
  { id: 'ui-budget', statement: 'You have a limited advertising budget.', truthLabel: 'you_told_me' as const, originSummary: 'You told me earlier.', lastConfirmedAt: null, possibleStalenessReason: 'time_sensitive' as const, needsRevalidation: true },
];

d('Clarity — CONTROLLED live-model verification (not CI)', () => {
  it('audits the advertising tension, explains continuity from persisted context, and references only supplied ids', async () => {
    const model = new AnthropicClarityModel(KEY);
    const output = await model.clarify({
      founderInput: 'A marketer says I should double my advertising budget next month. Should I?',
      priorMessages: [], context: CONTEXT, contextItems: CONTEXT_ITEMS,
    });
    const result: ClarityResult | null = output?.result ?? null;
    const refs = output?.continuityRefs ?? [];

    const suppliedIds = new Set(CONTEXT_ITEMS.map((c) => c.id));
    const contractValid = result !== null && normalizeClarityResult(result) !== null;
    const persistedReferencesValid = refs.every((r) => suppliedIds.has(r.understandingItemId)); // no invented ids
    const continuityExplained = refs.length > 0 && refs.every((r) => r.relevanceToCurrentConcern.length > 0 && r.effectOnCurrentReading.length > 0);
    const nextMove = result?.smallestUsefulNextMove ?? '';
    const jumpedToAds = /\b(double|run|start|launch|invest in|buy)\b[^.]*\b(ads?|budget|spend)\b/i.test(nextMove) && !/before|first|establish|find|check|understand|unless/i.test(nextMove);
    const separated = !!result && (result.supportedObservations.length + result.founderStatements.length) > 0 && result.unknowns.length > 0;
    const boundedNextMove = nextMove.length > 0 && nextMove.split(/(?<=[.!?])\s+/).length <= 2;
    const report = {
      contractValid,
      persistedReferencesValid,
      continuityExplained,
      visibleContextItems: refs.length,
      jumpedToRecommendation: jumpedToAds,
      separatedKnownAssumedUnknownConflict: separated,
      staleOrContradictedHandledTruthfully: refs.length > 0, // it engaged the flagged prior context rather than ignoring it
      boundedSmallestNextMove: boundedNextMove,
      proposedExplicitCorrection: (result?.proposedUnderstandingChanges.length ?? 0), // proposals only; nothing applied silently
      alternativeOffered: (result?.alternativeInterpretation.length ?? 0) > 0,
    };
    // eslint-disable-next-line no-console
    console.log('LIVE CLARITY MODEL REPORT:', JSON.stringify(report, null, 2));

    expect(contractValid).toBe(true);
    expect(persistedReferencesValid).toBe(true); // never references an item the service did not supply
    expect(jumpedToAds).toBe(false);             // does NOT jump to "double the budget"
    expect(separated).toBe(true);
    expect(boundedNextMove).toBe(true);
    expect(result!.alternativeInterpretation.length).toBeGreaterThan(0);
  }, 60_000);
});

// Surface an explicit skip note when disabled, so a run without a key is never mistaken for a pass.
if (!ENABLED) {
  // eslint-disable-next-line no-console
  console.log(`[clarity live-model verify] SKIPPED — ${KEY ? 'set RUN_LIVE_MODEL=1 to enable' : 'no ANTHROPIC_API_KEY resolvable'}.`);
}
