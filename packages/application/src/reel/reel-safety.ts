/**
 * Slice 7 — reel claim safety. REUSES the frozen proposition-safety kernel read-only (no new truth system).
 * The reel-local ReelAuthorizationSnapshot is projected into the frozen AuthorizedMessageSpec exactly as the
 * carousel does (strategy DECISIONS are internal framing, never stated content), and every amplified string —
 * hook / on-screen overlay / CTA / an intentionally-featured transcript segment — is validated through the
 * SAME Layer 1/2/3 kernel. Video visuals never license a claim.
 */
import { validateAgainstAuthorization, PROPOSITION_CHECK_PASSES, type PropositionJudge } from '../voice/proposition-safety';
import type { AuthorizedMessageSpec, LicensedProposition, PropositionSource, SampleContent, SpeakingRole } from '../voice/contracts';
import type { ReelAuthorizationSnapshot, ReelTextBlock } from './contracts';

const REEL_FORBIDDEN_CLASSES = ['health_outcome', 'nutrition_fact', 'earnings_claim', 'clinical_claim', 'guarantee', 'comparative_superiority'];

function mapSpeakingRole(role: string): SpeakingRole {
  const r = (role || '').toLowerCase();
  if (r.includes('brand') && r.includes('founder')) return 'founder_led_brand';
  if (r.includes('brand')) return 'brand_institutional';
  if (r.includes('for')) return 'founder_for_brand';
  return 'founder_self';
}

/** Project the immutable reel authorization snapshot → the frozen AuthorizedMessageSpec (carousel semantics). */
export function specFromReelAuthorization(snapshot: ReelAuthorizationSnapshot, communicationJob: string): AuthorizedMessageSpec {
  const licensed: LicensedProposition[] = [];
  const internalDecisions: string[] = [];
  const stances: string[] = [...snapshot.ownedStances];
  for (const p of snapshot.licensedPropositions) {
    if (p.source === 'strategy_decision') { if (!internalDecisions.includes(p.text)) internalDecisions.push(p.text); continue; }
    licensed.push({ text: p.text, source: p.source as PropositionSource });
    if (p.source === 'founder_owned' && !stances.includes(p.text)) stances.push(p.text);
  }
  for (const pf of snapshot.proofFacts) licensed.push({ text: pf, source: 'behavior_result' });
  const unknowns: string[] = [];
  if (licensed.length === 0) unknowns.push('No licensed external material is available; only non-propositional framing may be expressed.');
  if (snapshot.proofFacts.length === 0) unknowns.push('No licensed historical client-result / metric / testimonial proof exists.');
  return {
    communicationJob, communicationJobKind: 'offer', requiredMaterialTypes: [],
    availableMaterialRefs: snapshot.sourceRefIds,
    feasibility: licensed.length > 0 ? 'feasible' : 'blocked_missing_material',
    speakingRole: mapSpeakingRole(snapshot.speakingRole), audience: snapshot.audienceUseContext,
    requiredMeaning: communicationJob, licensedPropositions: licensed, internalDecisions,
    stanceStatements: stances, ctaFunction: snapshot.ctaFunction, unknowns, forbiddenClasses: REEL_FORBIDDEN_CLASSES,
  };
}

export interface ReelCopyFinding { readonly blockId: string; readonly clause: string }

/** Govern the reel's on-screen copy blocks (hook/overlay/cta) as ONE communication. Returns unauthorized clauses
 *  attributed to their block; empty ⇒ safe. */
export async function governReelCopy(
  textBlocks: ReelTextBlock[], snapshot: ReelAuthorizationSnapshot, communicationJob: string,
  judge?: PropositionJudge, passes: number = PROPOSITION_CHECK_PASSES,
): Promise<ReelCopyFinding[]> {
  const spec = specFromReelAuthorization(snapshot, communicationJob);
  const findings: ReelCopyFinding[] = [];
  const hook = textBlocks.find((b) => b.role === 'hook');
  const cta = textBlocks.find((b) => b.role === 'cta');
  const overlays = textBlocks.filter((b) => b.role === 'overlay');
  const content: SampleContent = {
    ...(hook ? { hook: hook.text } : {}),
    beats: overlays.map((b) => b.text),
    ...(cta ? { cta: cta.text } : {}),
  };
  const res = await validateAgainstAuthorization(content, 'reel', spec, judge, passes);
  // attribute each unauthorized clause back to the block whose text contains it
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const v of [...res.layered.layer1Violations.map((x) => x.clause), ...res.union.map((x) => x.clause)]) {
    const owner = textBlocks.find((b) => norm(b.text).includes(norm(v)) && v.trim().length > 0)
      ?? hook ?? textBlocks[0];
    if (owner) findings.push({ blockId: owner.blockId, clause: v });
  }
  return findings;
}

/** Govern a single spoken transcript segment BB intends to AMPLIFY (subtitle it or hook on it). Returns whether
 *  it introduces an unauthorized substantive proposition beyond the authorized message. */
export async function spokenClaimIsUnauthorized(
  spokenText: string, snapshot: ReelAuthorizationSnapshot, communicationJob: string,
  judge?: PropositionJudge, passes: number = PROPOSITION_CHECK_PASSES,
): Promise<boolean> {
  if (!spokenText.trim()) return false;
  const spec = specFromReelAuthorization(snapshot, communicationJob);
  const res = await validateAgainstAuthorization({ hook: spokenText }, 'reel', spec, judge, passes);
  return res.reasons.length > 0;
}
