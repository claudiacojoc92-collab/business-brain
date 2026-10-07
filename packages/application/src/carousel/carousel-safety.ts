/**
 * Slice 6 — Carousel claim safety, built on the FROZEN shared proposition-safety kernel (voice/
 * proposition-safety). This is NOT a forked "carousel claim checker": it reuses the complete Layer 1/2/3
 * contract and the SAME authority for every level.
 *
 * The authority is the immutable AssetAuthorizationSnapshot, projected into the frozen AuthorizedMessageSpec
 * exactly as Voice does (buildAuthorizedMessageSpec semantics): strategy DECISIONS are INTERNAL (they shape
 * emphasis but are never asserted), and only real external material — governed business evidence, founder-
 * owned facts, and documented proof — is licensed. So a faithful paraphrase of a licensed proof fact
 * ("cut burn 30%" → "cut burn by 30%") is not a new proposition and PASSES, while a capability/scope/
 * population claim ("we can cut YOUR burn 30%", "target 30% conversion", "most founders waste money") is a
 * new proposition and FAILS.
 *
 * Two levels, ONE authority (§4):
 *   • BLOCK/SLIDE — deterministic Layer 1/2 per founder-visible slide (precise attribution). The CTA is
 *     carried in SampleContent.cta so the frozen Layer-2 CTA-invitation rule governs it (not a blanket
 *     exemption); a world-claim smuggled into a CTA is still caught.
 *   • FULL-ASSET — the N-pass UNION-FAIL semantic judge over the ORDERED whole carousel. Because the judge
 *     sees every clause AND the sequence, it catches both a block-local new proposition and a
 *     composition-level implication that individually-legal slides create together. Findings are attributed
 *     back to the originating slide when the clause is traceable, else recorded as asset-level.
 */
import { validateAgainstAuthorization, PROPOSITION_CHECK_PASSES, type PropositionJudge } from '../voice/proposition-safety';
import { PROPOSITION_CONTRACT_HASH } from '../voice/authorization-snapshot';
import type { AuthorizedMessageSpec, LicensedProposition, PropositionSource, SampleContent, SpeakingRole } from '../voice/contracts';
import type { AssetAuthorizationSnapshot, Slide, GateFinding, CarouselSafetyTraceCore } from './contracts';

// Same forbidden-class list Voice uses — never introduce these claim classes.
const CAROUSEL_FORBIDDEN_CLASSES = ['market/population', 'customer history or anecdote', 'reader psychology / behavior', 'causal or mechanism claims', 'comparative/superiority', 'outcomes/results', 'quality claims', 'capabilities', 'operational facts', 'historical proof'];

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Free-text speaking role → a valid SpeakingRole enum (not read by the kernel classifier; safety-neutral). */
function mapSpeakingRole(role: string): SpeakingRole {
  const r = role.toLowerCase();
  if (r.includes('brand') && r.includes('founder')) return 'founder_led_brand';
  if (r.includes('brand')) return 'brand_institutional';
  if (r.includes('for')) return 'founder_for_brand';
  return 'founder_self';
}

/**
 * Project the persisted asset authorization snapshot → the frozen AuthorizedMessageSpec. Strategy decisions
 * are folded into internalDecisions (never licensed); business/founder-owned material + documented proof
 * are the ONLY licensed propositions. Founder-owned facts are also expressible stances.
 */
export function specFromSnapshot(snapshot: AssetAuthorizationSnapshot, communicationJob: string): AuthorizedMessageSpec {
  const licensed: LicensedProposition[] = [];
  const internalDecisions: string[] = [];
  const stances: string[] = [...snapshot.ownedStances];
  for (const p of snapshot.licensedPropositions) {
    if (p.source === 'strategy_decision') { if (!internalDecisions.includes(p.text)) internalDecisions.push(p.text); continue; }
    licensed.push({ text: p.text, source: p.source as PropositionSource }); // business_evidence | founder_owned | behavior_result
    if (p.source === 'founder_owned' && !stances.includes(p.text)) stances.push(p.text);
  }
  for (const pf of snapshot.proofFacts) licensed.push({ text: pf, source: 'behavior_result' }); // documented, licensed proof
  const unknowns: string[] = [];
  if (licensed.length === 0) unknowns.push('No licensed external material is available; only non-propositional framing may be expressed.');
  if (snapshot.proofFacts.length === 0) unknowns.push('No licensed historical client-result / metric / testimonial proof exists.');
  return {
    communicationJob,
    communicationJobKind: 'offer',            // external publishable job; kind is not read by the kernel
    requiredMaterialTypes: [],
    availableMaterialRefs: snapshot.sourceRefs.map((s) => s.sourceRefId),
    feasibility: licensed.length > 0 ? 'feasible' : 'blocked_missing_material',
    speakingRole: mapSpeakingRole(snapshot.speakingRole),
    audience: snapshot.audienceUseContext,
    requiredMeaning: communicationJob,
    licensedPropositions: licensed,
    internalDecisions,
    stanceStatements: stances,
    ctaFunction: snapshot.ctaFunction,
    unknowns,
    forbiddenClasses: CAROUSEL_FORBIDDEN_CLASSES,
  };
}

const nonCtaText = (s: Slide): string => s.textBlocks.filter((b) => b.role !== 'cta').map((b) => b.text.trim()).filter(Boolean).join('. ');
const ctaText = (s: Slide): string => s.textBlocks.filter((b) => b.role === 'cta').map((b) => b.text.trim()).filter(Boolean).join('. ');

/** One slide → SampleContent (assertive body as a beat; CTA carried separately so Layer-2 governs it). */
function slideContent(s: Slide): SampleContent {
  const body = nonCtaText(s); const cta = ctaText(s);
  return { ...(body ? { beats: [body] } : {}), ...(cta ? { cta } : {}) };
}
/** Whole ordered carousel → SampleContent (each slide a beat, so the judge sees the sequence + composition). */
function assetContent(slides: Slide[]): SampleContent {
  const beats = slides.map(nonCtaText).filter(Boolean);
  const cta = slides.map(ctaText).filter(Boolean).slice(-1)[0];
  return { ...(beats.length ? { beats } : {}), ...(cta ? { cta } : {}) };
}

export interface CarouselSafetyOutcome {
  readonly findings: GateFinding[];        // blocking claim-safety findings (merged into the copy gate report)
  readonly trace: CarouselSafetyTraceCore; // immutable decision trace (attribution + provenance hashes)
}

/**
 * Validate a composed carousel against its immutable authorization snapshot using the frozen kernel at BOTH
 * levels. `judge` is the SAME proposition-preservation judge Voice uses (injected), so there is no second
 * authority. Returns blocking findings + a decision trace.
 */
export async function validateCarouselClaimSafety(
  slides: Slide[], snapshot: AssetAuthorizationSnapshot, communicationJob: string,
  judge: PropositionJudge | undefined, judgeContract: { modelId: string; promptHash: string } | null,
  passes: number = PROPOSITION_CHECK_PASSES,
): Promise<CarouselSafetyOutcome> {
  const spec = specFromSnapshot(snapshot, communicationJob);
  const findings: GateFinding[] = [];
  const layer1Findings: CarouselSafetyTraceCore['layer1Findings'] = [];
  const layer2Permitted: CarouselSafetyTraceCore['layer2Permitted'] = [];

  // ── BLOCK/SLIDE — deterministic Layer 1/2 (judge omitted here; precise per-slide attribution) ──
  for (const s of slides) {
    const local = await validateAgainstAuthorization(slideContent(s), 'carousel', spec, undefined, passes);
    for (const v of local.layered.layer1Violations) {
      findings.push({ code: 'block_unauthorized_proposition', severity: 'blocking', slideId: s.slideId, detail: `LAYER1 ${v.propositionClass}: "${v.clause.slice(0, 80)}"` });
      layer1Findings.push({ slideId: s.slideId, clause: v.clause, propositionClass: v.propositionClass ?? 'unknown' });
    }
    for (const d of local.layered.permittedDiscourse) layer2Permitted.push({ slideId: s.slideId, clause: d.clause, discourseCategory: d.discourseCategory ?? 'unknown' });
  }

  // ── FULL-ASSET — semantic N-pass UNION-FAIL over the ordered whole (composition-level, one authority) ──
  const asset = await validateAgainstAuthorization(assetContent(slides), 'carousel', spec, judge, passes);
  const semanticBlockFindings: CarouselSafetyTraceCore['semanticBlockFindings'] = [];
  const fullAssetFindings: CarouselSafetyTraceCore['fullAssetFindings'] = [];
  for (const p of asset.union) {
    const owner = slides.find((s) => norm(nonCtaText(s)).includes(norm(p.clause)) && norm(p.clause).length > 0);
    if (owner) {
      findings.push({ code: 'block_new_proposition', severity: 'blocking', slideId: owner.slideId, detail: `NEW PROPOSITION: "${p.clause.slice(0, 70)}" — ${p.proposition.slice(0, 80)}` });
      semanticBlockFindings.push({ slideId: owner.slideId, clause: p.clause, proposition: p.proposition });
    } else {
      findings.push({ code: 'asset_composition_proposition', severity: 'blocking', slideId: null, detail: `the carousel as a whole implies an unlicensed proposition: "${p.proposition.slice(0, 80)}" (from "${p.clause.slice(0, 60)}")` });
      fullAssetFindings.push({ clause: p.clause, proposition: p.proposition });
    }
  }

  const trace: CarouselSafetyTraceCore = {
    authorizationSnapshotId: snapshot.snapshotId,
    propositionContractHash: PROPOSITION_CONTRACT_HASH,
    judgeModelId: judgeContract?.modelId ?? null,
    judgePromptHash: judgeContract?.promptHash ?? null,
    layer1Findings, layer2Permitted, semanticBlockFindings, fullAssetFindings,
  };
  return { findings, trace };
}
