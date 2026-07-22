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

d('Clarity — CONTROLLED live-model verification (not CI)', () => {
  it('audits the advertising tension as a strategist and returns a valid, bounded contract', async () => {
    const model = new AnthropicClarityModel(KEY);
    const result: ClarityResult | null = await model.clarify({
      founderInput: 'Everyone tells me I should run ads because I need more customers, but I don’t know if ads are really the answer.',
      priorMessages: [], context: CONTEXT,
    });

    const contractValid = result !== null && normalizeClarityResult(result) !== null;
    const nextMove = result?.smallestUsefulNextMove ?? '';
    const jumpedToAds = /\b(run|start|launch|invest in|buy)\b[^.]*\bads?\b/i.test(nextMove) && !/before|first|establish|find|check|understand/i.test(nextMove);
    const separated = !!result && (result.supportedObservations.length + result.founderStatements.length) > 0 && result.unknowns.length > 0;
    const boundedNextMove = nextMove.length > 0 && nextMove.split(/(?<=[.!?])\s+/).length <= 2; // one bounded step, not a plan
    const report = {
      contractValid,
      openQuestionsSurfaced: result?.unknowns.length ?? 0,           // the contract surfaces questions as named unknowns
      jumpedToRecommendation: jumpedToAds,
      separatedKnownAssumedUnknownConflict: separated,
      hasConflictsChannel: Array.isArray(result?.conflicts),
      boundedSmallestNextMove: boundedNextMove,
      proposedStateChanges: result?.proposedUnderstandingChanges.length ?? 0, // proposals only; nothing is saved
      clarifiedIssuePresent: !!result?.clarifiedIssue,
      alternativeOffered: (result?.alternativeInterpretation.length ?? 0) > 0,
    };
    // eslint-disable-next-line no-console
    console.log('LIVE CLARITY MODEL REPORT:', JSON.stringify(report, null, 2));

    expect(contractValid).toBe(true);
    expect(jumpedToAds).toBe(false);            // does NOT jump to "run ads"
    expect(separated).toBe(true);               // separates known / assumed / unknown
    expect(boundedNextMove).toBe(true);         // a bounded smallest next move, not a giant plan
    expect(result!.alternativeInterpretation.length).toBeGreaterThan(0);
  }, 60_000);
});

// Surface an explicit skip note when disabled, so a run without a key is never mistaken for a pass.
if (!ENABLED) {
  // eslint-disable-next-line no-console
  console.log(`[clarity live-model verify] SKIPPED — ${KEY ? 'set RUN_LIVE_MODEL=1 to enable' : 'no ANTHROPIC_API_KEY resolvable'}.`);
}
