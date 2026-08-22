/**
 * Slice 6 — Carousel service. CreateHandoff → governed asset-level copy → structured slides → deterministic
 * render → structural + claim gates → bounded repair / fail-closed → immutable AssetVersion → scoped,
 * non-destructive revision → export (PNG slides + ZIP). Governance reuses the frozen Voice proposition system;
 * this service adds NO new claim authority. Channel/format is resolved explicitly; unsupported → unavailable.
 */
import { createHash } from 'node:crypto';
import { generateId, ValidationError } from '@bb/shared';
import type { CreateHandoff } from '../plan/contracts';
import type { PropositionJudge } from '../voice/proposition-safety';
import type {
  ICarouselRepository, ICarouselModelPort, IRenderPort, IBlobStore, CarouselContextView,
  CarouselBrief, CarouselAssetVersion, CarouselAsset, AssetAuthorizationSnapshot, RenderVersion, RevisionScope,
  Slide, CanvasSpec, RenderedSlide, GateFinding, GateReport, Concept, VisualSystem, CarouselSafetyTrace, CarouselSafetyTraceCore, CarouselSafetyDisposition,
  CarouselSourceRef, ReuseRight, SourceType, CarouselCopyDraft, GenerationMode, TextBlock, RepairTarget, RepairedBlock, TargetedRepairTrace, BrandContext,
} from './contracts';
import { validateCarouselCopy } from './carousel-quality';
import { validateCarouselClaimSafety } from './carousel-safety';
import { validateClosure } from './closure';
import { checkFeasibility, bindBeats, assessConcept, assessClosureFeasibility } from './feasibility';
import { validateExtractiveBindings, validateScopePreservation } from './extractive';
import { structuralVisualGates } from './visual-gates';
import { composeSlides, reviseSlideCopy, attachHookMedia } from './compose';
import { visualSystemFor, planLayouts, alternateVisualSystem } from './visual-system';

/** The proposition-preservation judge (Layer 3), shared with Voice, plus its resolved identity. */
export interface CarouselJudgePort {
  check?: PropositionJudge;
  contract?: () => { modelId: string; promptHash: string };
}

const MAX_CAROUSEL_ATTEMPTS = 5;
const CANVAS: CanvasSpec = { width: 1080, height: 1350, margin: 96, minFontPx: 28 };
const SUPPORTED_FORMAT = 'image_carousel';

/** Everything the gate/persist/repair helpers need for one generation (assembled once in generate()). */
interface GenerateShared { assetId: string; businessId: string; createHandoffId: string; brief: CarouselBrief; snapshot: AssetAuthorizationSnapshot; concept: Concept; ctx: CarouselContextView; system: VisualSystem }
/** A gated (not-yet-persisted) candidate — enough to persist as-is or to plan a targeted repair. */
interface GateOutcome { version: CarouselAssetVersion; rendered: RenderedSlide[]; visReport: GateReport; copyReport: GateReport; safetyCore: CarouselSafetyTraceCore; antiTemplateFail: string | null; blockingFindings: GateFinding[]; clean: boolean }
const shaShort = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 16);
const normText = (t: string): string => t.toLowerCase().replace(/\s+/g, ' ').trim();

export interface CarouselDeps {
  readonly repo: ICarouselRepository;
  readonly model: ICarouselModelPort;
  readonly render: IRenderPort;
  readonly blob: IBlobStore;
  /** Frozen Layer-3 proposition-preservation judge (shared with Voice). Absent ⇒ deterministic-only safety. */
  readonly judge?: CarouselJudgePort;
  readonly handoff: (businessId: string, createHandoffId: string) => Promise<CreateHandoff | null>;
  readonly context: (businessId: string) => Promise<CarouselContextView | null>;
  readonly businessName: (businessId: string) => Promise<string>;
  readonly clock?: () => string;
  readonly log?: (e: { type: string; detail?: string }) => void;
}

const combineReports = (a: GateReport, b: GateReport): GateReport => ({ valid: a.valid && b.valid, findings: [...a.findings, ...b.findings] });

export type GenerateResult =
  | { status: 'created'; asset: CarouselAsset; version: CarouselAssetVersion; render: RenderVersion }
  | { status: 'unavailable_format'; requested: string }
  | { status: 'no_strategy' }
  | { status: 'insufficient' };

const findingsToReasons = (fs: GateFinding[]): string[] => fs.map((f) => `${f.code}${f.slideId ? '@' + f.slideId.slice(-4) : ''}: ${f.detail}`);

export class CarouselService {
  constructor(private readonly deps: CarouselDeps) {}
  private now(): string { return this.deps.clock ? this.deps.clock() : new Date(2026, 0, 1).toISOString(); }

  /** Channel/format resolution: only the image carousel is supported this slice. Unspecified is allowed. */
  private resolveFormat(handoff: CreateHandoff): { ok: true } | { ok: false; requested: string } {
    const req = (handoff.requestedAssetFormat ?? '').toLowerCase().trim();
    if (!req || req === SUPPORTED_FORMAT || /carousel/.test(req)) return { ok: true };
    return { ok: false, requested: handoff.requestedAssetFormat ?? '' };
  }

  private buildBrief(handoff: CreateHandoff, ctx: CarouselContextView): CarouselBrief {
    return {
      createHandoffId: handoff.createHandoffId, planVersionId: handoff.planVersionId, strategyVersionId: ctx.strategyVersionId,
      founderGoalTrace: handoff.founderGoalTrace, strategicBetTrace: handoff.strategicBetTrace,
      communicationJob: handoff.communicationJob ?? handoff.executionObjective, audienceUseContext: handoff.authorizedAudienceUseContext,
      ctaDirection: handoff.ctaDirection ?? ctx.ctaDirection, channel: handoff.channel, requestedAssetFormat: SUPPORTED_FORMAT, language: ctx.language || 'en',
    };
  }

  private buildSnapshot(businessId: string, handoff: CreateHandoff, ctx: CarouselContextView, brief: CarouselBrief): AssetAuthorizationSnapshot {
    const d = this.deps.model.descriptor?.();
    const judge = this.deps.judge?.contract?.();
    return {
      snapshotId: generateId(), businessId, createHandoffId: handoff.createHandoffId, strategyVersionId: ctx.strategyVersionId,
      language: brief.language, speakingRole: ctx.speakingRole, audienceUseContext: brief.audienceUseContext,
      licensedPropositions: ctx.licensedPropositions, proofFacts: ctx.proofFacts, ctaFunction: brief.ctaDirection,
      ownedStances: ctx.ownedStances ?? [], sourceRefs: ctx.sourceRefs,
      modelId: d?.modelId ?? judge?.modelId ?? null, safetyContractHash: judge?.promptHash ?? d?.copyContractHash ?? null, producedAt: this.now(),
    };
  }

  /** Run the frozen-kernel claim safety (block + full-asset) for a composed carousel. */
  private async claimSafety(slides: Slide[], snapshot: AssetAuthorizationSnapshot, communicationJob: string): Promise<{ report: GateReport; core: CarouselSafetyTraceCore }> {
    const { findings, trace } = await validateCarouselClaimSafety(slides, snapshot, communicationJob, this.deps.judge?.check, this.deps.judge?.contract?.() ?? null);
    return { report: { valid: findings.length === 0, findings }, core: trace };
  }

  private async persistTrace(businessId: string, assetId: string, versionId: string | null, attempt: number, core: CarouselSafetyTraceCore, repairReasons: string[], disposition: CarouselSafetyDisposition, generationMode: GenerationMode = 'normal', fallbackBindingsHash: string | null = null, targetedRepair: TargetedRepairTrace | null = null): Promise<void> {
    const trace: CarouselSafetyTrace = { ...core, traceId: generateId(), businessId, assetId, versionId, attempt, repairReasons, disposition, generationMode, fallbackBindingsHash, targetedRepair, producedAt: this.now() };
    try { await this.deps.repo.saveSafetyTrace(trace); } catch (e) { this.deps.log?.({ type: 'carousel_trace_persist_failed', detail: String(e) }); }
  }

  private composeVersion(assetId: string, businessId: string, versionNumber: number, brief: CarouselBrief, concept: Concept, slides: Slide[], ctx: CarouselContextView, snapshotId: string, visualSystem: VisualSystem): CarouselAssetVersion {
    const versionId = generateId();
    const base = {
      versionId, assetId, versionNumber, businessId, brief, concept, slides, visualSystem,
      brandContextVersion: ctx.brand.brandContextVersion, languageContext: brief.language,
      authorizationSnapshotId: snapshotId, sourceManifest: ctx.sourceRefs, producedAt: this.now(),
    };
    return { ...base, contentHash: createHash('sha256').update(JSON.stringify(base), 'utf8').digest('hex') };
  }

  private async renderAndGate(version: CarouselAssetVersion, advisories: GateFinding[] = []): Promise<{ rendered: RenderedSlide[]; report: ReturnType<typeof structuralVisualGates> }> {
    const media = await this.loadMedia(version);
    const rendered = await this.deps.render.render({ canvasSpec: CANVAS, visualSystem: version.visualSystem, slides: version.slides, media });
    const report = structuralVisualGates(rendered, version.slides, CANVAS);
    // HARD structural gates decide validity; visual RHYTHM advisories are attached for review, never blocking.
    return { rendered, report: { valid: report.valid, findings: [...report.findings, ...advisories] } };
  }

  /** Load bytes for every image slot from the blob store. Only media-eligible sources have a slot (compose),
   * so reference_only material can never reach the renderer here. */
  private async loadMedia(version: CarouselAssetVersion): Promise<Record<string, Buffer>> {
    const wanted = new Set<string>();
    for (const s of version.slides) for (const m of s.mediaSlots) if (m.kind === 'image' && m.sourceRefId) wanted.add(m.sourceRefId);
    if (!wanted.size) return {};
    const media: Record<string, Buffer> = {};
    for (const rid of wanted) {
      const src = version.sourceManifest.find((x) => x.sourceRefId === rid);
      if (!src?.mediaRef) continue;
      const bytes = await this.deps.blob.get(src.mediaRef);
      if (bytes) media[rid] = bytes;
    }
    return media;
  }

  private async persistRender(version: CarouselAssetVersion, rendered: RenderedSlide[], report: ReturnType<typeof structuralVisualGates>): Promise<RenderVersion> {
    const slideImages = [];
    for (const r of rendered) {
      const key = `carousel/${version.businessId}/${version.versionId}/slide-${String(r.order + 1).padStart(2, '0')}.png`;
      await this.deps.blob.put(key, r.png);
      slideImages.push({ slideId: r.slideId, order: r.order, blobKey: key, widthPx: r.widthPx, heightPx: r.heightPx });
    }
    const rv: RenderVersion = { renderId: generateId(), versionId: version.versionId, rendererVersion: this.deps.render.rendererVersion(), canvasSpec: CANVAS, slideImages, exportZipKey: null, gateReport: { valid: report.valid, findings: report.findings }, producedAt: this.now() };
    await this.deps.repo.saveRender(rv);
    return rv;
  }

  /**
   * BRAND ADAPTATION (§6–§9) — re-render an already-governed communication under a DIFFERENT BrandContext with
   * NO copy generation. The immutable copy (slides / text blocks / meaning bindings / concept / authorization
   * snapshot / Voice provenance) is reused verbatim from the source version; only the VisualSystem (brand tokens
   * over the FROZEN canonical geometry) and the render change. Re-runs ONLY the deterministic STRUCTURAL render
   * gates (contrast / overflow / glyph fit / crop) because colours/fonts/media can affect fit — never the
   * proposition-safety kernel: claim authorization stays tied to the source's immutable snapshot. No LLM call.
   */
  async renderUnderBrand(businessId: string, versionId: string, brand: BrandContext): Promise<{ status: 'rendered'; version: CarouselAssetVersion; render: RenderVersion; gatesValid: boolean } | { status: 'not_found' }> {
    const source = await this.deps.repo.getVersion(businessId, versionId);
    if (!source) return { status: 'not_found' };
    const system: VisualSystem = { ...visualSystemFor(brand), footer: source.visualSystem.footer };
    const rebrandCtx = { brand, sourceRefs: source.sourceManifest } as unknown as CarouselContextView;
    const version = this.composeVersion(source.assetId, businessId, source.versionNumber, source.brief, source.concept, source.slides, rebrandCtx, source.authorizationSnapshotId, system);
    const { rendered, report } = await this.renderAndGate(version); // structural visual gates ONLY — no claim safety
    await this.deps.repo.saveVersion(version);
    const rv = await this.persistRender(version, rendered, report);
    return { status: 'rendered', version, render: rv, gatesValid: report.valid };
  }

  /** Generate the first carousel from an eligible CreateHandoff. */
  async generate(businessId: string, createHandoffId: string): Promise<GenerateResult> {
    const handoff = await this.deps.handoff(businessId, createHandoffId);
    if (!handoff) throw new ValidationError('CREATE_HANDOFF_NOT_FOUND', 'No such create handoff.');
    const fmt = this.resolveFormat(handoff);
    if (!fmt.ok) return { status: 'unavailable_format', requested: fmt.requested };
    const ctx = await this.deps.context(businessId);
    if (!ctx) return { status: 'no_strategy' };

    const brief = this.buildBrief(handoff, ctx);
    const snapshot = this.buildSnapshot(businessId, handoff, ctx, brief);
    await this.deps.repo.saveAuthorizationSnapshot(snapshot);

    let concept: Concept;
    try { concept = await this.deps.model.chooseConcept({ brief, snapshot }); }
    catch { this.deps.log?.({ type: 'carousel_concept_threw' }); return { status: 'insufficient' }; }
    if (concept.slideOutline.length < 3 || concept.slideOutline.length > 8) return { status: 'insufficient' };
    // CONCEPT ↔ MATERIAL FEASIBILITY (§1) — a concept may not out-promise the authorized meaning. A decomposition
    // family with no material to decompose is DOWNGRADED to the smallest supported family (no invented causes),
    // so no later stage (or the anti-template judge) is told to expect a breakdown that cannot be grounded.
    const assessed = assessConcept(concept, snapshot);
    if (assessed.downgraded) this.deps.log?.({ type: 'carousel_concept_downgraded', detail: assessed.reason ?? '' });
    concept = assessed.concept;
    // MATERIAL FEASIBILITY — bind each beat to authorized meaning; contract the outline to grounded beats or
    // reject BEFORE any copy generation (no manufacturing a carousel from thin material).
    const feas = checkFeasibility(concept.slideOutline, snapshot);
    if (!feas.feasible) { this.deps.log?.({ type: 'carousel_infeasible', detail: feas.reasons.slice(0, 3).join(' | ') }); return { status: 'insufficient' }; }
    concept = { ...concept, slideOutline: feas.outline };
    // CLOSURE FEASIBILITY (pre-draft) — can the planned body causally EARN the authorized CTA? INFEASIBLE ⇒ fail
    // early (no 5 stochastic drafts, no invented bridge, CTA never softened). CONTRACT ⇒ add the smallest bridge
    // beat so the body develops the CTA action before the CTA. This is where a non-proof job that cannot close is
    // caught upstream, instead of exhausting attempts + a doomed CTA-only repair.
    const clo = assessClosureFeasibility(concept.slideOutline, snapshot);
    if (clo.status === 'infeasible') { this.deps.log?.({ type: 'carousel_closure_infeasible', detail: clo.reason }); return { status: 'insufficient' }; }
    if (clo.status === 'contract') { this.deps.log?.({ type: 'carousel_closure_contracted', detail: clo.reason }); concept = { ...concept, slideOutline: clo.outline }; }
    const businessName = await this.deps.businessName(businessId).catch(() => null);
    const system: VisualSystem = { ...visualSystemFor(ctx.brand), footer: businessName };

    const assetId = generateId();
    const shared = { assetId, businessId, createHandoffId, brief, snapshot, concept, ctx, system };

    // PRIMARY PATH — the richer governed draft→safety→repair loop (bounded attempts). This is the default;
    // the constrained fallback below is NOT reached unless every normal attempt fail-closes.
    let priorDraft: CarouselCopyDraft | undefined; let repairReasons: string[] = [];
    let lastCore: CarouselSafetyTraceCore | null = null;
    for (let attempt = 0; attempt < MAX_CAROUSEL_ATTEMPTS; attempt++) {
      let draft: CarouselCopyDraft;
      try { draft = await this.deps.model.draftCopy({ brief, snapshot, voiceLines: ctx.voiceLines, concept, ...(priorDraft ? { priorDraft } : {}), ...(repairReasons.length ? { repairReasons } : {}) }); }
      catch { this.deps.log?.({ type: 'carousel_draft_threw', detail: `attempt ${attempt}` }); continue; }
      const ev = await this.evaluateDraft(draft, shared, attempt, repairReasons, 'normal', null);
      if (ev.ok) { this.deps.log?.({ type: attempt === 0 ? 'carousel_first_pass_ok' : 'carousel_repaired_ok' }); return ev.result; }
      lastCore = ev.core ?? lastCore;
      repairReasons = ev.repairReasons;
      this.deps.log?.({ type: 'carousel_quality_failed', detail: repairReasons.slice(0, 4).join(' | ') });
      priorDraft = draft;
    }

    // CONSTRAINED REALIZATION FALLBACK — reached ONLY because normal drafting kept introducing unlicensed
    // meaning. Realize the already-bound meaning faithfully. If the constrained candidate fails a LOCAL gate,
    // ONE bounded, block-scoped TARGETED REPAIR (§2–§8) may fix only the failing block(s) — everything else stays
    // byte-identical — then re-gate ONCE. Clean ⇒ persist; otherwise fail closed. Not founder-visible.
    if (this.deps.model.realizeConstrained) {
      const beats = bindBeats(concept.slideOutline, snapshot);
      const fallbackBindingsHash = createHash('sha256').update(JSON.stringify(beats), 'utf8').digest('hex');
      this.deps.log?.({ type: 'carousel_constrained_fallback', detail: `${beats.length} beats` });
      let constrainedCore = lastCore;
      try {
        const draft = await this.deps.model.realizeConstrained({ brief, snapshot, voiceLines: ctx.voiceLines, concept, beats, ctaFunction: snapshot.ctaFunction });
        const { slides, advisories } = this.composeAndPlan(draft, shared);
        const outcome0 = await this.gateSlides(shared, slides, advisories, 'constrained_fallback');
        constrainedCore = outcome0.safetyCore;
        if (outcome0.clean) { this.deps.log?.({ type: 'carousel_constrained_ok' }); return await this.persistCreated(shared, outcome0, 'constrained_fallback', MAX_CAROUSEL_ATTEMPTS, repairReasons, fallbackBindingsHash, null); }

        // ── one bounded targeted repair of the local failure(s) ──
        if (this.deps.model.repairConstrained) {
          const plan = await this.planTargetedRepair(shared, slides, outcome0);
          if (plan.repairable && plan.targets.length === 0) {
            // the only "failure" was anti-template class-B (simple, faithful — not a defect); accept as-is
            this.deps.log?.({ type: 'carousel_targeted_repair', detail: 'anti_template_B_not_a_defect' });
            return await this.persistCreated(shared, outcome0, 'constrained_fallback', MAX_CAROUSEL_ATTEMPTS, repairReasons, fallbackBindingsHash, { triggered: true, repairs: [], result: 'persisted' });
          }
          if (plan.repairable) {
            this.deps.log?.({ type: 'carousel_targeted_repair', detail: plan.targets.map((t) => `${t.gateClass}@${t.blockId}`).join(',') });
            const repaired = await this.deps.model.repairConstrained({ targets: plan.targets, snapshot, concept, brief, voiceLines: ctx.voiceLines, ctaFunction: snapshot.ctaFunction }).catch(() => [] as RepairedBlock[]);
            const slides1 = this.applyRepairs(slides, repaired);
            const repairs = plan.targets.map((t) => {
              const before = slides.find((s) => s.slideId === t.slideId)?.textBlocks.find((b) => b.blockId === t.blockId)?.text ?? '';
              const after = slides1.find((s) => s.slideId === t.slideId)?.textBlocks.find((b) => b.blockId === t.blockId)?.text ?? '';
              return { gateClass: t.gateClass, slideId: t.slideId, blockId: t.blockId, beforeHash: shaShort(before), afterHash: shaShort(after), meaningUnitRefs: t.meaningUnitRefs };
            });
            const outcome1 = await this.gateSlides(shared, slides1, advisories, 'constrained_fallback');
            constrainedCore = outcome1.safetyCore;
            if (outcome1.clean) { this.deps.log?.({ type: 'carousel_targeted_repair_ok' }); return await this.persistCreated(shared, outcome1, 'constrained_fallback', MAX_CAROUSEL_ATTEMPTS, repairReasons, fallbackBindingsHash, { triggered: true, repairs, result: 'persisted' }); }
            this.deps.log?.({ type: 'carousel_targeted_repair_failed', detail: outcome1.blockingFindings.slice(0, 3).map((f) => f.code).join(',') });
            await this.persistTrace(businessId, assetId, null, MAX_CAROUSEL_ATTEMPTS, constrainedCore, [...repairReasons, ...findingsToReasons(outcome1.blockingFindings)], 'fail_closed', 'constrained_fallback', fallbackBindingsHash, { triggered: true, repairs, result: 'fail_closed' });
            this.deps.log?.({ type: 'carousel_fail_closed' });
            return { status: 'insufficient' };
          }
          // failure is not a LOCAL, block-scoped one (structural / binding / scope / full-asset / unsupported concept) — honest fail closed, no prose repair
          await this.persistTrace(businessId, assetId, null, MAX_CAROUSEL_ATTEMPTS, outcome0.safetyCore, [...repairReasons, ...findingsToReasons(outcome0.blockingFindings)], 'fail_closed', 'constrained_fallback', fallbackBindingsHash, { triggered: false, repairs: [], result: 'not_repairable' });
          this.deps.log?.({ type: 'carousel_fail_closed', detail: 'not_repairable' });
          return { status: 'insufficient' };
        }

        await this.persistTrace(businessId, assetId, null, MAX_CAROUSEL_ATTEMPTS, outcome0.safetyCore, repairReasons, 'fail_closed', 'constrained_fallback', fallbackBindingsHash, null);
        this.deps.log?.({ type: 'carousel_fail_closed' });
        return { status: 'insufficient' };
      } catch { this.deps.log?.({ type: 'carousel_constrained_threw' }); }
      if (constrainedCore) await this.persistTrace(businessId, assetId, null, MAX_CAROUSEL_ATTEMPTS, constrainedCore, repairReasons, 'fail_closed', 'constrained_fallback', fallbackBindingsHash, null);
      this.deps.log?.({ type: 'carousel_fail_closed' });
      return { status: 'insufficient' };
    }

    // FAIL CLOSED — no unsafe/unrenderable carousel reaches preview persistence. Record the governing trace.
    if (lastCore) await this.persistTrace(businessId, assetId, null, MAX_CAROUSEL_ATTEMPTS - 1, lastCore, repairReasons, 'fail_closed');
    this.deps.log?.({ type: 'carousel_fail_closed' });
    return { status: 'insufficient' };
  }

  /** attachHookMedia + composeSlides + planLayouts (compose ONCE; targeted repair edits these slides in place). */
  private composeAndPlan(draft: CarouselCopyDraft, shared: GenerateShared): { slides: Slide[]; advisories: GateFinding[] } {
    const composed = attachHookMedia(composeSlides(draft, shared.concept, shared.snapshot), shared.snapshot);
    const planned = planLayouts(composed, shared.concept, shared.system);
    return { slides: planned.slides, advisories: planned.advisories };
  }

  /** Run the full gate stack on a composed slide set WITHOUT persisting (so a candidate can be repaired first). */
  private async gateSlides(shared: GenerateShared, slides: Slide[], advisories: GateFinding[], generationMode: GenerationMode): Promise<GateOutcome> {
    const { assetId, businessId, brief, snapshot, concept, ctx, system } = shared;
    const version = this.composeVersion(assetId, businessId, 1, brief, concept, slides, ctx, snapshot.snapshotId, system);
    const structuralReport = validateCarouselCopy({ slides, snapshot, brief, conceptOutlineLength: concept.slideOutline.length });
    const extractiveFindings = generationMode === 'constrained_fallback'
      ? [...validateExtractiveBindings(slides, snapshot, concept.slideOutline), ...validateScopePreservation(slides, snapshot, bindBeats(concept.slideOutline, snapshot))]
      : [];
    const safety = await this.claimSafety(slides, snapshot, brief.communicationJob);
    const closureFindings = await validateClosure(slides, snapshot, this.deps.model.reviewClosure?.bind(this.deps.model));
    const copyReport = combineReports(combineReports(combineReports(structuralReport, safety.report), { valid: closureFindings.length === 0, findings: closureFindings }), { valid: extractiveFindings.length === 0, findings: extractiveFindings });
    const { rendered, report: visReport } = await this.renderAndGate(version, advisories);
    let antiTemplateFail: string | null = null;
    if (copyReport.valid && visReport.valid && this.deps.model.reviewAntiTemplate) {
      try { const v = await this.deps.model.reviewAntiTemplate({ assetView: this.assetView(version), brief, mode: generationMode }); if (v.generic) antiTemplateFail = `anti_template: ${v.reason}`; } catch { /* judge unavailable */ }
    }
    const blockingFindings = [...copyReport.findings, ...visReport.findings.filter((f) => f.severity !== 'advisory')];
    return { version, rendered, visReport, copyReport, safetyCore: safety.core, antiTemplateFail, blockingFindings, clean: copyReport.valid && visReport.valid && !antiTemplateFail };
  }

  /** Persist a clean gated candidate (version + render + immutable trace). */
  private async persistCreated(shared: GenerateShared, outcome: GateOutcome, generationMode: GenerationMode, attempt: number, priorRepairReasons: string[], fallbackBindingsHash: string | null, targetedRepair: TargetedRepairTrace | null): Promise<GenerateResult> {
    const { assetId, businessId, createHandoffId, brief } = shared;
    const asset: CarouselAsset = { assetId, businessId, createHandoffId, planVersionId: brief.planVersionId, strategyVersionId: brief.strategyVersionId, currentVersionId: outcome.version.versionId, createdAt: this.now() };
    await this.deps.repo.saveVersion(outcome.version);
    await this.deps.repo.saveAsset(asset);
    const rv = await this.persistRender(outcome.version, outcome.rendered, outcome.visReport);
    const disposition: CarouselSafetyDisposition = generationMode === 'constrained_fallback' || attempt > 0 ? 'repaired_persisted' : 'persisted';
    await this.persistTrace(businessId, assetId, outcome.version.versionId, attempt, outcome.safetyCore, priorRepairReasons, disposition, generationMode, fallbackBindingsHash, targetedRepair);
    return { status: 'created', asset, version: outcome.version, render: rv };
  }

  /** Compose → gate → persist a single draft (normal loop + first constrained pass share this path). */
  private async evaluateDraft(
    draft: CarouselCopyDraft, shared: GenerateShared,
    attempt: number, priorRepairReasons: string[], generationMode: GenerationMode, fallbackBindingsHash: string | null,
  ): Promise<{ ok: true; result: GenerateResult } | { ok: false; repairReasons: string[]; core: CarouselSafetyTraceCore | null }> {
    const { slides, advisories } = this.composeAndPlan(draft, shared);
    const outcome = await this.gateSlides(shared, slides, advisories, generationMode);
    if (outcome.clean) return { ok: true, result: await this.persistCreated(shared, outcome, generationMode, attempt, priorRepairReasons, fallbackBindingsHash, null) };
    const repairReasons = [...findingsToReasons(outcome.copyReport.findings), ...findingsToReasons(outcome.visReport.findings.filter((f) => f.severity !== 'advisory')), ...(outcome.antiTemplateFail ? [outcome.antiTemplateFail] : [])];
    return { ok: false, repairReasons, core: outcome.safetyCore };
  }

  /** Meaning-unit refs a block is bound to (the immutable bindings a repair MUST preserve). */
  private meaningRefsOf(block: TextBlock): string[] {
    return [...(block.authorizedFrom.propositionRef ? [block.authorizedFrom.propositionRef] : []), ...(block.authorizedFrom.sourceRefId ? [block.authorizedFrom.sourceRefId] : []), ...(block.authorizedFrom.ctaFunction ? ['CTA'] : [])];
  }

  /**
   * §2–§8 — locate the block-scoped targets of the constrained candidate's LOCAL failures. Repairable ONLY when
   * EVERY blocking failure maps to a safety / overflow / closure / anti-template-filler block target (a locked
   * block, a full-asset implication, an unsupported concept, or any structural/binding/scope failure ⇒ not
   * locally repairable ⇒ honest fail closed). Anti-template is CLASSIFIED first (§7): A ⇒ not repairable;
   * B ⇒ no defect (no target); C ⇒ target the one offending block.
   */
  private async planTargetedRepair(shared: GenerateShared, slides: Slide[], outcome: GateOutcome): Promise<{ repairable: boolean; targets: RepairTarget[] }> {
    const targets: RepairTarget[] = [];
    let repairable = true;
    const bySlide = (id: string | null) => (id ? slides.find((s) => s.slideId === id) : undefined);
    const substantiveBlock = (s: Slide) => s.textBlocks.find((b) => b.role === 'body') ?? s.textBlocks.find((b) => b.role === 'headline');
    const push = (slide: Slide, block: TextBlock | undefined, gateClass: RepairTarget['gateClass'], detail: string) => {
      if (!block || block.locked || slide.lockedFields.includes('slide') || slide.lockedFields.includes(`block:${block.blockId}`)) { repairable = false; return; }
      if (!targets.some((t) => t.blockId === block.blockId)) targets.push({ slideId: slide.slideId, blockId: block.blockId, blockRole: block.role, gateClass, detail, meaningUnitRefs: this.meaningRefsOf(block), currentText: block.text });
    };

    // SAFETY (block-level, located by the offending clause). Full-asset implication is NOT block-repairable.
    for (const f of [...outcome.safetyCore.layer1Findings, ...outcome.safetyCore.semanticBlockFindings]) {
      const slide = bySlide(f.slideId); if (!slide) { repairable = false; continue; }
      const block = slide.textBlocks.find((b) => normText(b.text).includes(normText(f.clause)) && f.clause.trim().length > 0) ?? substantiveBlock(slide);
      push(slide, block, 'safety', `unlicensed clause: "${f.clause.slice(0, 70)}"`);
    }
    if (outcome.safetyCore.fullAssetFindings.length) repairable = false;

    // OVERFLOW + CLOSURE from coded findings; ANY other blocking code ⇒ not locally repairable.
    for (const f of outcome.blockingFindings) {
      if (f.code === 'block_new_proposition' || f.code === 'block_unauthorized_proposition') continue; // handled via safetyCore
      if (f.code === 'asset_composition_proposition') { repairable = false; continue; }
      if (f.code === 'cta_no_action' || f.code === 'cta_redundant' || f.code === 'cta_not_closed') {
        const slide = bySlide(f.slideId) ?? slides.find((s) => s.semanticRole === 'cta');
        if (!slide) { repairable = false; continue; }
        push(slide, slide.textBlocks.find((b) => b.role === 'cta'), 'closure', f.detail);
        continue;
      }
      if (f.code === 'text_overflow' || f.code === 'below_min_font' || f.code === 'outside_safe_margins') {
        const slide = bySlide(f.slideId); if (!slide) { repairable = false; continue; }
        push(slide, substantiveBlock(slide), 'overflow', f.detail);
        continue;
      }
      // scope/polarity/modality preservation (§5) — a per-block meaning defect the safety-class rewrite fixes
      if (f.code === 'scope_broadened' || f.code === 'modality_shift' || f.code === 'cost_claim' || f.code === 'reader_outcome') {
        const slide = bySlide(f.slideId); if (!slide) { repairable = false; continue; }
        push(slide, substantiveBlock(slide), 'safety', f.detail);
        continue;
      }
      repairable = false; // structural / binding / full-asset / anything else — not a local prose repair
    }

    // ANTI-TEMPLATE (§7) — classify BEFORE any prose rewrite (only reached when it is the sole failure).
    if (outcome.antiTemplateFail) {
      let cls = null as null | { klass: string; blockRef: string | null; reason: string };
      if (this.deps.model.classifyAntiTemplate) { try { cls = await this.deps.model.classifyAntiTemplate({ assetView: this.assetView(outcome.version), brief: shared.brief }); } catch { /* classifier unavailable */ } }
      if (!cls || cls.klass === 'A_unsupported_concept') repairable = false;
      else if (cls.klass === 'B_simple_not_defect') { /* not a defect — no target, does not block repairability */ }
      else { const c = cls; const slide = c.blockRef ? slides.find((s) => s.semanticRole === c.blockRef || s.slideId === c.blockRef) : undefined; push(slide ?? slides[0]!, slide ? substantiveBlock(slide) : undefined, 'anti_template_filler', c.reason); }
    }

    return { repairable, targets };
  }

  /** Apply targeted repairs: replace ONLY the target blocks' text (blockId/role/authorizedFrom/locks preserved),
   * leaving every unaffected block byte-identical. A locked block is never mutated. */
  private applyRepairs(slides: Slide[], repaired: RepairedBlock[]): Slide[] {
    const next = new Map(repaired.map((r) => [`${r.slideId}::${r.blockId}`, (r.newText ?? '').trim()]));
    return slides.map((s) => ({ ...s, textBlocks: s.textBlocks.map((b) => {
      const nt = next.get(`${s.slideId}::${b.blockId}`);
      return nt && !b.locked && !s.lockedFields.includes('slide') && !s.lockedFields.includes(`block:${b.blockId}`) ? { ...b, text: nt } : b;
    }) }));
  }

  private assetView(v: CarouselAssetVersion): unknown {
    return { concept: v.concept.communicationLogic, slides: v.slides.map((s) => ({ role: s.semanticRole, text: s.textBlocks.map((b) => b.text).join(' ') })) };
  }

  async getAssetByHandoff(businessId: string, createHandoffId: string): Promise<CarouselAsset | null> {
    return this.deps.repo.getAssetByHandoff(businessId, createHandoffId);
  }

  /** Founder media upload → eligible source pool (BB later chooses whether/how to use it). Bytes → blob. */
  async addMedia(businessId: string, input: { bytes: Buffer; filename?: string; reuseRight?: ReuseRight; sourceType?: SourceType }): Promise<CarouselSourceRef> {
    const sourceRefId = generateId();
    const mediaRef = `carousel/media/${businessId}/${sourceRefId}.png`;
    await this.deps.blob.put(mediaRef, input.bytes);
    const ref: CarouselSourceRef = { sourceRefId, sourceType: input.sourceType ?? 'uploaded_image', provenance: input.filename ? `founder upload: ${input.filename}` : 'founder upload', reuseRight: input.reuseRight ?? 'founder_uploaded', mediaRef };
    await this.deps.repo.saveMedia(businessId, { ...ref, ...(input.filename ? { filename: input.filename } : {}) });
    return ref;
  }
  async listMedia(businessId: string): Promise<CarouselSourceRef[]> { return this.deps.repo.listMedia(businessId); }
  async setBrand(businessId: string, brand: import('./contracts').BrandConstraints & { source: string }): Promise<void> { return this.deps.repo.saveBrand(businessId, brand); }
  async getBrand(businessId: string): Promise<import('./contracts').BrandConstraints | null> { return this.deps.repo.getBrand(businessId); }

  async getAsset(businessId: string, assetId: string): Promise<{ asset: CarouselAsset; version: CarouselAssetVersion; render: RenderVersion | null } | null> {
    const asset = await this.deps.repo.getAsset(businessId, assetId);
    if (!asset) return null;
    const version = await this.deps.repo.getVersion(businessId, asset.currentVersionId);
    if (!version) return null;
    const render = await this.deps.repo.getRender(version.versionId);
    return { asset, version, render };
  }

  /**
   * Scoped, non-destructive revision → new immutable AssetVersion. copy_only/slide/cta preserve concept, slide
   * set/order, media, visual system, layout, untouched sources and ALL locks. If revised copy cannot fit,
   * the structural gates fail the render and the revision is rejected honestly — never a silent shrink/
   * template-switch/unlock/re-pick.
   */
  async revise(businessId: string, assetId: string, scope: RevisionScope, newTextByRole: Partial<Record<'headline' | 'body' | 'kicker' | 'cta', string>>): Promise<{ status: 'revised'; version: CarouselAssetVersion; render: RenderVersion } | { status: 'revision_rejected'; findings: GateFinding[] }> {
    const asset = await this.deps.repo.getAsset(businessId, assetId);
    if (!asset) throw new ValidationError('CAROUSEL_NOT_FOUND', 'No such carousel.');
    const cur = await this.deps.repo.getVersion(businessId, asset.currentVersionId);
    if (!cur) throw new ValidationError('CAROUSEL_VERSION_MISSING', 'Current version missing.');
    const ctx = await this.deps.context(businessId);
    // §3 AUTHORITY: revision revalidates against the IMMUTABLE persisted snapshot, never live strategy.
    const snapshot = (await this.deps.repo.getAuthorizationSnapshot(businessId, cur.authorizationSnapshotId)) ?? await this.snapshotOrThrow(businessId, cur);
    const nextVersionNumber = cur.versionNumber + 1;

    // VISUAL-ONLY ("keep the copy, change the design"): copy/sources/authorization untouched; only the
    // visual system + composition change. Other scopes keep the existing coherent visual system + layout so a
    // scoped copy edit never perturbs unrelated slides.
    let slides: Slide[]; let system: VisualSystem; let advisories: GateFinding[] = [];
    if (scope.kind === 'visual_only') {
      system = alternateVisualSystem(cur.visualSystem);
      const planned = planLayouts(cur.slides, cur.concept, system);
      slides = planned.slides; advisories = planned.advisories;
    } else {
      system = cur.visualSystem;
      slides = cur.slides.map((s) => {
        if (scope.kind === 'slide' && scope.slideId && s.slideId !== scope.slideId) return s;
        if (scope.kind === 'cta') return reviseSlideCopy(s, { cta: newTextByRole.cta ?? s.textBlocks.find((b) => b.role === 'cta')?.text });
        return reviseSlideCopy(s, newTextByRole);
      });
    }
    const next = this.composeVersion(assetId, businessId, nextVersionNumber, cur.brief, cur.concept, slides, ctx ?? this.ctxFromVersion(cur), cur.authorizationSnapshotId, system);
    const structuralReport = validateCarouselCopy({ slides, snapshot, brief: cur.brief, conceptOutlineLength: cur.concept.slideOutline.length });
    const safety = await this.claimSafety(slides, snapshot, cur.brief.communicationJob);
    const closureFindings = await validateClosure(slides, snapshot, this.deps.model.reviewClosure?.bind(this.deps.model));
    const copyReport = combineReports(combineReports(structuralReport, safety.report), { valid: closureFindings.length === 0, findings: closureFindings });
    const { rendered, report: visReport } = await this.renderAndGate(next, advisories);
    if (!copyReport.valid || !visReport.valid) {
      await this.persistTrace(businessId, assetId, null, nextVersionNumber, safety.core, [...findingsToReasons(copyReport.findings), ...findingsToReasons(visReport.findings)], 'fail_closed');
      return { status: 'revision_rejected', findings: [...copyReport.findings, ...visReport.findings] };
    }

    await this.deps.repo.saveVersion(next);
    await this.deps.repo.setCurrentVersion(assetId, next.versionId);
    await this.deps.repo.recordRevision({ assetId, fromVersionId: cur.versionId, toVersionId: next.versionId, scope, at: this.now() });
    const rv = await this.persistRender(next, rendered, visReport);
    await this.persistTrace(businessId, assetId, next.versionId, nextVersionNumber, safety.core, [], 'repaired_persisted');
    return { status: 'revised', version: next, render: rv };
  }

  /**
   * "Try a different angle" — a CONCEPT-LEVEL revision. Picks a genuinely different communication logic
   * (not a paraphrase of the same outline), regenerates governed copy, reruns FULL claim safety, re-renders,
   * and mints AssetVersion N+1 with lineage. Never overwrites version N. Compatible explicit locks (a
   * whole-slide or block lock on a role the new concept still uses) are carried forward.
   */
  async tryDifferentAngle(businessId: string, assetId: string): Promise<{ status: 'revised'; version: CarouselAssetVersion; render: RenderVersion } | { status: 'insufficient' } | { status: 'not_different' }> {
    const asset = await this.deps.repo.getAsset(businessId, assetId);
    if (!asset) throw new ValidationError('CAROUSEL_NOT_FOUND', 'No such carousel.');
    const cur = await this.deps.repo.getVersion(businessId, asset.currentVersionId);
    if (!cur) throw new ValidationError('CAROUSEL_VERSION_MISSING', 'Current version missing.');
    const snapshot = (await this.deps.repo.getAuthorizationSnapshot(businessId, cur.authorizationSnapshotId)) ?? await this.snapshotOrThrow(businessId, cur);
    const ctx = (await this.deps.context(businessId)) ?? this.ctxFromVersion(cur);
    const avoid = [`different_angle: choose a materially DIFFERENT communication logic than "${cur.concept.communicationLogic}" (avoid family ${cur.concept.internalFamily}); do not paraphrase the same slide outline (${cur.concept.slideOutline.join('/')}).`];

    let concept: Concept;
    try { concept = await this.deps.model.chooseConcept({ brief: cur.brief, snapshot, repairReasons: avoid }); }
    catch { this.deps.log?.({ type: 'carousel_angle_concept_threw' }); return { status: 'insufficient' }; }
    if (concept.slideOutline.length < 3 || concept.slideOutline.length > 8) return { status: 'insufficient' };
    if (concept.internalFamily === cur.concept.internalFamily && concept.slideOutline.join('/') === cur.concept.slideOutline.join('/')) return { status: 'not_different' };
    const feas = checkFeasibility(concept.slideOutline, snapshot);
    if (!feas.feasible) return { status: 'insufficient' };
    concept = { ...concept, slideOutline: feas.outline };
    const system = cur.visualSystem;

    const nextVersionNumber = cur.versionNumber + 1;
    let priorDraft; let repairReasons: string[] = []; let lastCore: CarouselSafetyTraceCore | null = null;
    for (let attempt = 0; attempt < MAX_CAROUSEL_ATTEMPTS; attempt++) {
      let draft;
      try { draft = await this.deps.model.draftCopy({ brief: cur.brief, snapshot, voiceLines: ctx.voiceLines, concept, ...(priorDraft ? { priorDraft } : {}), ...(repairReasons.length ? { repairReasons } : {}) }); }
      catch { this.deps.log?.({ type: 'carousel_angle_draft_threw' }); continue; }

      const composed = attachHookMedia(this.carryCompatibleLocks(composeSlides(draft, concept, snapshot), cur.slides), snapshot);
      const planned = planLayouts(composed, concept, system);
      const slides = planned.slides;
      const version = this.composeVersion(assetId, businessId, nextVersionNumber, cur.brief, concept, slides, ctx, snapshot.snapshotId, system);
      const structuralReport = validateCarouselCopy({ slides, snapshot, brief: cur.brief, conceptOutlineLength: concept.slideOutline.length });
      const safety = await this.claimSafety(slides, snapshot, cur.brief.communicationJob);
      lastCore = safety.core;
      const closureFindings = await validateClosure(slides, snapshot, this.deps.model.reviewClosure?.bind(this.deps.model));
      const copyReport = combineReports(combineReports(structuralReport, safety.report), { valid: closureFindings.length === 0, findings: closureFindings });
      const { rendered, report: visReport } = await this.renderAndGate(version, planned.advisories);
      let antiTemplateFail: string | null = null;
      if (copyReport.valid && visReport.valid && this.deps.model.reviewAntiTemplate) {
        try { const v = await this.deps.model.reviewAntiTemplate({ assetView: this.assetView(version), brief: cur.brief }); if (v.generic) antiTemplateFail = `anti_template: ${v.reason}`; } catch { /* judge unavailable */ }
      }
      if (copyReport.valid && visReport.valid && !antiTemplateFail) {
        await this.deps.repo.saveVersion(version);
        await this.deps.repo.setCurrentVersion(assetId, version.versionId);
        await this.deps.repo.recordRevision({ assetId, fromVersionId: cur.versionId, toVersionId: version.versionId, scope: { kind: 'concept', request: 'try a different angle' }, at: this.now() });
        const rv = await this.persistRender(version, rendered, visReport);
        await this.persistTrace(businessId, assetId, version.versionId, attempt, safety.core, repairReasons, 'repaired_persisted');
        this.deps.log?.({ type: 'carousel_angle_ok' });
        return { status: 'revised', version, render: rv };
      }
      repairReasons = [...findingsToReasons(copyReport.findings), ...findingsToReasons(visReport.findings), ...(antiTemplateFail ? [antiTemplateFail] : [])];
      priorDraft = draft;
    }
    if (lastCore) await this.persistTrace(businessId, assetId, null, MAX_CAROUSEL_ATTEMPTS - 1, lastCore, repairReasons, 'fail_closed');
    this.deps.log?.({ type: 'carousel_angle_fail_closed' });
    return { status: 'insufficient' };
  }

  /** Carry compatible explicit locks (whole-slide / block) onto a new concept's slides by semantic role. */
  private carryCompatibleLocks(newSlides: Slide[], oldSlides: Slide[]): Slide[] {
    const lockedOld = oldSlides.filter((s) => s.lockedFields.includes('slide') || s.textBlocks.some((b) => b.locked));
    if (!lockedOld.length) return newSlides;
    return newSlides.map((ns) => {
      const match = lockedOld.find((os) => os.semanticRole === ns.semanticRole);
      if (!match) return ns;
      const wholeSlideLocked = match.lockedFields.includes('slide');
      const textBlocks = ns.textBlocks.map((nb) => {
        const ob = match.textBlocks.find((b) => b.role === nb.role && (b.locked || wholeSlideLocked));
        return ob ? { ...nb, text: ob.text, locked: true } : nb;
      });
      const lockedFields = wholeSlideLocked ? [...new Set([...ns.lockedFields, 'slide'])] : ns.lockedFields;
      return { ...ns, textBlocks, lockedFields };
    });
  }

  private async snapshotOrThrow(businessId: string, v: CarouselAssetVersion): Promise<AssetAuthorizationSnapshot> {
    // Fallback only: the immutable snapshot is the authority; reconstruct minimal from version context.
    const ctx = await this.deps.context(businessId);
    return {
      snapshotId: v.authorizationSnapshotId, businessId, createHandoffId: v.brief.createHandoffId, strategyVersionId: v.brief.strategyVersionId,
      language: v.languageContext, speakingRole: ctx?.speakingRole ?? '', audienceUseContext: v.brief.audienceUseContext,
      licensedPropositions: ctx?.licensedPropositions ?? [], proofFacts: ctx?.proofFacts ?? [], ctaFunction: v.brief.ctaDirection,
      ownedStances: [], sourceRefs: v.sourceManifest, modelId: null, safetyContractHash: null, producedAt: v.producedAt,
    };
  }
  private ctxFromVersion(v: CarouselAssetVersion): CarouselContextView {
    return { strategyVersionId: v.brief.strategyVersionId, language: v.languageContext, goal: v.brief.founderGoalTrace, coreBet: v.brief.strategicBetTrace, audience: v.brief.audienceUseContext, ctaDirection: v.brief.ctaDirection, licensedPropositions: [], proofFacts: [], sourceRefs: v.sourceManifest, brand: { brandContextVersion: v.brandContextVersion, mode: v.visualSystem.mode === 'brand' ? 'known' : 'restrained_default' }, voiceLines: [], speakingRole: '' };
  }

  /** Serve a single rendered slide PNG (by version + order) from the blob store. */
  async slidePng(businessId: string, versionId: string, order: number): Promise<Buffer | null> {
    const v = await this.deps.repo.getVersion(businessId, versionId);
    if (!v) return null;
    const rv = await this.deps.repo.getRender(versionId);
    const si = rv?.slideImages.find((x) => x.order === order);
    return si ? this.deps.blob.get(si.blobKey) : null;
  }

  /** Ensure the export ZIP exists and return its bytes (or null if the render is not ready). */
  async exportBytes(businessId: string, versionId: string): Promise<Buffer | null> {
    const res = await this.export(businessId, versionId);
    if (!('zipKey' in res)) return null;
    return this.deps.blob.get(res.zipKey);
  }

  /** Build the exportable ZIP of ordered PNG slides. Only after render gates pass. */
  async export(businessId: string, versionId: string): Promise<{ zipKey: string; slideCount: number } | { status: 'not_ready' }> {
    const version = await this.deps.repo.getVersion(businessId, versionId);
    if (!version) throw new ValidationError('CAROUSEL_VERSION_MISSING', 'No such version.');
    const rv = await this.deps.repo.getRender(versionId);
    if (!rv || !rv.gateReport.valid) return { status: 'not_ready' };
    const files: Array<{ name: string; bytes: Buffer }> = [];
    for (const si of [...rv.slideImages].sort((a, b) => a.order - b.order)) {
      const bytes = await this.deps.blob.get(si.blobKey);
      if (!bytes) return { status: 'not_ready' };
      files.push({ name: `slide-${String(si.order + 1).padStart(2, '0')}.png`, bytes });
    }
    const zipKey = `carousel/${businessId}/${versionId}/carousel.zip`;
    await this.deps.blob.putZip(zipKey, files);
    return { zipKey, slideCount: files.length };
  }
}
