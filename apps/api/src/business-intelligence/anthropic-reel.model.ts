/* eslint-disable @typescript-eslint/no-explicit-any */
import { createAnthropicClient } from '@bb/infrastructure';
import type {
  IVideoObservationModelPort, IReelOpportunityModelPort, ClipObservation, VideoObservationInput,
  ReelOpportunityInput, ReelOpportunityDraft, SelectedClipRange, SegmentRole, AudioUse,
} from '@bb/application';

const str = (v: unknown): string => String(v ?? '').trim();
const num = (v: unknown, fb = 0): number => { const n = Number(v); return isFinite(n) ? n : fb; };
function extractJson(text: string): any { const a = text.indexOf('{'); const b = text.lastIndexOf('}'); if (a < 0 || b < a) return {}; try { return JSON.parse(text.slice(a, b + 1)); } catch { return {}; } }
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fb: T): T => (allowed.includes(v as T) ? (v as T) : fb);
const box = (v: any): any => { if (!v || typeof v !== 'object') return null; const n = (x: any) => { const f = Number(x); return isFinite(f) ? Math.max(0, Math.min(1, f)) : null; }; const x = n(v.x), y = n(v.y), w = n(v.width ?? v.w), h = n(v.height ?? v.h); return x == null || y == null || w == null || h == null ? null : { x, y, width: w, height: h }; };

const SETTINGS = ['gym', 'kitchen', 'restaurant', 'outdoor', 'studio', 'office', 'retail', 'home', 'event', 'street', 'unknown'] as const;
const SHOTS = ['talking_head', 'b_roll'] as const;
const SCALES = ['wide', 'medium', 'close', 'unknown'] as const;
const MOTION = ['static', 'slow', 'shaky'] as const;
const INTENSITY = ['low', 'medium', 'high'] as const;
const AUDIOKIND = ['speech', 'ambient', 'music', 'silence', 'noisy'] as const;
const VERDICT = ['observed', 'uncertain', 'unusable'] as const;
const ROLES: readonly SegmentRole[] = ['hook', 'build', 'proof', 'detail', 'close'];
const AUDIO: readonly AudioUse[] = ['original', 'muted', 'ducked'];

// LITERAL video observation. No inference, no claim authority. A clip of a meal is a clip of a meal.
const OBSERVATION_SYSTEM = [
  'You are a LITERAL describer of a short phone VIDEO clip, shown as a few sampled frames. Report ONLY what is',
  'visibly present. You have NO authority to infer emotion, satisfaction, health/nutrition value, product',
  'benefit, business result, causality, or intent. If it is not literally visible, it does not exist.',
  'Return ONLY JSON:',
  `  setting: one of ${SETTINGS.join('|')}`,
  '  subject: a short literal subject noun (e.g. "person","prepared_dish","laptop","audience")',
  '  objects: up to 6 literal nouns visible',
  '  activity: short literal activity or null',
  `  shot: ${SHOTS.join('|')} (talking_head = a person addressing camera; else b_roll)`,
  `  shotScale: ${SCALES.join('|')}`,
  `  motion: ${MOTION.join('|')} (camera stability)`,
  `  motionIntensity: ${INTENSITY.join('|')} — the LITERAL visual energy of the clip, judged ONLY from the`,
  '    observable amount and speed of subject motion, camera motion, and how much rapid physical action fills the',
  '    frame. high = fast whole-body action (e.g. battle ropes, sprinting, jumping, boxing); medium = clear but',
  '    moderate movement (e.g. walking, lifting a light weight, chopping); low = little movement (e.g. standing,',
  '    talking to camera, a plated dish). This is PHYSICAL MOTION ONLY. Do NOT read it as emotion, aggression,',
  '    effort, motivation, or audience reaction — those are forbidden inferences.',
  `  audioKind: ${AUDIOKIND.join('|')} (best guess from the scene; audio is confirmed separately)`,
  '  speechPresent: boolean (does someone appear to be speaking to camera?)',
  '  faceBoxes: array of {x,y,width,height} normalized 0-1 for human faces (empty if none)',
  '  focalSubjectBox: {x,y,width,height} normalized 0-1 for the main subject, or null',
  `  verdict: ${VERDICT.join('|')}`,
  'The boxes are LITERAL geometry (WHERE things are), not a design suggestion.',
].join('\n');

export class AnthropicVideoObservationModel implements IVideoObservationModelPort {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) { this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6'; }
  descriptor(): { modelId: string } { return { modelId: this.modelId }; }

  async observe(clips: VideoObservationInput[]): Promise<Omit<ClipObservation, 'observationId' | 'transcriptRef'>[]> {
    const client = createAnthropicClient(this.apiKey);
    const out: Omit<ClipObservation, 'observationId' | 'transcriptRef'>[] = [];
    for (const clip of clips) {
      const p = clip.probe;
      let r: any = {};
      try {
        const content: any[] = clip.frames.map((f) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: f.png.toString('base64') } }));
        content.push({ type: 'text', text: `These are ${clip.frames.length} frames sampled across one ${Math.round(p.durationMs / 100) / 10}s clip (${p.width}x${p.height}). Describe the clip literally as JSON per the schema.` });
        const resp: any = await client.messages.create({ model: this.modelId, max_tokens: 500, temperature: 0, system: OBSERVATION_SYSTEM, messages: [{ role: 'user', content }] });
        const block = Array.isArray(resp?.content) ? resp.content.find((c: any) => c?.type === 'text') : null;
        r = extractJson(block?.text ?? '');
      } catch { r = {}; }
      const orientation = p.width === p.height ? 'square' : (p.width > p.height ? 'landscape' : 'portrait');
      const usable = [{ startMs: Math.round(p.durationMs * 0.05), endMs: Math.round(p.durationMs * 0.95), reason: 'stable central span' }];
      const motion = oneOf(r.motion, MOTION, 'slow');
      out.push({
        sourceRefId: clip.sourceRefId,
        durationMs: p.durationMs, width: p.width, height: p.height, orientation, fps: p.fps, codec: p.codec, container: p.container,
        rotationDegrees: p.rotationDegrees, hasAudio: p.hasAudio, audioCodec: p.audioCodec,
        setting: oneOf(r.setting, SETTINGS, 'unknown'), subject: str(r.subject) || 'unknown',
        objects: Array.isArray(r.objects) ? r.objects.map((x: any) => str(x)).filter(Boolean).slice(0, 6) : [],
        activity: r.activity == null ? null : (str(r.activity) || null),
        shot: oneOf(r.shot, SHOTS, 'b_roll'), shotScale: oneOf(r.shotScale, SCALES, 'unknown'), motion,
        motionIntensity: oneOf(r.motionIntensity, INTENSITY, 'medium'),
        faceBoxes: Array.isArray(r.faceBoxes) ? r.faceBoxes.map(box).filter(Boolean) : [],
        focalSubjectBox: box(r.focalSubjectBox),
        usableSpans: motion === 'shaky' ? [] : usable,
        rejectedSpans: motion === 'shaky' ? [{ startMs: 0, endMs: p.durationMs, reason: 'shaky/unstable' }] : [],
        speechPresent: Boolean(r.speechPresent) && p.hasAudio,
        audioKind: p.hasAudio ? oneOf(r.audioKind, AUDIOKIND, 'ambient') : 'silence',
        verdict: oneOf(r.verdict, VERDICT, 'observed'),
      });
    }
    return out;
  }
}

// Strategy-conditioned creative director. Picks ONE specific angle + EXACT ranges from the observed clips.
const OPPORTUNITY_SYSTEM = [
  'You are a senior short-form video editor + creative director for ONE specific business. You are given the',
  'business STRATEGY and a set of LITERAL clip observations (media facts only — NOT business claims). Find the',
  'ONE strongest reel that THIS strategy would post, using ONLY these clips. Behave like an editor: SELECT a',
  'subset (not every clip), pick EXACT time ranges (ms) inside each clip, order them (hook first), and exclude',
  'weak/duplicate/irrelevant clips with a reason. Do NOT invent a generic "behind the scenes / day in the life"',
  'angle. The angle must be specific to THIS strategy AND these clips, and would NOT fit a different business.',
  'On-screen copy (hookText, ctaText) must express ONLY what the strategy licenses — no health/result/benefit',
  'claims (they are governed separately and will be rejected if unsupported). Keep hookText ≤ 8 words.',
  'EDITORIAL ENERGY: you are given editingEnergy (calm|balanced|energetic) — the treatment THIS strategy needs, and',
  'each clip carries a literal motionIntensity (low|medium|high). The OPENING clip’s visual energy must not',
  'contradict the message. If editingEnergy is "calm", DO NOT open on a high motionIntensity clip merely because it',
  'moves the most: lead with a calmer (low/medium) clip and keep any intense clip for a later supporting beat. If',
  'every usable clip is high-energy, DO NOT fake calm — instead add missingMaterial asking for one calmer 3–5s',
  'shot and open on the least-intense clip you have. If editingEnergy is "energetic", you SHOULD lead with a',
  'high-energy clip. Never let the visuals undercut the concept.',
  'Return ONLY JSON: {',
  '  communicationJob, narrativeArc, strategicConnection, whyFootageSupports, nonTransplantabilityTrace,',
  '  hookText, ctaText (or null), targetDurationMs,',
  '  selectedRanges: [{ sourceRefId, observationRef, inMs, outMs, role:hook|build|proof|detail|close, audioUse:original|muted }],',
  '  excludedClips: [{ sourceRefId, reason }], missingMaterial: [{ what, whyItHelps }], founderLegibleRecommendation }',
].join('\n');

export class AnthropicReelOpportunityModel implements IReelOpportunityModelPort {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) { this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6'; }
  descriptor(): { modelId: string } { return { modelId: this.modelId }; }

  async recommend(input: ReelOpportunityInput): Promise<ReelOpportunityDraft> {
    const client = createAnthropicClient(this.apiKey);
    const clips = input.videoSet.observations.map((o) => ({
      observationRef: o.observationId, sourceRefId: o.sourceRefId, durationMs: o.durationMs, setting: o.setting,
      subject: o.subject, objects: o.objects, activity: o.activity, shot: o.shot, shotScale: o.shotScale, motion: o.motion,
      motionIntensity: o.motionIntensity, speechPresent: o.speechPresent, usableSpans: o.usableSpans, verdict: o.verdict,
    }));
    const user = [
      `BUSINESS: ${input.businessName}`,
      `STRATEGY goal: ${input.goal}`, `STRATEGY core bet: ${input.coreBet}`, `AUDIENCE: ${input.audience}`, `POSITIONING: ${input.positioning}`,
      `CTA direction: ${input.ctaDirection ?? '(none)'}`, `LANGUAGE for on-screen copy: ${input.language}`,
      `EDITING ENERGY (treatment for this strategy): ${input.editingEnergy ?? 'balanced'} — match the OPENING clip’s motionIntensity to it (see rules).`,
      `VOICE samples: ${input.voiceLines.slice(0, 4).join(' | ')}`,
      input.avoid ? `AVOID: ${input.avoid}` : '',
      `CLIP OBSERVATIONS (literal facts): ${JSON.stringify(clips)}`,
      'Return the ONE strongest strategy-specific reel as JSON.',
    ].filter(Boolean).join('\n');
    let r: any = {};
    try {
      const resp: any = await client.messages.create({ model: this.modelId, max_tokens: 2600, temperature: 0.3, system: OPPORTUNITY_SYSTEM, messages: [{ role: 'user', content: user }] });
      const block = Array.isArray(resp?.content) ? resp.content.find((c: any) => c?.type === 'text') : null;
      r = extractJson(block?.text ?? '');
    } catch { r = {}; }
    const selectedRanges: SelectedClipRange[] = Array.isArray(r.selectedRanges) ? r.selectedRanges.map((x: any): SelectedClipRange => ({
      sourceRefId: str(x.sourceRefId), observationRef: str(x.observationRef), inMs: Math.max(0, Math.round(num(x.inMs))), outMs: Math.max(0, Math.round(num(x.outMs))),
      role: oneOf(x.role, ROLES, 'build'), audioUse: oneOf(x.audioUse, AUDIO, 'original'),
    })).filter((x: SelectedClipRange) => x.sourceRefId && x.observationRef && x.outMs > x.inMs) : [];
    return {
      communicationJob: str(r.communicationJob), narrativeArc: str(r.narrativeArc), ctaDirection: r.ctaText ? str(input.ctaDirection ?? '') || null : (input.ctaDirection ?? null),
      whyFootageSupports: str(r.whyFootageSupports), strategicConnection: str(r.strategicConnection), nonTransplantabilityTrace: str(r.nonTransplantabilityTrace),
      selectedRanges, excludedClips: Array.isArray(r.excludedClips) ? r.excludedClips.map((x: any) => ({ sourceRefId: str(x.sourceRefId), reason: str(x.reason) })).filter((x: any) => x.sourceRefId) : [],
      targetDurationMs: Math.max(0, Math.round(num(r.targetDurationMs))), missingMaterial: Array.isArray(r.missingMaterial) ? r.missingMaterial.map((x: any) => ({ what: str(x.what), whyItHelps: str(x.whyItHelps) })).filter((x: any) => x.what) : [],
      founderLegibleRecommendation: str(r.founderLegibleRecommendation), hookText: str(r.hookText), ctaText: r.ctaText == null ? null : (str(r.ctaText) || null),
    };
  }
}
