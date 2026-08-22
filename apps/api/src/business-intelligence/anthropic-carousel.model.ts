/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import { createAnthropicClient } from '@bb/infrastructure';
import type {
  ICarouselModelPort, CarouselModelInput, Concept, CarouselCopyDraft, CarouselBrief, AssetAuthorizationSnapshot,
  AntiTemplateVerdict, ClosureVerdict, SlideRole, ConceptFamily, SlideCopy, CopyBinding, ConstrainedRealizationInput, GenerationMode,
  RepairTarget, RepairedBlock, AntiTemplateClassification,
} from '@bb/application';

/**
 * Slice 6 carousel model. Produces ONE coherent asset-level communication (not N independent slide messages):
 * a concept, then a CarouselCopyDraft the composer maps to structured slides. Voice controls rhythm/register/
 * hook/CTA; it is NOT the proposition author — copy may only express the AUTHORIZED propositions/proof from the
 * snapshot. Documented proof numbers are cited faithfully, never turned into forward promises. Strict JSON.
 */
const ROLES: SlideRole[] = ['hook', 'context', 'proof', 'insight', 'step', 'reframe', 'cta'];
const FAMILIES: ConceptFamily[] = ['proof_breakdown', 'problem_reframe', 'myth_correction', 'before_after', 'founder_insight', 'checklist', 'offer_explainer'];
const str = (v: unknown): string => String(v ?? '').trim();

function extractJson(text: string): unknown {
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) throw new Error('CAROUSEL_MALFORMED: no JSON');
  return JSON.parse(text.slice(s, e + 1));
}

const CONCEPT_SYSTEM = [
  'You choose ONE carousel CONCEPT that EXECUTES a confirmed marketing strategy with the available material.',
  'A concept is a communication STRUCTURE (an ordered sequence of slide roles), chosen because the strategy +',
  'available material genuinely call for it — NOT because a template "performs well". Roles are ONE of:',
  '  hook, context, proof, insight, step, reframe, cta. The sequence has 3–8 slides, starts with hook, ends',
  'with cta, and never pads. Only claim a "proof" slide if there is a documented proof fact to ground it.',
  'Return ONLY JSON: {"rationale":"founder-legible why","communicationLogic":"why THIS structure executes the',
  'strategy","slideOutline":["hook","proof","cta"],"materialFeasibility":"which available material makes it',
  'renderable","internalFamily":"proof_breakdown|problem_reframe|myth_correction|before_after|founder_insight|checklist|offer_explainer"}.',
].join('\n');

const COPY_SYSTEM = [
  'You write ONE coherent carousel — a single communication across slides, in the founder\'s VOICE. You control',
  'rhythm, register, density, the hook and the CTA phrasing. You are NOT the proposition author: EVERY headline',
  'and body sentence must be one of exactly three things:',
  '  (1) a faithful expression of an AUTHORIZED PROPOSITION or a documented PROOF FACT provided to you;',
  '  (2) a purely NON-PROPOSITIONAL line — a brief invitation/CTA, a connective, or a question that presupposes',
  '      nothing about the reader or the world;',
  '  (3) nothing — leave it out. A spare, TRUE carousel beats a vivid one that adds claims. When in doubt, cut.',
  'FORBIDDEN — never state OR imply any of these unless the EXACT proposition is in the authorized set:',
  '  - what "most founders" / the market / the reader think, feel, know, do, or miss (no audience psychology,',
  '    no population/market claims, no "most seed founders…", no "you have X but no Y");',
  '  - causal or mechanism claims ("X leads to Y", "the money was leaving", "burn is a behavior");',
  '  - reframes that assert a hidden truth ("the real problem is…", "closing the round isn\'t the finish line");',
  '  - invented proof, metrics, outcomes, guarantees, capabilities, testimonials, product facts. A documented',
  '    proof number (e.g. "30%") is cited faithfully as a PAST documented result, NEVER as a forward promise,',
  '    and NEVER elaborated ("no headcount cuts", "same revenue") beyond what the proof fact literally states.',
  '  - cost/value comparisons ("without the full-time cost", "cheaper than a full-time hire", "saves money");',
  '  - urgency or timing pressure ("now, not later", "before it becomes urgent", "the clock is ticking");',
  '  - comparative or superlative framing ("matters most", "the biggest mistake", "the best way");',
  '  - unlicensed mechanism/detail about how work is done ("just a founder and a spreadsheet", "a quick fix").',
  'OWNED STANCE DISCIPLINE: a founder belief/opinion may be expressed ONLY as the founder\'s own view — first',
  'person ("I believe…", "we treat…", "our view is…"). NEVER convert it into an empirical claim about what',
  '"most"/"many"/other founders actually think, feel, or do (that is a population claim, not the owned stance),',
  'and never add an evaluation like "that\'s a real gap/problem". State the stance; do not universalize it.',
  'BIND FIRST: for each substantive line, first identify the ONE authorized proposition / proof fact / owned',
  'stance it realizes, then write ONLY that meaning in the founder\'s voice. If a line would need a meaning that',
  'is not in the authorized set, DROP the line — never invent a bridge proposition to make the carousel flow or',
  'sound more persuasive. A non-proof carousel especially must be built ONLY from its bound authorized units.',
  'THE HOOK is bound by the same rules: open with a faithful restatement of the offer/audience or a',
  'non-propositional line — do NOT manufacture a market/psychology hook to seem engaging.',
  'STRUCTURE: one slide per role in the concept outline, in order; hook first, cta last; no padding, no repeats.',
  'Keep each slide short enough for a 1080×1350 card: headline ≤ ~8 words, body ≤ ~2 short sentences.',
  'For each block, bind it to the licensed proposition / proof / CTA function that authorizes it (or null for a',
  'purely non-propositional line).',
  'Return ONLY JSON: {"hook":"...","cta":"...","orderedSlideCopy":[{"slideKey":"s1","role":"hook","headline":"...",',
  '"body":"...","kicker":"..."}],"propositionBindings":[{"blockRef":"s1:headline","propositionRef":"P1|null",',
  '"sourceRefId":"...|null","ctaFunction":"...|null"}]}.',
].join('\n');

const CONSTRAINED_SYSTEM = [
  'You are an EXTRACTIVE realizer, NOT a writer. The communication is already decided: you receive a FIXED',
  'skeleton (one beat per slide) and a closed list of AUTHORIZED MEANING UNITS with refs. You may express ONLY',
  'the meaning already present in those units. You are re-surfacing existing meaning, never adding any.',
  'MAP each substantive block 1:1 or N:1 to cited unit refs. Every substantive block MUST list its',
  'meaningUnitRefs. A substantive block with zero refs is INVALID. Only the hook opener may be ref-less, and it',
  'must be genuinely non-propositional (a greeting or a question that presupposes nothing).',
  'ALLOWED transforms: faithful paraphrase, compression, syntax change, Voice-compatible rhythm, first-person',
  'realization of an owned stance, and non-propositional connective words.',
  'FORBIDDEN — you may NOT introduce a new substantive predicate: no population/market generalization, no',
  'audience psychology, no invented causality/mechanism, no urgency/timing, no cost/value comparison, no',
  'superlative/comparative, no reader-outcome implication, no new evaluation ("that\'s the gap"), no "not a',
  'sales pitch"/"built for…"/"what comes next" style additions. If it is not in a cited unit, it does not exist.',
  'PRESERVE EXACTLY (a change here is a DIFFERENT claim, forbidden): quantifier (many≠most, some≠all), polarity',
  '(no added negation), actor (client result ≠ reader result), tense (past documented result ≠ future promise),',
  'modality (can≠will, may≠guarantee), and scope (an alternative-to-a-hire is NOT "cheaper").',
  'OWNED STANCE stays first-person ("I believe…", "our view is…") — never "most/other founders think/do".',
  'CTA: realize ONLY the CTA function plus already-cited offer facts. No new benefit, no "free"/"no',
  'commitment"/"limited", and the CTA headline must NOT merely repeat the CTA line.',
  'Keep each slide short for a 1080×1350 card: headline ≤ ~8 words, body ≤ ~2 short sentences. Simplicity and',
  'concision are correct here — do NOT add sophistication. Faithfully executing the smallest job is the goal.',
].join('\n');

const ANTITEMPLATE_SYSTEM = [
  'You review whether a carousel is CAUSALLY DERIVED from THIS business\'s strategy + material, or a generic',
  'best-practice template wearing this business\'s nouns. A shared mechanic (a proof breakdown, a checklist) is',
  'FINE when the strategy/material specifically call for it. FAIL only when the slide logic is generic and would',
  'survive unchanged if the strategy/material were removed (decorative nouns). Return ONLY JSON:',
  '{"generic":true|false,"reason":"one sentence"}.',
].join('\n');

// Constrained mode (§6/§7): the copy is faithfully extracted from the authorized material by construction, so
// simplicity, concision, and closeness to that material are CORRECT, not genericity. Judge only whether the
// smallest feasible communication job is actually executed with the bound material.
const ANTITEMPLATE_CONSTRAINED_SYSTEM = [
  'You review a DELIBERATELY MINIMAL carousel whose copy is extracted faithfully from this business\'s authorized',
  'material. Do NOT penalize it for being simple, short, or close to the material — that is intended. The',
  'question is ONLY: does it execute the communication job using THIS business\'s specific bound material?',
  'Return generic=true ONLY when: the communication job is not executed at all; the slides are filler unrelated',
  'to the bound material; or decorative nouns do all the specificity work (swap the business and it is identical).',
  'A short, plain, on-material carousel is generic=false. Return ONLY JSON: {"generic":true|false,"reason":"one sentence"}.',
].join('\n');

// Targeted repair (§4–§6): fix ONE block at a time. Never a rewrite of the carousel; never new meaning.
const REPAIR_SYSTEM = [
  'You perform SURGICAL, block-scoped repairs on an already-approved carousel. For each target you receive its',
  'current text, the exact gate it failed, and the authorized meaning it is bound to. Return ONLY new text for',
  'each target — every other block stays untouched. You may NOT add any predicate, quantifier, comparison,',
  'causality, urgency, benefit, or connective that carries new meaning. Preserve actor, time, polarity,',
  'quantifier and modality exactly (a documented past result is never a future promise; many≠most; can≠will).',
  'For an overflow target: compress wording only, dropping NO bound meaning. For a CTA/closure target: name the',
  'authorized action clearly, add no new benefit or condition, and do not repeat another line verbatim. For a',
  'safety target: strip the unlicensed meaning so only the bound unit remains. Return ONLY the requested JSON.',
].join('\n');

// Anti-template classifier (§7): decide the CAUSE before any prose is touched.
const ANTITEMPLATE_CLASSIFY_SYSTEM = [
  'A minimal, extracted carousel failed an anti-template check. Classify the CAUSE (do not rewrite):',
  '  A — the concept/communication job itself is not supported by the material (a structural mismatch, not prose);',
  '  B — the copy is simply short/plain/close to the authorized material, which is NOT a defect here;',
  '  C — one specific block is genuine generic filler (decorative nouns, no bound meaning) — name it in blockRef',
  '      using that slide’s role (e.g. "context", "proof").',
  'Prefer B when the only "problem" is simplicity. Return ONLY JSON: {"klass":"A|B|C","blockRef":"role|null","reason":"one sentence"}.',
].join('\n');

const CLOSURE_SYSTEM = [
  'You judge whether a carousel CTA CLOSES the communication (a QUALITY check, not a truth check). The CTA is',
  'already authorized; decide only whether it is EARNED by the body and clear. Return closed=false when ANY:',
  '  - the reader cannot tell what the action is or what it is for;',
  '  - the CTA is not causally connected to the problem/insight/offer the body developed;',
  '  - the CTA introduces a NEW object never set up by the body or offer material;',
  '  - the CTA merely repeats a prior line without adding clarity.',
  'A CTA that names the developed offer/next-step and follows from the body is closed=true. Return ONLY JSON:',
  '{"closed":true|false,"reason":"one sentence"}.',
].join('\n');

function conceptUser(brief: CarouselBrief, snap: AssetAuthorizationSnapshot): string {
  return [
    `COMMUNICATION JOB: ${brief.communicationJob}`,
    `STRATEGY BET: ${brief.strategicBetTrace}`, `FOUNDER GOAL: ${brief.founderGoalTrace}`,
    `AUDIENCE / USE CONTEXT: ${brief.audienceUseContext}`, `CTA DIRECTION: ${brief.ctaDirection}`,
    '', 'AUTHORIZED PROPOSITIONS:', ...(snap.licensedPropositions.length ? snap.licensedPropositions.map((p) => `- [${p.ref}] ${p.text}`) : ['- (none)']),
    '', 'DOCUMENTED PROOF FACTS (cite faithfully, never as a forward promise):', ...(snap.proofFacts.length ? snap.proofFacts.map((p) => `- ${p}`) : ['- (none)']),
  ].join('\n');
}

export class AnthropicCarouselModel implements ICarouselModelPort {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) { this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6'; }

  private async call(system: string, user: string, maxTokens: number): Promise<unknown> {
    const client = createAnthropicClient(this.apiKey);
    const resp: any = await client.messages.create({ model: this.modelId, max_tokens: maxTokens, temperature: 0, system, messages: [{ role: 'user', content: user }] });
    const block = Array.isArray(resp?.content) ? resp.content.find((c: any) => c?.type === 'text') : null;
    return extractJson((block as any)?.text ?? '');
  }

  async chooseConcept(input: { brief: CarouselBrief; snapshot: AssetAuthorizationSnapshot; repairReasons?: string[] }): Promise<Concept> {
    const user = conceptUser(input.brief, input.snapshot) + (input.repairReasons?.length ? '\n\nFIX: ' + input.repairReasons.join('; ') : '');
    const r = (await this.call(CONCEPT_SYSTEM, user, 700)) as any;
    const outline: SlideRole[] = (Array.isArray(r?.slideOutline) ? r.slideOutline : []).map((x: any): SlideRole => (ROLES.includes(x) ? x : 'context')).slice(0, 8);
    const fixed: SlideRole[] = outline.length ? outline : ['hook', 'context', 'cta'];
    if (fixed[0] !== 'hook') fixed.unshift('hook');
    if (fixed[fixed.length - 1] !== 'cta') fixed.push('cta');
    return {
      conceptId: 'c-' + createHash('sha1').update(JSON.stringify(fixed) + str(r?.communicationLogic)).digest('hex').slice(0, 10),
      rationale: str(r?.rationale), communicationLogic: str(r?.communicationLogic), slideOutline: fixed.slice(0, 8),
      materialFeasibility: str(r?.materialFeasibility), internalFamily: (FAMILIES.includes(r?.internalFamily) ? r.internalFamily : 'founder_insight'),
    };
  }

  async draftCopy(input: CarouselModelInput): Promise<CarouselCopyDraft> {
    const { brief, snapshot: snap, voiceLines, concept } = input;
    const user = [
      conceptUser(brief, snap),
      '', 'CONCEPT (write to this exact ordered structure):', concept.slideOutline.map((r, i) => `s${i + 1}: ${r}`).join(' → '),
      '', 'VOICE (rhythm/register to match — not a claim source):', ...(voiceLines.length ? voiceLines.map((l) => `- ${l}`) : ['- (neutral, plain, concrete)']),
      `LANGUAGE: ${brief.language}`,
      ...(input.repairReasons?.length ? ['', 'SURGICAL REPAIR. The previous draft added UNLICENSED meaning (listed below). Return the COMPLETE corrected',
        'carousel, changing ONLY what is required. For each flagged line: DELETE the offending clause and either',
        'replace it with the VERBATIM-EQUIVALENT of one AUTHORIZED PROPOSITION above (keep its exact scope and',
        'quantifier — if the authorized text says "many", never write "most"; keep the exact metric), or make it a',
        'purely non-propositional line, or drop that slide (keep ≥3 slides, hook first, cta last). The CTA must be',
        'ONLY the authorized next action plus authorized offer facts — no "no commitment", no reassurance, no extra',
        'claim. Do NOT re-add a rephrased version of any flagged clause. Every remaining line must map to one',
        'authorized unit or be non-propositional:',
        ...input.repairReasons.map((r) => `- ${r}`)] : []),
    ].join('\n');
    const r = (await this.call(COPY_SYSTEM, user, 2000)) as any;
    const slides: SlideCopy[] = (Array.isArray(r?.orderedSlideCopy) ? r.orderedSlideCopy : []).map((s: any, i: number): SlideCopy => ({
      slideKey: str(s?.slideKey) || `s${i + 1}`, role: (ROLES.includes(s?.role) ? s.role : (concept.slideOutline[i] ?? 'context')),
      headline: str(s?.headline) || undefined, body: str(s?.body) || undefined, kicker: str(s?.kicker) || undefined,
    }));
    const bindings: CopyBinding[] = (Array.isArray(r?.propositionBindings) ? r.propositionBindings : []).map((b: any): CopyBinding => ({
      blockRef: str(b?.blockRef), propositionRef: b?.propositionRef == null ? null : str(b.propositionRef) || null,
      sourceRefId: b?.sourceRefId == null ? null : str(b.sourceRefId) || null, ctaFunction: b?.ctaFunction == null ? null : str(b.ctaFunction) || null,
    })).filter((b: CopyBinding) => b.blockRef);
    return { communicationJob: brief.communicationJob, language: brief.language, hook: str(r?.hook), orderedSlideCopy: slides, cta: str(r?.cta), propositionBindings: bindings };
  }

  async reviewAntiTemplate(input: { assetView: unknown; brief: CarouselBrief; mode?: GenerationMode }): Promise<AntiTemplateVerdict> {
    const user = `STRATEGY BET: ${input.brief.strategicBetTrace}\nJOB: ${input.brief.communicationJob}\nAUDIENCE: ${input.brief.audienceUseContext}\n\nCAROUSEL (JSON):\n${JSON.stringify(input.assetView)}`;
    const system = input.mode === 'constrained_fallback' ? ANTITEMPLATE_CONSTRAINED_SYSTEM : ANTITEMPLATE_SYSTEM;
    const r = (await this.call(system, user, 300)) as any;
    return { generic: Boolean(r?.generic), reason: str(r?.reason) };
  }

  async realizeConstrained(input: ConstrainedRealizationInput): Promise<CarouselCopyDraft> {
    const { brief, snapshot: snap, voiceLines, beats, ctaFunction } = input;
    const beatLine = (b: typeof beats[number], i: number): string => {
      if (b.role === 'hook') return `s${i + 1} [hook]: (NON-PROPOSITIONAL opener — a greeting or a question that presupposes nothing. Assert NOTHING new. No refs.)`;
      if (b.role === 'cta') return `s${i + 1} [cta]: realize the CTA FUNCTION «${ctaFunction}» only. refs: [CTA]${snap.licensedPropositions.filter((p) => p.source === 'business_evidence').map((p) => `, ${p.ref}`).join('')} (offer facts, optional).`;
      return `s${i + 1} [${b.role}]: realize EXACTLY these unit(s), nothing else — ${b.units.map((u) => `[${u.ref}] «${u.text}»`).join('  +  ')}`;
    };
    const user = [
      `AUDIENCE / USE CONTEXT: ${brief.audienceUseContext}`, `REQUIRED CTA FUNCTION: ${ctaFunction}`, `LANGUAGE: ${brief.language}`,
      '', 'AUTHORIZED MEANING UNITS (the ONLY meaning you may express; cite refs verbatim):',
      ...beats.flatMap((b) => b.units).filter((u, i, a) => a.findIndex((x) => x.ref === u.ref) === i).map((u) => `  [${u.ref}] (${u.type}) ${u.text}`),
      `  [CTA] (cta_function) ${ctaFunction}`,
      '', 'FIXED SKELETON — one slide per beat, in this exact order. EXTRACT, do not write:',
      ...beats.map(beatLine),
      '', 'VOICE (rhythm/register ONLY — never a source of meaning):', ...(voiceLines.length ? voiceLines.map((l) => `- ${l}`) : ['- (plain, concrete, no hype)']),
      '', 'For EVERY substantive block you MUST list the unit ref(s) it realizes in meaningUnitRefs. A substantive',
      'block with no ref is forbidden. The hook opener carries meaningUnitRefs: []. Do NOT introduce any predicate',
      'not present in a cited unit. Preserve every quantifier (many≠most), polarity, actor, tense and modality',
      '(a past documented result is NEVER a future promise; a client result is NEVER the reader’s result).',
      '', 'Return ONLY JSON: {"hook":"...","cta":"...","orderedSlideCopy":[{"slideKey":"s1","role":"hook","headline":"...","body":"...","meaningUnitRefs":[]}],"propositionBindings":[]}.',
      'You may omit propositionBindings; meaningUnitRefs per block is the binding.',
    ].join('\n');
    const r = (await this.call(CONSTRAINED_SYSTEM, user, 1600)) as any;
    const validRefs = new Set([...beats.flatMap((b) => b.units.map((u) => u.ref)), 'CTA']);
    const rawSlides = Array.isArray(r?.orderedSlideCopy) ? r.orderedSlideCopy : [];
    const slides: SlideCopy[] = rawSlides.map((s: any, i: number): SlideCopy => ({
      slideKey: str(s?.slideKey) || `s${i + 1}`, role: (ROLES.includes(s?.role) ? s.role : (beats[i]?.role ?? 'context')),
      headline: str(s?.headline) || undefined, body: str(s?.body) || undefined, kicker: str(s?.kicker) || undefined,
    }));
    // Build block bindings FROM the model's declared meaningUnitRefs (extractive contract). CTA ref → ctaFunction;
    // any other cited unit ref → propositionRef. A block that cites nothing carries an empty binding (the
    // deterministic binding validator downstream rejects an unbound SUBSTANTIVE block before safety runs).
    const bindings: CopyBinding[] = [];
    rawSlides.forEach((s: any, i: number) => {
      const key = str(s?.slideKey) || `s${i + 1}`;
      const refs: string[] = (Array.isArray(s?.meaningUnitRefs) ? s.meaningUnitRefs : []).map((x: any) => str(x)).filter((x: string) => validRefs.has(x));
      // a slide's declared refs bind EVERY substantive block it carries (a framing headline + a body both realize
      // the slide's bound meaning) — so no sibling block is left unbound.
      const fields = ['headline', 'body', 'kicker'].filter((f) => str(s?.[f]));
      for (const field of fields) for (const ref of refs) {
        if (ref === 'CTA') bindings.push({ blockRef: `${key}:${field}`, propositionRef: null, sourceRefId: null, ctaFunction });
        else bindings.push({ blockRef: `${key}:${field}`, propositionRef: ref, sourceRefId: null, ctaFunction: null });
      }
    });
    // also honor any explicit propositionBindings the model returned (belt-and-suspenders)
    for (const b of (Array.isArray(r?.propositionBindings) ? r.propositionBindings : [])) {
      const blockRef = str(b?.blockRef); if (!blockRef) continue;
      bindings.push({ blockRef, propositionRef: b?.propositionRef == null ? null : str(b.propositionRef) || null, sourceRefId: b?.sourceRefId == null ? null : str(b.sourceRefId) || null, ctaFunction: b?.ctaFunction == null ? null : str(b.ctaFunction) || null });
    }
    return { communicationJob: brief.communicationJob, language: brief.language, hook: str(r?.hook), orderedSlideCopy: slides, cta: str(r?.cta), propositionBindings: bindings };
  }

  async repairConstrained(input: { targets: RepairTarget[]; snapshot: AssetAuthorizationSnapshot; concept: Concept; brief: CarouselBrief; voiceLines: string[]; ctaFunction: string }): Promise<RepairedBlock[]> {
    const { targets, snapshot: snap, ctaFunction } = input;
    const unitByRef = new Map<string, string>();
    snap.proofFacts.forEach((t, i) => unitByRef.set(`PF${i + 1}`, t));
    for (const p of snap.licensedPropositions) unitByRef.set(p.ref, p.text);
    unitByRef.set('CTA', ctaFunction);
    const targetLine = (t: RepairTarget, i: number): string => {
      const bound = t.meaningUnitRefs.map((r) => `[${r}] «${unitByRef.get(r) ?? ''}»`).join('  +  ') || '(non-propositional invitation)';
      const rule = t.gateClass === 'overflow' ? 'SHORTEN it to fit — compress wording only; keep all bound meaning, drop nothing substantive.'
        : t.gateClass === 'closure' ? 'Fix the CTA: name the authorized action clearly; do NOT repeat another line verbatim; add NO new benefit/condition (no free/no-commitment/limited/easy/results).'
        : t.gateClass === 'anti_template_filler' ? 'Replace the generic filler with a concrete restatement of ONLY the bound unit(s); no decorative nouns.'
        : 'Rewrite to remove the unlicensed meaning: express ONLY the bound unit(s), same actor/time/polarity/quantifier/modality; add no predicate.';
      return `#${i} slide=${t.slideId} block=${t.blockId} role=${t.blockRole} class=${t.gateClass}\n  current: "${t.currentText}"\n  failing: ${t.detail}\n  bound meaning (preserve exactly): ${bound}\n  → ${rule}`;
    };
    const user = [
      'Repair ONLY these blocks. Return the new text for each — nothing else changes. Preserve each block’s bound',
      'meaning, actor, time, polarity, quantifier and modality; introduce NO new predicate or connective that adds',
      'meaning. Keep it short for a 1080×1350 card.',
      `LANGUAGE: ${input.brief.language}`, '', ...targets.map(targetLine),
      '', 'Return ONLY JSON: {"repairs":[{"slideId":"...","blockId":"...","newText":"..."}]}.',
    ].join('\n');
    const r = (await this.call(REPAIR_SYSTEM, user, 900)) as any;
    const valid = new Set(targets.map((t) => `${t.slideId}::${t.blockId}`));
    return (Array.isArray(r?.repairs) ? r.repairs : []).map((x: any): RepairedBlock => ({ slideId: str(x?.slideId), blockId: str(x?.blockId), newText: str(x?.newText) }))
      .filter((x: RepairedBlock) => valid.has(`${x.slideId}::${x.blockId}`) && x.newText);
  }

  async classifyAntiTemplate(input: { assetView: unknown; brief: CarouselBrief }): Promise<AntiTemplateClassification> {
    const user = `STRATEGY BET: ${input.brief.strategicBetTrace}\nJOB: ${input.brief.communicationJob}\n\nCAROUSEL (JSON, each slide has a role + text):\n${JSON.stringify(input.assetView)}`;
    const r = (await this.call(ANTITEMPLATE_CLASSIFY_SYSTEM, user, 200)) as any;
    const raw = str(r?.klass);
    const klass: AntiTemplateClassification['klass'] = raw.startsWith('A') ? 'A_unsupported_concept' : raw.startsWith('C') ? 'C_substantive_filler' : 'B_simple_not_defect';
    return { klass, blockRef: r?.blockRef == null ? null : str(r.blockRef) || null, reason: str(r?.reason) };
  }

  async reviewClosure(input: { bodyBeats: string[]; cta: string; ctaFunction: string; offerMaterial: string[] }): Promise<ClosureVerdict> {
    const user = [
      'BODY (ordered slides before the CTA):', ...input.bodyBeats.map((b, i) => `${i + 1}. ${b}`),
      '', `CTA: ${input.cta}`, `REQUIRED CTA FUNCTION: ${input.ctaFunction}`,
      '', 'OFFER MATERIAL (what the action is / involves):', ...(input.offerMaterial.length ? input.offerMaterial.map((m) => `- ${m}`) : ['- (none)']),
    ].join('\n');
    const r = (await this.call(CLOSURE_SYSTEM, user, 220)) as any;
    return { closed: r?.closed !== false, reason: str(r?.reason) };
  }

  descriptor(): { modelId: string; copyContractHash: string } {
    return { modelId: this.modelId, copyContractHash: createHash('sha256').update(COPY_SYSTEM + CONCEPT_SYSTEM, 'utf8').digest('hex').slice(0, 16) };
  }
}
