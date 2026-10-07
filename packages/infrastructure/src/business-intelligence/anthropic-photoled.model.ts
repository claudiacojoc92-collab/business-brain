/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import { createAnthropicClient } from '../llm/anthropic-client';
import type {
  IObservationModelPort, IOpportunityModelPort, MediaObservation, OpportunityModelInput, OpportunityDraft,
  ObservationVerdict, ObservedSetting, ObservedSubject, MediaUsability, MediaOrientation, SelectedMediaItem,
} from '@bb/application';

const str = (v: unknown): string => String(v ?? '').trim();
function extractJson(text: string): any { const a = text.indexOf('{'); const b = text.lastIndexOf('}'); if (a < 0 || b < a) return {}; try { return JSON.parse(text.slice(a, b + 1)); } catch { return {}; } }
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fb: T): T => (allowed.includes(v as T) ? (v as T) : fb);

const SETTINGS: readonly ObservedSetting[] = ['gym', 'kitchen', 'restaurant', 'outdoor', 'studio', 'office', 'retail', 'home', 'event', 'unknown'];
const SUBJECTS: readonly ObservedSubject[] = ['prepared_dish', 'ingredient_or_grocery', 'person', 'product', 'document_or_screen', 'scene', 'text_graphic', 'unknown'];
const USABILITY: readonly MediaUsability[] = ['hero', 'supporting', 'detail', 'unusable'];
const ORIENT: readonly MediaOrientation[] = ['portrait', 'landscape', 'square'];
const VERDICT: readonly ObservationVerdict[] = ['observed', 'uncertain', 'unusable'];

// LITERAL vision only. No inference, no claim authority. Its output can NEVER license a business claim.
const OBSERVATION_SYSTEM = [
  'You are a LITERAL media describer for a founder photo. Report ONLY what is visibly present — no interpretation.',
  'You have NO authority to infer or state: calories, macros, nutrition, "healthy", weight-loss/fitness value,',
  'product properties or benefits, brand names, price, taste, the person\'s intent/emotion, or any result. If it is',
  'not literally visible, it does not exist. A meal photo is a photo of a meal — nothing more.',
  'Return ONLY JSON with these fields (closed vocabularies):',
  `  setting: one of ${SETTINGS.join('|')}`,
  `  subject: one of ${SUBJECTS.join('|')}`,
  '  objects: array of literal nouns you can see (e.g. "plate","dumbbell","laptop") — max 6',
  '  activity: a short literal activity string or null',
  '  containsText: boolean (is there text baked into the image?)',
  `  orientation: one of ${ORIENT.join('|')}`,
  '  hasClearSubject: boolean',
  `  usability: one of ${USABILITY.join('|')} — how usable as carousel media (hero=strong full-bleed, supporting, detail, unusable)`,
  `  verdict: one of ${VERDICT.join('|')} — observed (clear), uncertain (hard to tell), unusable (blurry/irrelevant)`,
  '  focalSubjectBox: {x,y,width,height} normalized 0-1 for the MAIN subject (the dish/person/product), or null',
  '  faceBoxes: array of {x,y,width,height} normalized 0-1 for any human FACES (empty if none)',
  'The two boxes are LITERAL image geometry — WHERE the subject/faces are. Do NOT suggest where text should go.',
].join('\n');
const box = (v: any): any => { if (!v || typeof v !== 'object') return null; const n = (x: any) => { const f = Number(x); return isFinite(f) ? Math.max(0, Math.min(1, f)) : null; }; const x = n(v.x), y = n(v.y), w = n(v.width ?? v.w), h = n(v.height ?? v.h); return x == null || y == null || w == null || h == null ? null : { x, y, width: w, height: h }; };

export class AnthropicObservationModel implements IObservationModelPort {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) { this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6'; }
  descriptor(): { modelId: string } { return { modelId: this.modelId }; }

  async observe(images: { sourceRefId: string; bytes: Buffer; mime?: string }[]): Promise<Omit<MediaObservation, 'observationId'>[]> {
    const client = createAnthropicClient(this.apiKey);
    const out: Omit<MediaObservation, 'observationId'>[] = [];
    for (const img of images) {
      let r: any = {};
      try {
        const resp: any = await client.messages.create({
          model: this.modelId, max_tokens: 400, temperature: 0, system: OBSERVATION_SYSTEM,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: (img.mime as any) || 'image/png', data: img.bytes.toString('base64') } },
            { type: 'text', text: 'Describe this photo literally as JSON per the schema.' },
          ] }],
        });
        const block = Array.isArray(resp?.content) ? resp.content.find((c: any) => c?.type === 'text') : null;
        r = extractJson(block?.text ?? '');
      } catch { r = {}; }
      out.push({
        sourceRefId: img.sourceRefId,
        verdict: oneOf(r.verdict, VERDICT, 'uncertain'),
        setting: oneOf(r.setting, SETTINGS, 'unknown'),
        subject: oneOf(r.subject, SUBJECTS, 'unknown'),
        objects: Array.isArray(r.objects) ? r.objects.map((x: any) => str(x)).filter(Boolean).slice(0, 6) : [],
        activity: r.activity == null ? null : str(r.activity) || null,
        containsText: Boolean(r.containsText),
        orientation: oneOf(r.orientation, ORIENT, 'portrait'),
        hasClearSubject: Boolean(r.hasClearSubject),
        usability: oneOf(r.usability, USABILITY, 'supporting'),
        focalSubjectBox: box(r.focalSubjectBox),
        faceBoxes: Array.isArray(r.faceBoxes) ? r.faceBoxes.map(box).filter(Boolean) : [],
      });
    }
    return out;
  }
}

// Creative-director recommender. Strategy-conditioned, non-transplantable, ONE angle. NEVER invents claims from
// photos — copy authority stays with the frozen snapshot; this only proposes the communication + media plan.
const OPPORTUNITY_SYSTEM = [
  'You are a creative director. Given a founder\'s OBSERVED photo set (literal media facts) and their Current',
  'Strategy (goal, core bet, audience, positioning, voice), recommend ONE strong carousel angle that is SPECIFIC',
  'to THESE photos AND THIS strategy — an idea the founder may not have thought of. It must NOT read like generic',
  'content marketing: swapping the business or the photos should change the idea. Reason over the SET, not',
  'per-image captions.',
  'CRITICAL: photos are MEDIA, not evidence. Do NOT assert nutrition/health/results/benefits/quantities from an',
  'image (no "high-protein", "500 calories", "healthy", "what I keep me lean"). Any factual claim must come from',
  'the strategy/business material, not the pixels. The carousel copy is written later under a frozen safety',
  'system; here you only choose the communication job + which photos + roles.',
  'Select a SUBSET of the photos (not all). For each selected photo give its sourceRefId, a role',
  '(hero|supporting|detail), and observationRefs (the observationId values that justify it). Exclude the rest with',
  'a short reason. If one more specific photo would materially strengthen the story, add it to missingMaterial.',
  'Return ONLY JSON: {"communicationJob":"...","ctaDirection":"...|null","whyPhotosSupport":"...",',
  '"strategicConnection":"...","nonTransplantabilityTrace":"...","proposedConceptFamily":"...",',
  '"founderLegibleRecommendation":"I found a strong angle: ...","selectedMedia":[{"sourceRefId":"...",',
  '"role":"hero","observationRefs":["..."]}],"excludedMedia":[{"sourceRefId":"...","reason":"..."}],',
  '"missingMaterial":[{"what":"...","whyItHelps":"..."}]}.',
].join('\n');

export class AnthropicOpportunityModel implements IOpportunityModelPort {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) { this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6'; }
  descriptor(): { modelId: string } { return { modelId: this.modelId }; }

  async recommend(input: OpportunityModelInput): Promise<OpportunityDraft> {
    const client = createAnthropicClient(this.apiKey);
    const obsLines = input.photoSet.observations.map((o) => `  [${o.observationId}] source=${o.sourceRefId} ${o.verdict} ${o.setting}/${o.subject} objects=${o.objects.join(',')} usability=${o.usability}${o.containsText ? ' hasText' : ''}`);
    const user = [
      `GOAL: ${input.goal}`, `CORE BET: ${input.coreBet}`, `AUDIENCE: ${input.audience}`, `POSITIONING: ${input.positioning}`,
      `CTA DIRECTION: ${input.ctaDirection ?? '(none authorized)'}`, `BUSINESS: ${input.businessName}`, `LANGUAGE: ${input.language}`,
      `VOICE: ${input.voiceLines.join(' · ') || '(plain, concrete)'}`,
      input.avoid ? `AVOID (already offered / too generic): ${input.avoid}` : '',
      '', `OBSERVED PHOTO SET — ${input.photoSet.setSignal}:`, ...obsLines,
      '', 'Recommend ONE specific angle as JSON.',
    ].filter(Boolean).join('\n');
    let r: any = {};
    try {
      const resp: any = await client.messages.create({ model: this.modelId, max_tokens: 900, temperature: 0.4, system: OPPORTUNITY_SYSTEM, messages: [{ role: 'user', content: user }] });
      const block = Array.isArray(resp?.content) ? resp.content.find((c: any) => c?.type === 'text') : null;
      r = extractJson(block?.text ?? '');
    } catch { r = {}; }
    const selectedMedia: SelectedMediaItem[] = (Array.isArray(r.selectedMedia) ? r.selectedMedia : []).map((m: any): SelectedMediaItem => ({
      sourceRefId: str(m?.sourceRefId), role: oneOf(m?.role, ['hero', 'supporting', 'detail'] as const, 'supporting'),
      observationRefs: Array.isArray(m?.observationRefs) ? m.observationRefs.map((x: any) => str(x)).filter(Boolean) : [],
    })).filter((m: SelectedMediaItem) => m.sourceRefId);
    return {
      communicationJob: str(r.communicationJob), ctaDirection: r.ctaDirection == null ? null : str(r.ctaDirection) || null,
      whyPhotosSupport: str(r.whyPhotosSupport), strategicConnection: str(r.strategicConnection),
      nonTransplantabilityTrace: str(r.nonTransplantabilityTrace), proposedConceptFamily: str(r.proposedConceptFamily) || 'founder_insight',
      founderLegibleRecommendation: str(r.founderLegibleRecommendation),
      selectedMedia, excludedMedia: (Array.isArray(r.excludedMedia) ? r.excludedMedia : []).map((m: any) => ({ sourceRefId: str(m?.sourceRefId), reason: str(m?.reason) })).filter((m: any) => m.sourceRefId),
      missingMaterial: (Array.isArray(r.missingMaterial) ? r.missingMaterial : []).map((m: any) => ({ what: str(m?.what), whyItHelps: str(m?.whyItHelps) })).filter((m: any) => m.what),
    };
  }
}

// (contract hash to pin the observation vocabulary for provenance)
export const PHOTOLED_CONTRACT_HASH = createHash('sha256').update(OBSERVATION_SYSTEM + OPPORTUNITY_SYSTEM, 'utf8').digest('hex').slice(0, 16);
