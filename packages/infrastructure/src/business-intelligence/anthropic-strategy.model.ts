import { createAnthropicClient } from '../llm/anthropic-client';
import type {
  IStrategyModelPort,
  StrategyModelInput,
  StrategyModelOutput,
  StrategyRepairInput,
  StrategyJudgeOutput,
  StrategyBundle,
} from '@bb/application';

/**
 * Slice 3 Strategy Intelligence adapter. UNLIKE Aha 2, Strategy is allowed to CHOOSE — but it must
 * choose honestly: one load-bearing bet, a real trade-off, explicit "not now", named assumptions and
 * reconsider triggers, built around hard constraints and the resource envelope, evidence-bound, and
 * business-specific (fails transplant). Propose-only JSON; the application layer runs the M1 gate
 * stack, repairs failed components, and fails closed. Also exposes repair() and judge().
 */
const LANG: Record<string, string> = { ro: 'Romanian', en: 'English', it: 'Italian' };

const SHAPE = `{
  "core": {
    "goal": "the founder's goal, in their terms",
    "horizon": "the time horizon",
    "diagnosis": "the CENTRAL marketing problem/opportunity THIS strategy solves for the goal — not a summary, not Aha 2 pasted in",
    "coreBet": { "priority": "what we prioritize", "deprioritized": "the alternative we consciously drop (the trade-off)", "whyOverAlternative": "why X over Y (goal+evidence+fit)", "relationToGoal": "", "relationToBottleneck": "", "founderFit": "", "resourceFit": "" },
    "offerDirection": "", "positioningDirection": "",
    "audiencePrimaryForGoal": "the audience primary FOR THIS goal+bet (never 'everyone' unless justified; never a target segment inferred from a channel preference)",
    "audienceRoles": [{ "role": "user|buyer|decision-maker|referrer|influencer|supply|demand", "who": "" }],
    "founderConstraints": ["hard constraints the strategy is built AROUND"],
    "resourceEnvelope": ["resources that shaped these decisions"],
    "assumptions": [{ "statement": "a load-bearing assumption named honestly" }],
    "tradeOffs": [{ "choosing": "", "over": "", "why": "" }],
    "notNow": [{ "item": "something deliberately NOT done now", "reason": "why not now" }],
    "reconsiderTriggers": [{ "condition": "a real, checkable condition that would make BB reconsider the bet" }]
  },
  "branch": {
    "market": "", "language": "", "messagingDirection": "",
    "channelPriorities": [{ "channel": "", "whyGoal": "", "whyAudience": "", "whyResource": "", "overAlternative": "why prioritized over another channel", "assumption": "" }],
    "acquisitionApproach": "", "contentRole": "what content is DOING here (may be 'very little')", "ctaDirection": "what the audience should be able to do next"
  },
  "decisions": [{ "key": "short-slug", "title": "", "rationale": "", "sourceRefs": ["B1"], "founderRefs": ["F1"], "claimStrength": "evidenced|bounded|assumption", "assumption": null, "reconsiderTrigger": null }]
}`;

function rules(l: string): string {
  return [
    `You are Business Brain, a marketing strategist. LANGUAGE — write ALL founder-facing text in the SAME language as the founder's OWN WORDS below (their corrections and founder-owned state), whatever it is (English→English, Romanian→Romanian, Italian→Italian); write the ENTIRE output — every JSON field and every sentence — in that ONE language; NEVER mix languages within the response, and never let other-language content in this prompt (understanding, observations, aha) leak into your text. ${l} only if their language is unclear. Return ONLY valid JSON`,
    'in EXACTLY this shape (no prose around it):',
    SHAPE,
    '',
    'MANDATORY STRATEGY DISCIPLINE:',
    '- FOUNDER-HUMAN VOICE — applies to EVERY founder-facing field, with NO exceptions: coreBet.priority,',
    '  coreBet.deprioritized, and for EACH tradeOffs entry its choosing / over / why, EACH notNow item + reason, and',
    '  EACH reconsiderTriggers condition. (The app now shows the founder the `why` of each trade-off and the `reason` of',
    '  each notNow AS-IS — so `why` and `reason` must each be COMPLETE natural prose that stands alone: one to two short',
    '  sentences that say what you are choosing AND why it beats the alternative, with no leftover shorthand.) Write the',
    '  way a sharp friend talks to the founder over coffee, not the way a consultant writes a deck. THE COFFEE TEST: read',
    '  the whole strategy out loud; any line a real person would not say to a friend gets rewritten. Rules:',
    '  1. NO SEPARATORS OR DASHES ANYWHERE. Never use ↔, ·, /, "vs.", and NEVER the em-dash "—" or a hyphen used as a',
    '     dash. Join clauses with a period or a comma only. BAD (separators): "Mesaj separat pentru clase ↔ un mesaj de',
    '     brand · nimeni nu se simte clientul tău." BAD (em-dash): "Nu caută pe Instagram — merg unde îi trimite medicul."',
    '     GOOD: "Nu caută pe Instagram. Merg unde îi trimite medicul." / "Vorbești la fel către oameni diferiți, dar',
    '     nimeni nu se simte clientul tău."',
    '  2. VERBS, NOT NOUNS. Never turn an action into a noun ("activarea", "separarea", "diferențierea", "unificarea").',
    '     BAD: "Activarea word of mouth și a rețelelor de referral medical." GOOD: "Mergi pe recomandări și pe medicii',
    '     care îți trimit deja pacienți."',
    '  3. NO MARKETING JARGON. Say it the way the founder says it: "word of mouth" → "oameni care te recomandă";',
    '     "referral medical" → "medici care trimit pacienți"; "segmente" → "clienți diferiți"; "brand unificat" →',
    '     "același mesaj pentru toți"; "canal" → "de unde vin oamenii"; "poziționare" → "cum te văd oamenii";',
    '     "flux B2B" / "B2B" / "parteneriat formal" → "un sistem prin care medicii îți trimit pacienți constant".',
    '  4. SPEAK TO THE FOUNDER — second person, active voice, no passive ("va fi aplicat").',
    '  5. CONCRETE IMAGES over categories. BAD: "două segmente distincte." GOOD: "femeia cu durere de spate și mama',
    '     care vrea să slăbească." If you cannot picture it, it is too abstract — name the real person/service.',
    '  6. SHORT: the bet ≤ 15 words; every other field 1–2 short sentences a person would actually speak.',
    '  Per-field BAD → GOOD (Romanian):',
    '  • priority: BAD "Separarea mesajului și a căii de intrare pentru recuperare medicală față de clase." GOOD',
    '    "Vorbești diferit către clienții de clase și pacienții medicali de la Decebal."',
    '  • deprioritized (over): BAD "Un mesaj unificat de brand care acoperă ambele segmente simultan." GOOD "Același',
    '    mesaj pentru toți."',
    '  • tradeOffs.choosing: BAD "Activarea word of mouth și a rețelelor de referral medical." GOOD "Mergi pe',
    '    recomandări și pe medicii care îți trimit deja pacienți."',
    '  • tradeOffs.over: BAD "Un singur mesaj de brand pentru tot studioul." GOOD "Un singur mesaj pentru toată lumea."',
    '  • tradeOffs.why: BAD "Brandul sună mai curat unificat, dar publicurile au criterii de decizie incompatibile."',
    '    GOOD "Vorbești la fel către oameni diferiți. Brandul sună mai curat, dar nimeni nu se simte clientul tău."',
    '  • notNow: the founder is shown ONLY the `reason`, so `reason` MUST name what you are setting aside AND why, as a',
    '    complete line that stands alone — do not leave the subject in `item`. BAD (subject missing) "Ai încercat unul',
    '    și n-a venit nimeni." / "Nu este în plan acum." GOOD (names the thing) "Lasă evenimentele deoparte. Ai încercat',
    '    unul și n-a venit nimeni." / "Uită de reclame plătite deocamdată — recomandările îți aduc deja oameni."',
    '  • reconsider: BAD "Atingerea unui prag de ocupare la Decebal." GOOD "Dacă la Decebal încep să vină pacienți',
    '    constant, atunci poți testa un mesaj comun."',
    '  Keep every concrete noun and every specific from the analysis; only the VOICE changes, never the substance.',
    '  (The claim-type limits below still hold — founder-human never means predicting outcomes or claiming superiority.)',
    '- ANALYZE THE WHOLE BUSINESS FIRST. Weigh EVERY service, product line, channel, location, and segment in the',
    '  understanding — not just the one an earlier conversation emphasized. Identify where the biggest opportunity',
    '  actually is, WHEREVER it is; the bet may or may not be the part that was discussed most. Do NOT fixate on one',
    '  slice (e.g. a single service or location) because of prior conversation memory — that is a bias, not a',
    '  finding. The strategy must cover the whole business, not a tactical fix to one piece.',
    '- Make ONE real decision. A strategy is not a summary, an audit, or a list of tactics. It must contain',
    '  a load-bearing bet: prioritize X OVER a named Y, with why, and say what you are deliberately NOT doing.',
    '- Build AROUND hard constraints (founder kind=constraint): the strategy must NOT depend on anything the',
    '  founder ruled out. Respect resources (kind=resource): limited hours ⇒ no daily/multi-channel plan;',
    '  small budget ⇒ do not prioritize paid acquisition unless a challenge_permission allows it; no team ⇒',
    '  no plans needing specialists.',
    '- A preference (kind=preference) is respected but you may show a trade-off. A challenge_permission means',
    '  BB may propose a bounded test. NEVER turn a channel preference into a target segment (preference ≠ target).',
    '- Audience is GOAL/BET-relative. State roles when several genuinely matter. Do not say "everyone".',
    '- Content is a MECHANISM, not the default answer — define what it is doing (a business may need very little).',
    '- CTA/conversion: define what the audience should be able to do next. Do NOT predict outcomes',
    '  ("will generate leads", "increase conversion", "produce clients"). You may say a path exists or does not.',
    '- Do NOT claim a channel is "best"/"highest-leverage"/"most effective" or that you will "outperform" — you',
    '  have not established that. It is fine to say "given what we know, I would prioritize X first" (a bet under',
    '  uncertainty) and name the assumption.',
    '- Every load-bearing assumption is named. Reconsider triggers must be real conditions, not "if it doesn\'t work".',
    '  Use numbers ONLY if founder/test-defined, never invented historical metrics.',
    '- Be BUSINESS-SPECIFIC: anchor the bet in this offer, positioning, conversion path, goal, constraint, and',
    '  stage. The strategy must FAIL transplantation to an unrelated business. Avoid platitudes ("know your',
    '  audience", "be consistent", "provide value", "build trust").',
    '- STRATEGY = decisions + trade-offs. It is NOT a 30-day plan and NOT assets. Do not list "post 4 reels".',
    '- SPEAK ABOUT THE BUSINESS and the decision — never about "the website", "the site", "your pages", or "the',
    '  sources". A founder-facing sentence is a business/market statement ("the market meets you as X", "your',
    '  strongest channel is Y"), never a site/audit note. Technical/site findings do not belong in a strategy.',
    '- Cite evidence by ref: B* = business understanding, C* = founder correction (AUTHORITATIVE world fact that',
    '  supersedes any conflicting B*), F* = founder state, O* = observation. Every material decision cites at',
    '  least one real ref. Never invent refs. Never put ref tokens in founder-facing prose.',
  ].join('\n');
}

function userBlock(input: StrategyModelInput): string {
  return [
    `BUSINESS: ${input.businessName}`,
    '', 'GOVERNED BUSINESS UNDERSTANDING:', ...input.businessElements.map((e) => `${e.ref}: ${e.text}`),
    '', 'FOUNDER CORRECTIONS (world facts the founder stated directly — AUTHORITATIVE; they SUPERSEDE any',
    '  conflicting statement in the business understanding above; treat as business truth, cite as their C-ref,',
    '  and never treat as a stylistic or psychological preference):',
    ...(input.businessCorrections.length ? input.businessCorrections.map((c) => `${c.ref} (${c.subject || 'business'}): ${c.statement}`) : ['(none)']),
    '', 'FOUNDER-OWNED STATE (respect the kind):', ...input.founderState.map((e) => `${e.ref} (${e.kind}): ${e.statement}`),
    '', 'FOUNDER OBSERVATIONS (optional):', ...(input.observations.length ? input.observations.map((e) => `${e.ref}: ${e.behavior}`) : ['(none)']),
    '', 'AHA 1 (support):', ...(input.aha1.length ? input.aha1.map((a, i) => `${i + 1}. ${a.finding}`) : ['(none)']),
    '', 'AHA 2 (constraint/tension — synthesis context, NOT the diagnosis):', ...(input.aha2.length ? input.aha2.map((a, i) => `${i + 1}. ${a.implication}`) : ['(none)']),
  ].join('\n');
}

function extractJson(text: string): unknown {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) throw new Error('STRATEGY_MALFORMED: no JSON');
  return JSON.parse(text.slice(s, e + 1));
}

export class AnthropicStrategyModel implements IStrategyModelPort {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) {
    this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6';
  }

  private async call(system: string, user: string, maxTokens: number): Promise<unknown> {
    const client = createAnthropicClient(this.apiKey);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp: any = await client.messages.create({ model: this.modelId, max_tokens: maxTokens, temperature: 0, system, messages: [{ role: 'user', content: user }] }); // temp 0 → one language, no mid-response drift
    const block = Array.isArray(resp?.content) ? resp.content.find((c: { type?: string }) => c?.type === 'text') : null;
    return extractJson((block as { text?: string } | null)?.text ?? '');
  }

  async generate(input: StrategyModelInput): Promise<StrategyModelOutput> {
    const p = (await this.call(rules(LANG[input.interfaceLanguage] ?? 'English'), userBlock(input), 8000)) as { core?: unknown; branch?: unknown; decisions?: unknown };
    return { strategy: p as unknown as StrategyBundle };
  }

  async repair(input: StrategyRepairInput): Promise<StrategyModelOutput> {
    const l = LANG[input.interfaceLanguage] ?? 'English';
    const user = [
      userBlock(input),
      '', 'CURRENT STRATEGY (JSON):', JSON.stringify(input.current),
      '', `A gate rejected the "${input.failedComponent}" component. REASON: ${input.failureReason}`,
      '', `Repair ONLY the "${input.failedComponent}" part (and anything strictly required for coherence). Keep`,
      'everything else. Preserve business-specificity and the cross-source grounding. Do NOT fall back to a',
      'generic sentence, do NOT choose an outcome prediction, do NOT claim market superiority, and do NOT',
      'upgrade a founder-state type. Return the COMPLETE strategy JSON in the same shape.',
    ].join('\n');
    const p = await this.call(rules(l), user, 8000);
    return { strategy: p as unknown as StrategyBundle };
  }

  async judge(input: StrategyModelInput & { strategy: StrategyBundle }): Promise<StrategyJudgeOutput> {
    const system = [
      'You are a strict strategy reviewer. Judge the proposed strategy on each dimension and return ONLY JSON:',
      '{"verdicts":[{"dimension":"","pass":true,"component":"coreBet|diagnosis|notNow|channelPriorities|audience|branch|decisions","reason":""}]}',
      'Dimensions to judge: grounding (claims trace to the given evidence), genericity (would it transplant to an',
      'unrelated business? if yes, FAIL), specificity, coherence (goal↔bet, offer↔audience, positioning↔messaging,',
      'audience↔channel, constraints↔execution, resources↔expectations, strategy↔CTA), goalFit, founderFit,',
      'prioritization (a real bet, not "do everything"), resourceFit, isStrategyNotTactics, oppositeIsAlsoAdvice',
      '(a real decision has a coherent opposite another business could choose; platitudes FAIL).',
      'Be conservative: pass only what is genuinely satisfied. Name the component to repair when you fail one.',
    ].join('\n');
    const user = [userBlock(input), '', 'STRATEGY (JSON):', JSON.stringify(input.strategy)].join('\n');
    const p = (await this.call(system, user, 1500)) as { verdicts?: unknown };
    const verdicts = Array.isArray(p.verdicts) ? p.verdicts : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { verdicts: verdicts.map((v: any) => ({ dimension: String(v?.dimension ?? ''), pass: Boolean(v?.pass), component: String(v?.component ?? 'coreBet'), reason: String(v?.reason ?? '') })) };
  }
}
