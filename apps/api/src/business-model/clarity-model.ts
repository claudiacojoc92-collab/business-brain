/**
 * Clarity / Sensemaking slice — the model boundary. `ClarityModel` turns a founder's tension + the relevant CONFIRMED
 * business context into a validated `ClarityResult` (or null when the model output is unusable). Two implementations share
 * the interface: `AnthropicClarityModel` (JSON-only prompt → safe parse → fail-closed normalize, mirroring the strategy
 * model) for live use, and `FixtureClarityModel` (deterministic) for tests and the acceptance scenario. The model is an
 * AUDITOR, not an advice generator: it does not jump to "run ads / don't run ads"; it separates known / assumed / unknown /
 * conflicting and proposes the smallest useful next move. It never psychoanalyzes and never fabricates certainty.
 */
import { createAnthropicClient } from '@bb/infrastructure';
import { sha256Hex } from './context-snapshot';
import { CLARITY_SYSTEM_PROMPT } from './clarity-prompt';
import { normalizeClarityResult, type ClarityResult, type TruthLabel } from './clarity-result';

/** The confirmed context an audit may draw on (read from Business Understanding — never invented). */
export interface ClarityContext {
  conclusions: Array<{ statement: string; label: TruthLabel }>;
  unknowns: string[];
  goals: string[];
  constraints: string[];
  resources: string[];
}
export interface ClarityInput {
  founderInput: string;
  priorMessages: Array<{ actor: 'FOUNDER' | 'BUSINESS_BRAIN'; content: string }>;
  context: ClarityContext;
}

export interface ClarityModel {
  readonly version: string;
  readonly promptTemplateHash: string;
  clarify(input: ClarityInput): Promise<ClarityResult | null>;
}

function safeJson(t: string): unknown { try { const m = t.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch { return null; } }
const MAX_TOKENS = 3000;

export class AnthropicClarityModel implements ClarityModel {
  readonly version = 'clarity-1:anthropic';
  readonly promptTemplateHash = sha256Hex(CLARITY_SYSTEM_PROMPT);
  constructor(private readonly apiKey: string, private readonly modelId = 'claude-sonnet-5') {}

  async clarify(input: ClarityInput): Promise<ClarityResult | null> {
    const client = createAnthropicClient(this.apiKey);
    const user = [
      'CONFIRMED BUSINESS CONTEXT (drawn from Business Understanding — do not invent beyond this):',
      JSON.stringify(input.context, null, 1),
      '',
      input.priorMessages.length ? `PRIOR CONVERSATION:\n${input.priorMessages.map((m) => `${m.actor}: ${m.content}`).join('\n')}\n` : '',
      'FOUNDER SAYS:',
      input.founderInput,
      '',
      'Audit this as the strategist and return ONLY the clarity JSON now.',
    ].join('\n');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp: any = await client.messages.create({ model: this.modelId, max_tokens: MAX_TOKENS, system: CLARITY_SYSTEM_PROMPT, messages: [{ role: 'user', content: user }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (resp.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    return normalizeClarityResult(safeJson(text));
  }
}

/**
 * Deterministic fixture. Default behavior implements the acceptance scenario (the advertising tension): it does NOT
 * recommend ads, it names that the bottleneck is unconfirmed, and it proposes (not saves) one Understanding update. Tests
 * may inject any result (or null, to exercise the malformed-output path).
 */
export class FixtureClarityModel implements ClarityModel {
  readonly version = 'clarity-1:fixture';
  readonly promptTemplateHash = 'fixture';
  constructor(private readonly result: ClarityResult | null = advertisingScenarioResult()) {}
  async clarify(_input: ClarityInput): Promise<ClarityResult | null> { return this.result; }
}

/** The canned, product-truthful clarity result for the advertising tension (acceptance scenario, Phase 12). */
export function advertisingScenarioResult(): ClarityResult {
  return {
    reflectedConcern: 'You’re being told to run ads to get more customers, but you’re not sure ads are the real problem.',
    relevantContextUsed: [
      { label: 'observed_from_material', statement: 'You offer a specialist service and receive inquiries.' },
      { label: 'you_told_me', statement: 'Some prospects do not convert, and you don’t yet know where they drop off.' },
      { label: 'you_told_me', statement: 'You have a limited advertising budget.' },
    ],
    supportedObservations: ['You are already getting some interest (inquiries come in).', 'Some prospects do not convert.'],
    founderStatements: ['You have a limited advertising budget.', 'You are unsure whether ads are the real issue.'],
    interpretations: ['More traffic would amplify an unresolved conversion problem rather than fix it.'],
    unknowns: ['Where prospects currently stop.', 'Whether the current conversion path works well enough.', 'Whether traffic volume is actually the main constraint.'],
    conflicts: [],
    clarifiedIssue: 'The immediate problem is not yet proven to be a traffic problem. You have some interest, but it isn’t yet known whether the offer and conversion path work well enough for additional traffic to help.',
    alternativeInterpretation: 'Ads may be appropriate if your current conversion is healthy and the constraint is proven to be insufficient qualified traffic.',
    smallestUsefulNextMove: 'Before spending on ads, establish where prospects currently stop.',
    whatWouldChangeThisReading: ['Evidence that current conversion is healthy.', 'Evidence that the real constraint is a shortage of qualified traffic.'],
    proposedUnderstandingChanges: [
      { changeType: 'ADD', statement: 'The current acquisition bottleneck is unconfirmed.', label: 'unconfirmed_or_disagree', explanation: 'Because it isn’t yet known where prospects stop, the problem can’t responsibly be attributed to traffic volume.' },
    ],
    possibleStrategicQuestion: 'Should I invest in ads now, or first establish where prospects drop off?',
    evidenceLimitation: 'This reading is based only on what is currently known; where prospects stop has not yet been established.',
  };
}
