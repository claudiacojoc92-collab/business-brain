import { generateId } from '@bb/shared';
import type { AuthorizedMessageSpec, SampleContent } from '../voice/contracts';
import { validateAgainstAuthorization, type PropositionJudge } from '../voice/proposition-safety';
import { classifyLayers } from '../voice/proposition-classes';
import { classifyVoiceSample, type VoiceSampleContext } from '../voice/validation';
import { detectRegulatedClaims, isGuardLanguageEnabled } from './medical-guard';
import { specFromLandingSnapshot, landingDraftToSampleContent, landingSectionToSampleContent } from './landing-safety';
import type {
  ILandingModelPort, IMoveDraftRepository, LandingAuthorizationSnapshot, LandingDraft,
  MoveDraft, MoveSafetyDecision,
} from './contracts';

/** Two repairs then fail closed. Each repair is informed (which section, which rule). Rationale: a model that
 *  still writes a medical claim after being told the exact section + rule twice will not fix it on a third try;
 *  the judge is three model calls per gate pass, so cost compounds; and fail-closed is a safe floor, so extra
 *  attempts have low upside. */
const MAX_REPAIRS = 2;

// A landing page is its own SampleChannel. It shares the carousel-like CTA shape (the CTA is a discrete field,
// not embedded in a caption), so the backstop's CTA-survival check treats it exactly as carousel/reel. This
// value flows into every voice-gate call for a web page, so the channel reads 'landing' — not a borrowed label.
const GATE_CHANNEL = 'landing' as const;

type GateLayer = 'medical' | 'kernel' | 'backstop' | 'judge';
interface GateFailure { readonly section: string; readonly layer: string; readonly rule: string }
interface GateResult { readonly failingLayer: GateLayer | null; readonly failures: GateFailure[]; readonly layersRun: GateLayer[] }

export interface MoveDraftDeps {
  readonly model: ILandingModelPort;
  readonly judge?: PropositionJudge;          // Layer-3; omitted ⇒ deterministic-only (kernel + backstop)
  readonly repo: IMoveDraftRepository;
  readonly log?: (e: { type: string; actionId: string; disposition: string; failingLayer: string | null; repairAttempts: number }) => void;
  readonly clock?: () => string;
  readonly idgen?: () => string;
}

export interface ProduceLandingArgs {
  readonly businessId: string;
  readonly actionId: string;
  readonly planVersionId: string;
  readonly snapshot: LandingAuthorizationSnapshot;
  readonly communicationJob: string;
  readonly voiceLines: string[];
  readonly language: string;
}

export class MoveDraftService {
  constructor(private readonly deps: MoveDraftDeps) {}

  private clock(): string { return (this.deps.clock ?? (() => new Date().toISOString()))(); }
  private id(): string { return (this.deps.idgen ?? generateId)(); }

  /** The factual authority blob the deterministic backstop checks numbers/claims against (licensed material only). */
  private factual(s: LandingAuthorizationSnapshot): string {
    return [...s.licensedPropositions.map((p) => p.text), ...s.proofFacts].join('. ');
  }

  private ctx(language: string, voiceLines: string[], factual: string): VoiceSampleContext {
    return { language, ctaRequired: true, negativeSpace: [], boundaryTerms: [], claimBoundaryTerms: [], acceptedExamples: voiceLines, factualFacts: factual };
  }

  private sectionList(draft: LandingDraft): { role: string; text: string; sc: SampleContent }[] {
    const out = draft.sections.map((s) => ({ role: s.role, text: [s.heading, s.body].filter(Boolean).join('. '), sc: landingSectionToSampleContent(s, draft.cta) }));
    out.push({ role: 'cta', text: draft.cta, sc: { cta: draft.cta } });
    return out;
  }

  /**
   * The cheap deterministic tiers in fail-fast order: medical guard (regex) FIRST, then the proposition kernel
   * (deterministic Layer 1/2) + the backstop. All synchronous, no model. The first failing tier is the reason.
   * (The Layer-3 judge runs afterwards in runGate, only if this returns clean.)
   */
  private gateDeterministic(draft: LandingDraft, spec: AuthorizedMessageSpec, language: 'ro' | 'en', ctx: VoiceSampleContext): GateResult {
    const layersRun: GateLayer[] = ['medical'];
    const sections = this.sectionList(draft);

    // Tier 1 — MEDICAL (regex, cheapest). Fail fast: do not run the kernel/judge on copy the guard rejects.
    const med = sections.flatMap((s) =>
      detectRegulatedClaims(s.text, language).map((f): GateFailure => ({ section: s.role, layer: 'medical', rule: `class${f.blockedClass}: ${f.reason}` })),
    );
    if (med.length) return { failingLayer: 'medical', failures: med, layersRun };

    // Tier 2 — proposition kernel (deterministic Layer 1/2, synchronous via classifyLayers) + backstop.
    layersRun.push('kernel', 'backstop');
    const t2: GateFailure[] = [];
    for (const s of sections) {
      for (const v of classifyLayers(s.sc, spec).layer1Violations) {
        t2.push({ section: s.role, layer: 'kernel', rule: `${v.propositionClass}: "${v.clause}"` });
      }
      for (const f of classifyVoiceSample(s.sc, GATE_CHANNEL, ctx).failures) {
        if (f.gate !== 'cta_missing') t2.push({ section: s.role, layer: 'backstop', rule: `${f.gate}: ${f.detail}` });
      }
    }
    for (const f of classifyVoiceSample(landingDraftToSampleContent(draft), GATE_CHANNEL, ctx).failures) {
      if (f.gate !== 'cta_missing') t2.push({ section: 'page', layer: 'backstop', rule: `${f.gate}: ${f.detail}` });
    }
    if (t2.length) return { failingLayer: t2.some((f) => f.layer === 'kernel') ? 'kernel' : 'backstop', failures: t2, layersRun };

    return { failingLayer: null, failures: [], layersRun };
  }

  /** Deterministic tiers, then the Layer-3 judge (3 model calls) ONLY if the cheap tiers passed. */
  private async runGate(draft: LandingDraft, spec: AuthorizedMessageSpec, language: 'ro' | 'en', ctx: VoiceSampleContext): Promise<GateResult> {
    const det = this.gateDeterministic(draft, spec, language, ctx);
    if (det.failingLayer !== null || !this.deps.judge) return det;
    const judged = await validateAgainstAuthorization(landingDraftToSampleContent(draft), GATE_CHANNEL, spec, this.deps.judge, 3);
    const layersRun: GateLayer[] = [...det.layersRun, 'judge'];
    if (judged.reasons.length) return { failingLayer: 'judge', failures: judged.reasons.map((r): GateFailure => ({ section: 'page', layer: 'judge', rule: r })), layersRun };
    return { failingLayer: null, failures: [], layersRun };
  }

  async produceLanding(args: ProduceLandingArgs): Promise<MoveDraft> {
    const base = { moveDraftId: this.id(), businessId: args.businessId, actionId: args.actionId, planVersionId: args.planVersionId, kind: 'landing' as const, language: args.language, snapshot: args.snapshot, version: 1, producedAt: this.clock() };

    // The generator must NEVER emit a language the guard can't vouch for: fail closed before generating.
    if (!isGuardLanguageEnabled(args.language)) {
      return this.persistBlocked(base, { layersRun: ['medical'], failingLayer: 'medical', failures: [{ section: 'page', layer: 'medical', rule: `language "${args.language}" is not guard-enabled` }], repairAttempts: 0, disposition: 'blocked' });
    }
    const language = args.language as 'ro' | 'en';
    const spec = specFromLandingSnapshot(args.snapshot, args.communicationJob);
    const ctx = this.ctx(language, args.voiceLines, this.factual(args.snapshot));

    let draft = await this.deps.model.draft({ snapshot: args.snapshot, communicationJob: args.communicationJob, voiceLines: args.voiceLines, language });
    let result = await this.runGate(draft, spec, language, ctx);
    let attempts = 0;
    while (result.failingLayer !== null && attempts < MAX_REPAIRS) {
      attempts++;
      draft = await this.deps.model.repair({ snapshot: args.snapshot, communicationJob: args.communicationJob, voiceLines: args.voiceLines, language, previous: draft, failures: result.failures.map((f) => ({ section: f.section, rule: `${f.layer} — ${f.rule}` })) });
      result = await this.runGate(draft, spec, language, ctx);
    }

    const passed = result.failingLayer === null;
    const safety: MoveSafetyDecision = { layersRun: result.layersRun, failingLayer: result.failingLayer, failures: result.failures, repairAttempts: attempts, disposition: passed ? 'drafted' : 'blocked' };
    if (!passed) return this.persistBlocked(base, safety);
    const md: MoveDraft = { ...base, draft, safetyDecision: safety, status: 'drafted' };
    await this.deps.repo.save(md);
    this.deps.log?.({ type: 'move_draft', actionId: args.actionId, disposition: 'drafted', failingLayer: null, repairAttempts: attempts });
    return md;
  }

  private async persistBlocked(base: Omit<MoveDraft, 'draft' | 'safetyDecision' | 'status'>, safety: MoveSafetyDecision): Promise<MoveDraft> {
    // Fail-closed: the founder will see the plain instruction, but the BLOCKED outcome + failing layer are stored
    // (not just logged) so the drafted/blocked ratio is queryable — a guard that always fails must be detectable.
    const md: MoveDraft = { ...base, draft: null, safetyDecision: safety, status: 'blocked' };
    await this.deps.repo.save(md);
    this.deps.log?.({ type: 'move_draft', actionId: base.actionId, disposition: 'blocked', failingLayer: safety.failingLayer, repairAttempts: safety.repairAttempts });
    return md;
  }
}
