/* eslint-disable @typescript-eslint/no-explicit-any */
import { createAnthropicClient } from '../llm/anthropic-client';
import type { IConceptPlanModelPort, ConceptPlanInput, ConceptPlanDraft } from '@bb/application';

const str = (v: unknown): string => String(v ?? '').trim();
const num = (v: unknown, fb: number): number => { const n = Number(v); return isFinite(n) ? n : fb; };
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fb: T): T => (allowed.includes(v as T) ? (v as T) : fb);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
function extractJson(text: string): any { const a = text.indexOf('{'); const b = text.lastIndexOf('}'); if (a < 0 || b < a) return {}; try { return JSON.parse(text.slice(a, b + 1)); } catch { return {}; } }

const ROLES = ['hook', 'build', 'proof', 'detail', 'close'] as const;
const FRAMING = ['wide', 'medium', 'close'] as const;
const CAMERA = ['static', 'slow_move', 'follow'] as const;
const AUDIO = ['none', 'ambient', 'spoken_line'] as const;
const SAFE = ['left', 'right', 'none'] as const;
const ENERGY = ['low', 'medium', 'high'] as const;

// A creative director who tells a normal person exactly what to film with a phone. No film-school jargon.
const SYSTEM = [
  'You are the strategist + creative director for ONE specific business. Decide the SINGLE reel worth making next',
  'from its STRATEGY, and tell the founder exactly what to film with their phone. Output ONE concept + a shooting',
  'plan of 4–6 shots. Behave like a friend texting instructions a non-expert can follow — NEVER use lenses, ISO,',
  'focal length, shutter, lighting, or production jargon. Every shot must earn a beat; do not pad to a template.',
  'The plan must be SPECIFIC to THIS strategy and would look different for a different business or a different',
  'strategy. Match the visual energy to editingEnergy (calm → relaxed/low-motion shots; energetic → high-motion).',
  'Only ask for a talking-head SPOKEN LINE if the strategy earns it, and give the EXACT sentence. spokenLineIntent MUST',
  'be a natural, first-person sentence the founder SAYS ALOUD, written in the SPOKEN-LINE language given below (which is',
  'INDEPENDENT of the UI language) — never a label, tag, keyword, or strategy note. The founder must never be asked to',
  'improvise or to read jargon. The line must state ONLY what the strategy licenses (no health/result/earnings claims;',
  'it is governed separately). founderProse is the ONLY text the founder sees — write it in the UI LANGUAGE,',
  'concrete and impossible to misunderstand (e.g. "Film 4 seconds walking in. Hold the phone upright. Keep still.").',
  'Return ONLY JSON: {',
  '  communicationJob, strategicReason, narrativeArc, targetDurationMs, ctaDirection (or null),',
  '  sufficiencyAssumptions:[..], nonTransplantabilityTrace, estimatedEffort, generalGuidance:[2-3 short reminders],',
  '  shots:[{ sequenceRole:hook|build|proof|detail|close, storyJob, subject, visibleAction, framing:wide|medium|close,',
  '           cameraBehavior:static|slow_move|follow, approxDurationMs, audioNeed:none|ambient|spoken_line,',
  '           spokenLineIntent (or null), textSafeSide:left|right|none, visualEnergyNeed:low|medium|high,',
  '           required:boolean, founderFilms:boolean, completionCriteria, whyThisShot, alternativesAllowed:boolean, founderProse,',
  '           matchTokens:[literal subject/action nouns for later matching, e.g. "dish","plate","gym","grocery"] }] }',
  'Set founderFilms=false ONLY for a pure on-screen TEXT CARD the editor creates (no phone footage). For any shot the',
  'founder films with a phone, founderFilms=true. Prefer real footage; use text cards sparingly.',
].join('\n');

export class AnthropicConceptPlanModel implements IConceptPlanModelPort {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) { this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6'; }
  descriptor(): { modelId: string } { return { modelId: this.modelId }; }

  async propose(input: ConceptPlanInput): Promise<ConceptPlanDraft> {
    const client = createAnthropicClient(this.apiKey);
    const c = input.context;
    const user = [
      `BUSINESS: ${input.businessName}`,
      `STRATEGY goal: ${c.goal}`, `STRATEGY core bet: ${c.coreBet}`, `AUDIENCE: ${c.audience}`, `POSITIONING: ${c.positioning}`,
      `CTA direction: ${c.ctaDirection ?? '(none)'}`, `SPEAKING role: ${c.speakingRole}`,
      `LICENSED propositions (the reel may rest ONLY on these): ${JSON.stringify(c.licensedPropositions.map((p) => p.text))}`,
      `PROOF facts: ${JSON.stringify(c.proofFacts)}`, `OWNED stances: ${JSON.stringify(c.ownedStances)}`,
      `EDITING ENERGY (treatment): ${input.editingEnergy}`,
      `UI LANGUAGE for founderProse/effort/guidance: ${input.uiLanguage}`,
      `SPOKEN-LINE language (if any): ${c.language}`,
      input.constraints?.length ? `FOUNDER CONSTRAINTS to honor (adapt execution, NOT strategy): ${JSON.stringify(input.constraints)}` : '',
      input.avoidConcept ? `AVOID repeating this concept: ${input.avoidConcept}` : '',
      'Return the ONE reel worth filming next as JSON.',
    ].filter(Boolean).join('\n');
    let r: any = {};
    try {
      const resp: any = await client.messages.create({ model: this.modelId, max_tokens: 4600, temperature: 0.4, system: SYSTEM, messages: [{ role: 'user', content: user }] });
      const block = Array.isArray(resp?.content) ? resp.content.find((x: any) => x?.type === 'text') : null;
      r = extractJson(block?.text ?? '');
    } catch { r = {}; }
    const shots = arr(r.shots).map((s: any) => ({
      sequenceRole: oneOf(s.sequenceRole, ROLES, 'build'), storyJob: str(s.storyJob), subject: str(s.subject) || 'subject', visibleAction: str(s.visibleAction),
      framing: oneOf(s.framing, FRAMING, 'medium'), cameraBehavior: oneOf(s.cameraBehavior, CAMERA, 'static'), approxDurationMs: Math.max(2000, Math.min(8000, Math.round(num(s.approxDurationMs, 4000)))),
      orientation: 'vertical' as const, audioNeed: oneOf(s.audioNeed, AUDIO, 'ambient'), textSafeSide: oneOf(s.textSafeSide, SAFE, 'none'),
      visualEnergyNeed: s.visualEnergyNeed == null ? null : oneOf(s.visualEnergyNeed, ENERGY, 'medium'), required: s.required !== false, founderFilms: s.founderFilms !== false,
      completionCriteria: str(s.completionCriteria), whyThisShot: str(s.whyThisShot), alternativesAllowed: s.alternativesAllowed !== false,
      founderProse: str(s.founderProse) || 'Film this shot vertically for a few seconds.',
      matchTokens: arr(s.matchTokens).map((t: any) => str(t).toLowerCase()).filter(Boolean).slice(0, 8),
      spokenLineIntent: s.spokenLineIntent == null ? null : (str(s.spokenLineIntent) || null),
    })).slice(0, 6);
    return {
      communicationJob: str(r.communicationJob) || 'the reel worth making next', strategicReason: str(r.strategicReason), narrativeArc: str(r.narrativeArc),
      beats: [], targetDurationMs: Math.max(6000, Math.min(30000, Math.round(num(r.targetDurationMs, 14000)))), ctaDirection: r.ctaDirection == null ? null : (str(r.ctaDirection) || null),
      sufficiencyAssumptions: arr(r.sufficiencyAssumptions).map(str).filter(Boolean), nonTransplantabilityTrace: str(r.nonTransplantabilityTrace),
      estimatedEffort: str(r.estimatedEffort) || 'a few minutes of filming', generalGuidance: arr(r.generalGuidance).map(str).filter(Boolean).slice(0, 3), shots,
    };
  }
}
