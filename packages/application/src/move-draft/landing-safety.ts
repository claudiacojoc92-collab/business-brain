import type { AuthorizedMessageSpec, LicensedProposition, PropositionSource, SampleContent, SpeakingRole } from '../voice/contracts';
import type { LandingAuthorizationSnapshot, LandingDraft, LandingSection } from './contracts';

/**
 * Projects a landing authorization snapshot into the frozen `AuthorizedMessageSpec`, and maps landing prose
 * into the kernel's free-text `SampleContent`. This is the thin adapter that lets a landing page reuse the
 * Slice-4 proposition kernel as-is (proven 2026-10-05: the kernel operates on text, not slide shapes).
 *
 * NOTE: `forbiddenClasses` below is carried for parity with Voice/Carousel but is INERT in the kernel (it is
 * only a model-prompt hint) — the real MEDICAL/regulated-claim guard is a separate deterministic gate built
 * Day 2. See intent/2026-10-05-landing-move and docs/operations/known-issues.md.
 */

// Same forbidden-class list Voice/Carousel pass — never introduce these claim classes.
const LANDING_FORBIDDEN_CLASSES = ['market/population', 'customer history or anecdote', 'reader psychology / behavior', 'causal or mechanism claims', 'comparative/superiority', 'outcomes/results', 'quality claims', 'capabilities', 'operational facts', 'historical proof'];

/** Free-text speaking role → a valid SpeakingRole enum (not read by the kernel classifier; safety-neutral). */
function mapSpeakingRole(role: string): SpeakingRole {
  const r = role.toLowerCase();
  if (r.includes('brand') && r.includes('founder')) return 'founder_led_brand';
  if (r.includes('brand')) return 'brand_institutional';
  if (r.includes('for')) return 'founder_for_brand';
  return 'founder_self';
}

/**
 * Project the persisted landing authorization snapshot → the frozen AuthorizedMessageSpec. Mirrors carousel's
 * specFromSnapshot: strategy decisions fold into internalDecisions (shape emphasis, never stated); business /
 * founder-owned material + documented proof are the ONLY licensed propositions; founder-owned facts are also
 * expressible stances.
 */
export function specFromLandingSnapshot(snapshot: LandingAuthorizationSnapshot, communicationJob: string): AuthorizedMessageSpec {
  const licensed: LicensedProposition[] = [];
  const internalDecisions: string[] = [];
  const stances: string[] = [...snapshot.ownedStances];
  for (const p of snapshot.licensedPropositions) {
    if (p.source === 'strategy_decision') { if (!internalDecisions.includes(p.text)) internalDecisions.push(p.text); continue; }
    licensed.push({ text: p.text, source: p.source as PropositionSource }); // business_evidence | founder_owned | behavior_result
    if (p.source === 'founder_owned' && !stances.includes(p.text)) stances.push(p.text);
  }
  for (const pf of snapshot.proofFacts) licensed.push({ text: pf, source: 'behavior_result' });
  const unknowns: string[] = [];
  if (licensed.length === 0) unknowns.push('No licensed external material is available; only non-propositional framing may be expressed.');
  if (snapshot.proofFacts.length === 0) unknowns.push('No licensed historical client-result / metric / testimonial proof exists.');
  return {
    communicationJob,
    communicationJobKind: 'offer',          // external publishable job; kind is not read by the kernel
    requiredMaterialTypes: [],
    availableMaterialRefs: snapshot.licensedPropositions.map((p) => p.ref),
    feasibility: licensed.length > 0 ? 'feasible' : 'blocked_missing_material',
    speakingRole: mapSpeakingRole(snapshot.speakingRole),
    audience: snapshot.audienceUseContext,
    requiredMeaning: communicationJob,
    licensedPropositions: licensed,
    internalDecisions,
    stanceStatements: stances,
    ctaFunction: snapshot.ctaFunction,
    unknowns,
    forbiddenClasses: LANDING_FORBIDDEN_CLASSES,
  };
}

const clean = (s: string | undefined): string => (s ?? '').trim();

/**
 * The whole page → SampleContent for the kernel + backstop. Every non-CTA section's heading and body become
 * beats; the CTA is carried in the separate `cta` field — a landing page behaves like carousel/reel, NOT
 * caption (caption expects the CTA inside the caption field; proven 2026-10-05).
 */
export function landingDraftToSampleContent(draft: LandingDraft): SampleContent {
  const beats = draft.sections
    .filter((s) => s.role !== 'cta')
    .flatMap((s) => [clean(s.heading), clean(s.body)])
    .filter(Boolean);
  const cta = clean(draft.cta);
  return { ...(beats.length ? { beats } : {}), ...(cta ? { cta } : {}) };
}

/**
 * One section → SampleContent, for per-section attribution (mirrors carousel's per-slide gate so a violation
 * is pinned to the section the founder can then rewrite). The CTA section maps to `cta`; any other section's
 * heading+body map to beats.
 */
export function landingSectionToSampleContent(section: LandingSection, cta: string): SampleContent {
  if (section.role === 'cta') { const c = clean(cta) || clean(section.body); return c ? { cta: c } : {}; }
  const beats = [clean(section.heading), clean(section.body)].filter(Boolean);
  return beats.length ? { beats } : {};
}
