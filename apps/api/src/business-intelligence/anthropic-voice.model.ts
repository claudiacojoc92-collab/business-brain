import { createHash } from 'node:crypto';
import { createAnthropicClient } from '@bb/infrastructure';
import type {
  IVoiceModelPort,
  VoiceSeedInput, VoiceSeedOutput,
  SampleGenInput, SampleGenOutput,
  FeedbackClassifyInput, FeedbackClassifyOutput,
  VoiceProjectionInput, VoiceProjectionOutput,
  ClaimAuditInput, ClaimAuditOutput,
  PropositionCheckInput, PropositionCheckOutput,
  SampleContent,
} from '@bb/application';

/**
 * Slice 4 Voice adapter. Grounds generation in real EXAMPLES + BOUNDARIES + NEGATIVE SPACE (never
 * adjective tags). Voice decides HOW an allowable claim reads — the application layer enforces claim
 * safety, negative-space, boundaries, CTA survival, and anti-parroting. Propose-only JSON.
 */
const LANG: Record<string, string> = { ro: 'Romanian', en: 'English', it: 'Italian' };

function extractJson(text: string): unknown {
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) throw new Error('VOICE_MALFORMED: no JSON');
  return JSON.parse(text.slice(s, e + 1));
}

/** The proposition-preservation judge system prompt (Layer 3). Hashed into the authorization snapshot. */
const VOICE_JUDGE_SYSTEM = [
  'You verify PROPOSITION PRESERVATION. Voice may change HOW a message reads, but must NOT add any new',
  'externally-truth-conditional PROPOSITION beyond the authorized set. Extract every substantive proposition',
  'the copy expresses (ignore pure rhetorical framing and the CTA). For each, decide: is it ENTAILED by / a',
  'faithful rewrite of one AUTHORIZED PROPOSITION or OWNED STANCE, OR is it NEW (adds external truth content)?',
  'A proposition is NEW if it asserts market/population facts ("most founders…"), reader psychology ("you can',
  'feel…"), customer history/anecdote, a causal/mechanism ("proof makes evaluation easier"), a comparative/',
  'superiority ("fastest way"), an outcome/result, a quality/capability/operational fact, or proof — none of',
  'which appear in the authorized set. A strategy DECISION rewritten as an empirical fact is NEW.',
  'Return ONLY the NEW ones: {"newPropositions":[{"clause":"...","proposition":"...","reason":"..."}]}.',
].join('\n');

export class AnthropicVoiceModel implements IVoiceModelPort {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) {
    this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6';
  }
  private async call(system: string, user: string, maxTokens: number, temperature?: number): Promise<unknown> {
    const client = createAnthropicClient(this.apiKey);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req: any = { model: this.modelId, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] };
    if (temperature !== undefined) req.temperature = temperature;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp: any = await client.messages.create(req);
    const block = Array.isArray(resp?.content) ? resp.content.find((c: { type?: string }) => c?.type === 'text') : null;
    return extractJson((block as { text?: string } | null)?.text ?? '');
  }

  async seedDiscover(input: VoiceSeedInput): Promise<VoiceSeedOutput> {
    if (input.websiteCopy.length === 0 && input.founderPublic.length === 0) return { examples: [], sufficient: false };
    const system = [
      'You extract VOICE SEED examples from existing copy. Website/brand copy → subject "brand".',
      'Founder-attributed public writing → subject "founder_public". Do NOT invent copy; only pull short',
      'representative snippets that show HOW they write. Return ONLY JSON:',
      '{"examples":[{"subject":"brand|founder_public","text":"...","source":"website|founder_public"}],"sufficient":true|false}',
      'sufficient=false if there is too little to characterize the voice.',
    ].join('\n');
    const user = [`BUSINESS: ${input.businessName}`, '', 'WEBSITE/BRAND COPY:', ...input.websiteCopy, '', 'FOUNDER PUBLIC WRITING:', ...(input.founderPublic.length ? input.founderPublic : ['(none)'])].join('\n');
    const p = (await this.call(system, user, 1200)) as { examples?: unknown; sufficient?: unknown };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapEx = (e: any): VoiceSeedOutput['examples'][number] => ({ subject: (e?.subject === 'founder_public' ? 'founder_public' : 'brand'), text: String(e?.text ?? '').trim(), source: (e?.source === 'founder_public' ? 'founder_public' : 'website') });
    const examples: VoiceSeedOutput['examples'] = Array.isArray(p.examples) ? p.examples.map(mapEx).filter((e) => e.text) : [];
    return { examples, sufficient: Boolean(p.sufficient) };
  }

  private sampleSystem(l: string): string {
    return [
      `You REALIZE an authorized message in the founder's voice as ONE ${'${channel}'} sample in ${l} — text only, NOT a rendered asset.`,
      'You are a REALIZER, not an author. Express ONLY the AUTHORIZED PROPOSITIONS + the required CTA. You may NOT add',
      'any new externally-truth-conditional proposition. Do NOT explain WHY something is true. Do NOT generalize about',
      'readers/markets/customers ("most founders…", "you\'re probably…"). Do NOT add causal/comparative claims',
      '("X makes Y easier", "the fastest way"), outcomes, quality/capability/operational facts, proof, or customer',
      'anecdotes. A strategy DECISION stays a decision ("we\'re putting the work first"), never an empirical fact',
      '("proof is what makes buyers decide"). Sparse authorized material ⇒ sparse copy — that is correct.',
      '',
      'CRITICAL — REALIZE, DO NOT RESTATE. The AUTHORIZED PROPOSITIONS tell you WHAT MEANING MUST SURVIVE, not how to',
      'phrase it. Do NOT echo their wording or template ("the decision we made: …", "content\'s role is …"). Re-express',
      'the SAME meaning in this specific voice. Two founders with the same authorized message must sound audibly different.',
      'Let the VOICE EVIDENCE below drive FORM aggressively — do not converge on a neutral safe paraphrase:',
      '• person (first-person "I" vs institutional "we") — take it from the examples/speaking role;',
      '• sentence length & compression (terse fragments vs full explanatory sentences);',
      '• cadence, rhythm, repetition, punctuation behavior;',
      '• opening behavior (plain observation vs declarative vs question) — from how the examples open;',
      '• whether the strategic decision is NAMED explicitly or simply enacted in how you speak;',
      '• degree of explanation, narrative distance, polish, vocabulary;',
      '• whether the CTA is integrated into the last line or stands alone.',
      'These are NOT free choices — derive them from the accepted/founder-written examples, before→after edits,',
      'established patterns, negative space, and speaking role. If the evidence is thin, stay closer to the examples\'',
      'observable form; do NOT invent a persona. If two voices genuinely share the same evidence, they may read alike.',
      'Honor NEGATIVE SPACE and BOUNDARIES; do NOT copy example wording (same voice ≠ same phrases — behavioral',
      'resemblance, never phrase reuse); a founder typo is not a style rule.',
      'Return ONLY JSON. For reel/carousel: {"hook":"","beats":["",""],"cta":""}. For caption: {"caption":"","cta":""}.',
    ].join('\n');
  }
  private specBlock(input: SampleGenInput): string[] {
    const s = input.spec;
    return [
      '', 'AUTHORIZED MESSAGE (express ONLY these):',
      `COMMUNICATION JOB: ${s.communicationJob} [kind: ${s.communicationJobKind}]`,
      s.communicationJobKind === 'proof' ? 'This job REQUIRES licensed proof material — realize the proof items below; do NOT talk ABOUT proof in the abstract.' : `This is a ${s.communicationJobKind} job — realize that meaning; do NOT claim or allude to proof/results you do not have.`,
      `AUDIENCE: ${s.audience}`,
      'LICENSED PROPOSITIONS (the only substantive things you may assert):', ...(s.licensedPropositions.length ? s.licensedPropositions.map((p) => `• [${p.source}] ${p.text}`) : ['• (none — keep it to the CTA and pure framing; do NOT invent an offer, proof, or positioning claim)']),
      ...(s.internalDecisions.length ? ['INTERNAL STRATEGY (shapes sequencing/emphasis ONLY — NEVER state these as content; the reader must not be told "our strategy is…", "we decided to…", "we lead with…"):', ...s.internalDecisions.map((x) => `• ${x}`)] : []),
      ...(s.stanceStatements.length ? ['OWNED STANCES you may express:', ...s.stanceStatements.map((x) => `• ${x}`)] : []),
      `REQUIRED CTA (must appear): ${s.ctaFunction || '(none)'}`,
      ...(s.unknowns.length ? ['UNKNOWN / UNAVAILABLE (do NOT assert):', ...s.unknowns.map((x) => `• ${x}`)] : []),
      `FORBIDDEN — never introduce: ${s.forbiddenClasses.join('; ')}`,
    ];
  }
  private sampleUser(input: SampleGenInput): string {
    const ws = input.workingSet;
    return [
      `BUSINESS: ${input.businessName}`, `CHANNEL: ${input.channel}`, `SPEAKING ROLE: ${input.speakingRole}`, `LANGUAGE: ${input.language}${input.market ? ' / market ' + input.market : ''}`,
      ...this.specBlock(input),
      ws.calibrated ? '' : '(Voice for this language is NOT yet tuned — lean on the strategy and shared boundaries; do not fake a learned voice.)',
      '', 'CONTENT OBJECTIVE (from the adopted strategy):', input.objective,
      '', 'STRATEGY CONTEXT:', `- messaging: ${input.strategy.messagingDirection}`, `- content role: ${input.strategy.contentRole}`, `- audience: ${input.strategy.audience}`, `- required next step (CTA): ${input.strategy.ctaDirection}`,
      '', 'VOICE — FOUNDER-VERIFIED accepted / founder-written examples (emulate the VOICE, not the words — these OUTRANK everything below):', ...(ws.acceptedExamples.length ? ws.acceptedExamples.map((e) => `• ${e}`) : ['(none yet)']),
      '', 'OBSERVED PUBLIC COPY (UNVERIFIED seed — may be legacy or agency-written; loose reference only, NOT the founder\'s approved voice; a founder-verified example always wins):', ...(ws.seedExamples.length ? ws.seedExamples.map((e) => `• ${e}`) : ['(none)']),
      '', 'VOICE — before → after edits (learn the direction of change):', ...(ws.edits.length ? ws.edits.map((e) => `• BEFORE: ${e.before}\n  AFTER: ${e.after}`) : ['(none)']),
      '', 'DO NOT SOUND LIKE (rejected):', ...(ws.rejectedExamples.length ? ws.rejectedExamples.map((e) => `• ${e}`) : ['(none)']),
      '', 'NEGATIVE SPACE (never use):', ...(ws.negativeSpace.length ? ws.negativeSpace.map((n) => `• ${n}`) : ['(none)']),
      '', 'BOUNDARIES:', ...(ws.boundaries.length ? ws.boundaries.map((b) => `• ${b}`) : ['(none)']),
      '', 'ESTABLISHED VOICE PATTERNS:', ...(ws.establishedPatterns.length ? ws.establishedPatterns.map((p) => `• ${p}`) : ['(none yet)']),
      '', 'CLAIM LIMITS (evidence/legal — do not cross):', ...(input.claimBoundaries.length ? input.claimBoundaries.map((c) => `• ${c}`) : ['(none)']),
      '', 'ALLOWED FACTUAL MATERIAL — the ONLY factual specifics you may state. You may NOT invent any number,',
      'percentage, date/timeframe, client count, customer story, "we helped/shipped…", result, testimonial,',
      'named industry, or case-study detail that is not licensed below. Voice examples teach rhythm/phrasing',
      'ONLY — never reuse a factual claim from an example unless it also appears here. If proof is required',
      'but not licensed, degrade honestly (explain the offer/mechanism, or state the strategy direction as a',
      'decision) — do NOT fabricate specificity.',
      'BUSINESS FACTS (grounded in your site — may be stated):', ...(input.allowedFacts.business.length ? input.allowedFacts.business.map((f) => `• ${f}`) : ['(none — do not state business facts)']),
      'FOUNDER-OWNED FACTS (the founder declares these — may be stated):', ...(input.allowedFacts.founderOwned.length ? input.allowedFacts.founderOwned.map((f) => `• ${f}`) : ['(none)']),
      'STRATEGY DECISIONS (state as the chosen direction, NOT as market fact):', ...(input.allowedFacts.strategyDecisions.length ? input.allowedFacts.strategyDecisions.map((f) => `• ${f}`) : ['(none)']),
    ].filter((x) => x !== '').join('\n');
  }

  async generateSample(input: SampleGenInput): Promise<SampleGenOutput> {
    const p = (await this.call(this.sampleSystem(LANG[input.language] ?? 'English').replace('${channel}', input.channel), this.sampleUser(input), 1200)) as Partial<SampleContent>;
    return { content: normalizeContent(p, input.channel) };
  }
  async repairSample(input: SampleGenInput & { rejected: SampleContent; reason: string }): Promise<SampleGenOutput> {
    const user = [this.sampleUser(input), '', 'THE PREVIOUS VERSION WAS REJECTED BY A GATE:', JSON.stringify(input.rejected), `REASON: ${input.reason}`, '', 'Regenerate ONLY to fix that reason. Keep the objective, the CTA, and the voice grounding. Return the same JSON shape.'].join('\n');
    const p = (await this.call(this.sampleSystem(LANG[input.language] ?? 'English').replace('${channel}', input.channel), user, 1200)) as Partial<SampleContent>;
    return { content: normalizeContent(p, input.channel) };
  }

  async classifyFeedback(input: FeedbackClassifyInput): Promise<FeedbackClassifyOutput> {
    const system = [
      'You interpret a founder reaction to a marketing sample for VOICE learning. First separate whether the',
      'founder is reacting to the IDEA (strategy/angle) or the WORDING/VOICE or BOTH — a wrong idea must NOT',
      'become voice evidence. Then classify the signal strength and extract voice learning. Return ONLY JSON:',
      '{"target":"idea|wording|both|unclear","signal":"strongly_accept|accept_weak|reject|edit|founder_written",',
      '"negativeSpace":[{"category":"banned_word|cliche|hook|manipulation|directness|founder_exposure|format|polish|other","value":"..."}],',
      '"explicitBoundary":null,"inferred":[{"dimension":"directness|hook|claim_style|emotional_register|cta|rhythm|vocab_preferred|vocab_avoided|structure","statement":"a candidate voice tendency in plain words"}]}',
      'Rules: "I would never say X" → explicitBoundary. Quick "looks good" → accept_weak, no inferred patterns.',
      'A detailed rewrite or specific correction → strong directional inferred patterns. If target=idea, inferred MUST be empty.',
    ].join('\n');
    const user = [`CHANNEL: ${input.channel}`, 'SAMPLE:', JSON.stringify(input.sample), '', `FOUNDER REACTION: ${input.reactionText}`].join('\n');
    const p = (await this.call(system, user, 900)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const target = ['idea', 'wording', 'both', 'unclear'].includes(p?.target) ? p.target : 'unclear';
    const signal = ['strongly_accept', 'accept_weak', 'reject', 'edit', 'founder_written'].includes(p?.signal) ? p.signal : 'accept_weak';
    const negativeSpace = Array.isArray(p?.negativeSpace) ? p.negativeSpace.map((n: any) => ({ category: n?.category ?? 'other', value: String(n?.value ?? '').trim() })).filter((n: { value: string }) => n.value) : []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const inferred = target === 'idea' ? [] : (Array.isArray(p?.inferred) ? p.inferred.map((i: any) => ({ dimension: String(i?.dimension ?? 'rhythm'), statement: String(i?.statement ?? '').trim() })).filter((i: { statement: string }) => i.statement) : []); // eslint-disable-line @typescript-eslint/no-explicit-any
    const explicitBoundary = typeof p?.explicitBoundary === 'string' && p.explicitBoundary.trim() ? p.explicitBoundary.trim() : null;
    return { target, signal, negativeSpace, explicitBoundary, inferred };
  }

  async auditClaims(input: ClaimAuditInput): Promise<ClaimAuditOutput> {
    const system = [
      'You are a strict factuality auditor for marketing copy. For EACH clause apply the TRUTH-CONDITION TEST:',
      'if a reasonable person could ask "how do we know that is true?", the clause makes a MATERIAL assertion and',
      'needs authority. A clause is NOT rhetorical merely because it has no number, sounds generic, is advice, is',
      'second-person, is evaluative, or is a marketing generalization. "Rhetorical" is NARROW — only language with',
      'NO external truth condition ("here is another way to look at it", "that distinction matters", "book a call").',
      'Flag as material if the clause: asserts some entity does/is/has/tends-to/usually-does something; asserts a',
      'relationship (X causes/enables/prevents/requires Y); generalizes over founders/buyers/customers/partners/',
      'teams/companies/markets/audiences; describes actual historical customer behavior; or could be made more/less',
      'true by evidence.',
      'Classes: value (an OWNED stance — "we care about X"), business_fact, operational, capability (how we build/',
      'deliver), quality (how good/careful the work is), outcome (what changed/was achieved), market (population/',
      '"most partners…", "founders usually…"), customer (about ACTUAL customers incl. anecdotes/testimonials —',
      '"the founders who call us…", "our clients usually…", "a founder once told us…", "a client said…"),',
      'behavior (reader psychology — "you\'re probably…"), causal (empirical mechanism —',
      '"proof makes evaluation possible", "clarity reduces hesitation"), strategic_decision (an adopted direction),',
      'rhetorical (no external assertion).',
      'AUTHORITY: business_fact/operational/capability/quality/outcome need BUSINESS or FOUNDER-OWNED material.',
      'market/customer/behavior/causal need market/customer/behavior evidence (NONE is provided → always unauthorized,',
      'even without a percentage). value needs a matching owned stance. strategic_decision is authorized only if it',
      'matches a STRATEGY DECISION and is phrased as a direction ("for this strategy, proof comes before the CTA"),',
      'NOT as an empirical fact ("proof is what makes buyers convert"). rhetorical is always fine.',
      'Return ONLY unauthorized assertions: {"violations":[{"clause":"...","claimClass":"...","reason":"why unauthorized"}]}.',
      'Do NOT flag genuinely rhetorical framing, owned values, or licensed decisions. But do NOT let a population,',
      'customer, or causal generalization escape as rhetorical.',
    ].join('\n');
    const user = [
      'ALLOWED — BUSINESS FACTS:', ...(input.allowed.business.length ? input.allowed.business.map((x) => `• ${x}`) : ['(none)']),
      'ALLOWED — FOUNDER-OWNED:', ...(input.allowed.founderOwned.length ? input.allowed.founderOwned.map((x) => `• ${x}`) : ['(none)']),
      'ALLOWED — STRATEGY DECISIONS:', ...(input.allowed.strategyDecisions.length ? input.allowed.strategyDecisions.map((x) => `• ${x}`) : ['(none)']),
      '', `CHANNEL: ${input.channel}`, 'COPY:', JSON.stringify(input.content),
    ].join('\n');
    const p = (await this.call(system, user, 900)) as { violations?: unknown };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const violations = Array.isArray(p.violations) ? p.violations.map((v: any) => ({ clause: String(v?.clause ?? '').trim(), claimClass: String(v?.claimClass ?? 'unknown'), reason: String(v?.reason ?? '').trim() })).filter((v: { clause: string }) => v.clause) : [];
    return { violations };
  }

  /** Resolved judge identity for the immutable authorization snapshot — real model id + judge-prompt hash. */
  judgeContract(): { modelId: string; promptHash: string } {
    return { modelId: this.modelId, promptHash: createHash('sha256').update(VOICE_JUDGE_SYSTEM, 'utf8').digest('hex') };
  }

  async checkPropositions(input: PropositionCheckInput): Promise<PropositionCheckOutput> {
    const s = input.spec;
    const system = VOICE_JUDGE_SYSTEM;
    const user = [
      'AUTHORIZED PROPOSITIONS:', ...(s.licensedPropositions.length ? s.licensedPropositions.map((p) => `• ${p.text}`) : ['(none)']),
      ...(s.stanceStatements.length ? ['OWNED STANCES:', ...s.stanceStatements.map((x) => `• ${x}`)] : []),
      `REQUIRED CTA (not a violation): ${s.ctaFunction || '(none)'}`,
      '', `CHANNEL: ${input.channel}`, 'CANDIDATE COPY:', JSON.stringify(input.content),
    ].join('\n');
    // Semantic validation is a DIFFERENT job from creative realization: run it at the lowest-variance
    // setting the adapter supports. temperature 0 reduces (but cannot fully remove) judge drift; the
    // application layer's N-pass UNION-FAIL is the authoritative guard against a lucky clean verdict.
    const p = (await this.call(system, user, 900, 0)) as { newPropositions?: unknown };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newPropositions = Array.isArray(p.newPropositions) ? p.newPropositions.map((v: any) => ({ clause: String(v?.clause ?? '').trim(), proposition: String(v?.proposition ?? '').trim(), reason: String(v?.reason ?? '').trim() })).filter((v: { clause: string }) => v.clause) : [];
    return { newPropositions };
  }

  async projectVoice(input: VoiceProjectionInput): Promise<VoiceProjectionOutput> {
    const system = [
      `You describe, in ${LANG[input.language] ?? 'English'}, what has been learned about how this ${input.subject === 'brand' ? 'brand' : 'founder'} communicates —`,
      'in plain founder-facing sentences (e.g. "You prefer concrete claims over hype."). Ground each line in the',
      'examples/patterns/negative-space provided. Do NOT expose schemas, scores, or internal IDs. Return ONLY',
      'JSON: {"lines":["...","..."]} — at most 6 short lines.',
    ].join('\n');
    const ws = input.workingSet;
    const user = ['ACCEPTED EXAMPLES:', ...ws.acceptedExamples.map((e) => `• ${e}`), '', 'EDITS:', ...ws.edits.map((e) => `• ${e.before} → ${e.after}`), '', 'NEGATIVE SPACE:', ...ws.negativeSpace.map((n) => `• ${n}`), '', 'BOUNDARIES:', ...ws.boundaries.map((b) => `• ${b}`), '', 'PATTERNS:', ...ws.establishedPatterns.map((p) => `• ${p}`)].join('\n');
    const p = (await this.call(system, user, 700)) as { lines?: unknown };
    const lines = Array.isArray(p.lines) ? p.lines.map((l) => String(l).trim()).filter(Boolean).slice(0, 6) : [];
    return { lines };
  }
}

function normalizeContent(p: Partial<SampleContent>, channel: string): SampleContent {
  if (channel === 'caption') return { caption: typeof p.caption === 'string' ? p.caption : '', cta: typeof p.cta === 'string' ? p.cta : '' };
  return { hook: typeof p.hook === 'string' ? p.hook : '', beats: Array.isArray(p.beats) ? p.beats.filter((b) => typeof b === 'string') : [], cta: typeof p.cta === 'string' ? p.cta : '' };
}
