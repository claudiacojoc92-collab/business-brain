/**
 * Slice 6 — Concept MATERIAL-FEASIBILITY. A slide semantic beat may exist only if it binds to an
 * authorized MEANING UNIT (analog of Slice-5 action→strategy-trace: no source → no beat). Strategy
 * decisions are framing, NEVER a public-claim meaning unit. Slide count FOLLOWS the available meaning —
 * the outline is contracted to the grounded beats (no orphan beats, no padding), or the concept is
 * rejected as infeasible BEFORE any copy generation.
 */
import type { AssetAuthorizationSnapshot, MeaningUnit, MeaningUnitType, FeasibilityResult, SlideRole, BeatBinding, ConceptFamily, Concept } from './contracts';

// ── Decision 2 — CLAIM-TYPE angle feasibility (move the check upstream of generation). A concept's angle is
//    writable only if the authority set can LICENSE the claim TYPES its angle requires. The previous gate
//    conflated everything into a 'proof' lane, so descriptive proofFacts (addresses, credentials) made an
//    outcome angle look supported and the model then invented outcome claims. This classifies precisely.
export type CarouselClaimType = 'outcome' | 'capability' | 'credential' | 'descriptive' | 'social_proof' | 'stance';

/** The claim type a documented-proof KIND licenses (kinds come from Part-1 extraction, carried on the snapshot). */
export function claimTypeForProofKind(kind: string, text = ''): CarouselClaimType {
  switch (kind) {
    case 'testimonial': return 'social_proof';
    case 'external_sourced_figure': return /\b(star|rating|review)/i.test(text) ? 'social_proof' : 'outcome';
    case 'credential': case 'award': return 'credential';
    case 'location': case 'tenure': case 'team_size': case 'service_count': return 'descriptive';
    case 'founder_stated': return 'descriptive'; // a bare founder statement is not documented outcome proof
    // Unknown/absent kind: a proofFact with no descriptive tag is the historical documented-result ("proof" lane) → outcome.
    default: return 'outcome';
  }
}

/** Claim types the authority set can actually license (precise; proofKinds aligns with snapshot.proofFacts). */
export function licensableClaimTypes(snap: AssetAuthorizationSnapshot): Set<CarouselClaimType> {
  const out = new Set<CarouselClaimType>();
  const kinds = snap.proofKinds ?? [];
  snap.proofFacts.forEach((t, i) => out.add(claimTypeForProofKind(kinds[i] ?? '', t)));
  for (const p of snap.licensedPropositions) {
    if (p.source === 'business_evidence') out.add('descriptive');
    else if (p.source === 'behavior_result') out.add('outcome');
    else if (p.source === 'founder_owned') out.add('stance');
  }
  if (snap.ownedStances.length) out.add('stance');
  return out;
}

/** The claim type(s) an angle (concept family) needs at least ONE of, to be writable without inventing. */
function requiredAnyOf(fam: ConceptFamily): CarouselClaimType[] {
  switch (fam) {
    case 'proof_breakdown': case 'before_after': return ['outcome'];
    case 'proof_statement': return ['outcome', 'social_proof'];
    case 'myth_correction': return ['capability', 'descriptive', 'stance'];
    case 'checklist': return ['descriptive', 'capability'];
    case 'problem_reframe': return ['descriptive', 'stance'];
    case 'founder_insight': return ['stance', 'descriptive'];
    case 'offer_explainer': return ['descriptive', 'capability'];
    default: return ['descriptive', 'capability', 'stance'];
  }
}
/** Fallback families, most-preferred first, when the intended angle isn't licensable. */
const REANGLE_ORDER: ConceptFamily[] = ['offer_explainer', 'founder_insight', 'problem_reframe', 'checklist', 'proof_statement'];

const CLAIM_PLAIN: Record<CarouselClaimType, string> = {
  outcome: 'results or outcomes', social_proof: 'reviews or testimonials', credential: 'credentials',
  capability: 'what you can do', descriptive: 'your services and details', stance: 'your own point of view',
};

export type AngleDecision = 'writable' | 'reangled' | 'needs_evidence';
export interface EvidenceRequest { readonly claim: CarouselClaimType; readonly ask: string }
export interface AngleAssessment {
  readonly decision: AngleDecision;
  readonly intendedFamily: ConceptFamily;
  readonly intendedTypes: CarouselClaimType[];
  readonly licensable: CarouselClaimType[];
  readonly chosenFamily: ConceptFamily | null;
  readonly founderNote: string | null;   // plain-language, FOUNDER-facing, shown in the UI on a re-angle
  readonly strategyBetSupported: boolean; // false ⇒ the strategy's persuasive story (outcome/social-proof) isn't licensable, so the copy brief must drop the bet even if the chosen family is descriptively writable
  readonly requests: EvidenceRequest[];   // populated only when decision === 'needs_evidence'
}

/** One-line, one-fact-answerable evidence asks for the intended types the authority lacks (≤2). */
function evidenceRequestsFor(types: CarouselClaimType[]): EvidenceRequest[] {
  const ask: Record<CarouselClaimType, string> = {
    outcome: 'One concrete result you can point to — a number, or one client and what changed.',
    social_proof: 'One review or testimonial you can share, with who said it.',
    credential: 'One credential, licence or certification your team holds.',
    capability: 'One specific thing you do that others in your field do not.',
    descriptive: 'One concrete detail about your services or who they are for.',
    stance: 'One thing you believe about this work that guides how you do it.',
  };
  return types.slice(0, 2).map((t) => ({ claim: t, ask: ask[t] }));
}

/**
 * Decide, BEFORE generation, whether the intended concept angle is writable from the authority set; if not,
 * pick the smallest licensable angle (and produce a founder-facing note), or — if nothing substantive is
 * licensable — return needs_evidence with ≤2 one-line asks. Never let a structurally-unwritable angle draft.
 */
export function assessAngle(concept: Concept, snap: AssetAuthorizationSnapshot): AngleAssessment {
  const licensable = licensableClaimTypes(snap);
  const intendedTypes = requiredAnyOf(concept.internalFamily);
  const intendedOk = intendedTypes.some((t) => licensable.has(t));
  // The strategy's PERSUASIVE story (an outcome/referral/results bet) needs outcome or social-proof to be told.
  // When neither is licensable, the copy brief must drop the bet even if the model's chosen family is descriptively
  // writable — otherwise the model keeps inventing results/referral claims to satisfy the bet it was shown.
  const strategyBetSupported = licensable.has('outcome') || licensable.has('social_proof');
  const descriptivePlain = () => {
    const have = [...licensable].filter((t) => t !== 'outcome' && t !== 'social_proof');
    return [...new Set(have.map((t) => CLAIM_PLAIN[t]))].join(' and ') || 'what your sources actually show';
  };
  const base = { intendedFamily: concept.internalFamily, intendedTypes, licensable: [...licensable], strategyBetSupported };

  if (intendedOk) {
    // Family is writable; but if the strategy's persuasive types aren't licensable, still tell the founder why the
    // copy stays descriptive (and the service will drop the bet from the copy brief).
    const founderNote = strategyBetSupported ? null
      : `I built this around ${descriptivePlain()} because there's no results or reviews I can point to in your sources yet.`;
    return { ...base, decision: 'writable', chosenFamily: concept.internalFamily, founderNote, requests: [] };
  }

  const chosen = REANGLE_ORDER.find((f) => requiredAnyOf(f).some((t) => licensable.has(t)));
  if (chosen) {
    const missing = intendedTypes.filter((t) => !licensable.has(t));
    const missPlain = [...new Set(missing.map((t) => CLAIM_PLAIN[t]))].join(' or ');
    const founderNote = `I built this around ${descriptivePlain()} because there's no ${missPlain} in what I can see about your business yet.`;
    return { ...base, decision: 'reangled', chosenFamily: chosen, founderNote, requests: evidenceRequestsFor(intendedTypes) /* kept for logging; not surfaced on a re-angle */ };
  }
  return { ...base, decision: 'needs_evidence', chosenFamily: null, founderNote: null, requests: evidenceRequestsFor(intendedTypes) };
}

/** Derive the authorized meaning units from the immutable snapshot (strategy decisions excluded). */
export function meaningUnits(snap: AssetAuthorizationSnapshot): MeaningUnit[] {
  const out: MeaningUnit[] = [];
  snap.proofFacts.forEach((t, i) => out.push({ type: 'proof', ref: `PF${i + 1}`, text: t }));
  for (const p of snap.licensedPropositions) {
    if (p.source === 'business_evidence') out.push({ type: 'business_fact', ref: p.ref, text: p.text });
    else if (p.source === 'founder_owned') out.push({ type: 'founder_insight', ref: p.ref, text: p.text });
    else if (p.source === 'behavior_result') out.push({ type: 'proof', ref: p.ref, text: p.text });
    // strategy_decision → framing only, NEVER a public-claim meaning unit
  }
  for (const s of snap.ownedStances) if (!out.some((u) => u.text === s)) out.push({ type: 'founder_insight', ref: `OS`, text: s });
  if (snap.audienceUseContext.trim()) out.push({ type: 'audience_context', ref: 'AUD', text: snap.audienceUseContext });
  if (snap.ctaFunction.trim()) out.push({ type: 'cta_function', ref: 'CTA', text: snap.ctaFunction });
  return out;
}

/** Which meaning-unit type(s) can ground a substantive beat of this role. hook/cta handled separately. */
function requiredFor(role: SlideRole): MeaningUnitType[] {
  switch (role) {
    case 'proof': return ['proof'];
    case 'context': return ['business_fact', 'audience_context'];
    case 'insight': return ['founder_insight'];
    case 'step': return ['business_fact'];
    // A reframe is an INTERPRETIVE/evaluative move ("the real point is…"): it can only be stated truthfully
    // from a licensed owned stance (founder_insight). Grounding it in a bare business_fact forces the realizer
    // to INVENT the evaluation (e.g. "worth starting with"), which the proposition kernel then blocks. Without
    // an owned stance the reframe beat is orphaned and the outline contracts to its factual beats. (M5.7)
    case 'reframe': return ['founder_insight'];
    default: return ['business_fact', 'founder_insight', 'audience_context', 'proof'];
  }
}
const SUBSTANTIVE: SlideRole[] = ['context', 'proof', 'insight', 'step', 'reframe'];

/**
 * Check + contract a concept outline against the authorized meaning. Returns the grounded outline
 * (hook + grounded substantive beats + cta), capped by the number of distinct substantive units so a thin
 * fixture cannot pad. feasible=false when no substantive meaning or no CTA function exists.
 */
export function checkFeasibility(outline: SlideRole[], snap: AssetAuthorizationSnapshot): FeasibilityResult {
  const units = meaningUnits(snap);
  const have = new Set(units.map((u) => u.type));
  const substantiveUnitCount = units.filter((u) => u.type !== 'cta_function').length;
  const reasons: string[] = [];

  if (!have.has('cta_function')) return { feasible: false, outline: [], reasons: ['no authorized CTA function — a carousel cannot close'], missing: 'cta' };
  if (substantiveUnitCount === 0) return { feasible: false, outline: [], reasons: ['no authorized substantive meaning (only strategy framing) — concept not material-feasible; do not manufacture claims'], missing: 'substance' };

  // grounded substantive beats from the concept outline, in order
  const grounded: SlideRole[] = [];
  for (const role of outline) {
    if (!SUBSTANTIVE.includes(role)) continue;
    if (requiredFor(role).some((t) => have.has(t))) grounded.push(role);
    else reasons.push(`dropped orphan beat "${role}" — no authorized ${requiredFor(role).join('/')} to ground it`);
  }
  // if the outline's substantive beats were all orphaned but substantive units exist, inject the best-grounded beat
  if (grounded.length === 0) {
    const pref: SlideRole[] = ['proof', 'context', 'insight', 'step', 'reframe'];
    const inject = pref.find((r) => requiredFor(r).some((t) => have.has(t)));
    if (inject) { grounded.push(inject); reasons.push(`substituted a grounded "${inject}" beat (the concept's beats had no authorized source)`); }
  }
  // slide count follows meaning: never more substantive beats than distinct substantive units (no padding)
  const capped = grounded.slice(0, Math.max(1, substantiveUnitCount));
  if (capped.length < grounded.length) reasons.push(`contracted to ${capped.length} substantive beat(s): only ${substantiveUnitCount} authorized meaning unit(s) available (no padding)`);

  const contracted: SlideRole[] = (['hook', ...capped, 'cta'] as SlideRole[]).slice(0, 8);
  if (contracted.length < 3) return { feasible: false, outline: [], reasons: [...reasons, 'fewer than the minimum viable beats (hook + 1 grounded + cta) could be grounded'] };
  return { feasible: true, outline: contracted, reasons };
}

// ── Concept ↔ material feasibility (§1): a concept may be SELECTED only if the authorized meaning can support
//    the communication logic its family implies. A "decomposition" family (breakdown / before-after / checklist
//    / myth-correction) PROMISES structure the material must actually contain; when it does not, we DOWNGRADE to
//    the smallest supported family (never invent causes to satisfy a label). Smallest distinction — not a taxonomy.

/** Count the distinct substantive (non-CTA) authorized units by lane. */
function materialProfile(snap: AssetAuthorizationSnapshot): { proof: number; business: number; insight: number; audience: number; substantive: number } {
  const u = meaningUnits(snap);
  const proof = u.filter((x) => x.type === 'proof').length;
  const business = u.filter((x) => x.type === 'business_fact').length;
  const insight = u.filter((x) => x.type === 'founder_insight').length;
  const audience = u.filter((x) => x.type === 'audience_context').length;
  return { proof, business, insight, audience, substantive: proof + business + insight + audience };
}

/** Minimum material each family needs to keep its promise. Decomposition families need PARTS, not just a result. */
function familySupported(fam: ConceptFamily, p: ReturnType<typeof materialProfile>): boolean {
  switch (fam) {
    // decomposition of a proof needs the result PLUS ≥2 further substantive units to populate the breakdown beats
    case 'proof_breakdown': return p.proof >= 1 && (p.business + p.insight) >= 2;
    case 'before_after': return p.proof >= 1 && (p.business + p.audience) >= 1; // a "before" state to contrast the result
    case 'checklist': return (p.business + p.insight) >= 3;                     // a list needs ≥3 items
    case 'myth_correction': return (p.insight + p.business) >= 2;              // the myth + the corrected claim
    case 'problem_reframe': return (p.audience + p.business) >= 1 && (p.insight + p.business) >= 1;
    // statement-level families keep their promise with a single grounding unit
    case 'proof_statement': return p.proof >= 1;
    case 'founder_insight': return p.insight >= 1;
    case 'offer_explainer': return p.business >= 1;
    default: return p.substantive >= 1;
  }
}

/** The smallest supported family to fall back to, staying in the same lane where possible (proof→proof_statement). */
function downgradeTarget(fam: ConceptFamily, p: ReturnType<typeof materialProfile>): ConceptFamily | null {
  const proofLane: ConceptFamily[] = ['proof_statement'];
  const generalLane: ConceptFamily[] = ['founder_insight', 'offer_explainer', 'problem_reframe'];
  const order = (fam === 'proof_breakdown' || fam === 'before_after') ? [...proofLane, ...generalLane] : [...generalLane, ...proofLane];
  return order.find((f) => familySupported(f, p)) ?? null;
}

const STATEMENT_LOGIC: Partial<Record<ConceptFamily, string>> = {
  proof_statement: 'State the documented result as proof, ground it in the audience situation, and invite the CTA — WITHOUT claiming causes, mechanism, or steps the material does not license.',
  founder_insight: 'Lead with the founder’s owned point of view (first person), make it concrete for the audience, and invite the CTA — no population claims, no invented outcomes.',
  offer_explainer: 'Explain plainly what the offer is and who it is for from the authorized business facts, and invite the CTA — no comparative/cost claims, no promised results.',
  problem_reframe: 'Name the audience situation, reframe it with the founder’s authorized point of view, and invite the CTA — no invented causality or outcomes.',
};

export interface ConceptAssessment { readonly concept: Concept; readonly downgraded: boolean; readonly from: ConceptFamily | null; readonly reason: string | null }

/**
 * Gate concept selection on material support. If the chosen family is supported, pass it through unchanged. If a
 * decomposition family out-promises the material, DOWNGRADE to the smallest supported family and replace the
 * (internal) communicationLogic/materialFeasibility so no later stage is told to expect a breakdown that cannot
 * be grounded. Returns the concept to use (family adjusted) — never invents material to satisfy the original.
 */
export function assessConcept(concept: Concept, snap: AssetAuthorizationSnapshot): ConceptAssessment {
  const p = materialProfile(snap);
  if (familySupported(concept.internalFamily, p)) return { concept, downgraded: false, from: null, reason: null };
  const target = downgradeTarget(concept.internalFamily, p);
  if (!target) return { concept, downgraded: false, from: null, reason: 'no supported family — feasibility gate will reject' };
  const reason = `concept "${concept.internalFamily}" out-promises the authorized material (proof=${p.proof}, business=${p.business}, insight=${p.insight}); downgraded to "${target}" (no causes invented)`;
  return {
    concept: { ...concept, internalFamily: target, communicationLogic: STATEMENT_LOGIC[target] ?? concept.communicationLogic, materialFeasibility: `downgraded from ${concept.internalFamily}: material supports a ${target}, not a decomposition` },
    downgraded: true, from: concept.internalFamily, reason,
  };
}

// ── Closure feasibility (§1–§4 of the orchestration pass): BEFORE drafting, decide whether the planned body can
//    causally EARN the authorized CTA without inventing a bridge. A CTA is earned when the body carries an
//    authorized unit that DEVELOPS the CTA action (an offer/mechanism fact that names it, or a documented result
//    of it). We never change or soften the authorized CTA; if nothing can earn it, we fail early. ──
const CLOSURE_STOP = new Set(['the', 'and', 'your', 'you', 'with', 'this', 'that', 'for', 'from', 'about', 'into', 'their', 'they', 'them', 'will', 'have', 'what', 'when', 'where', 'which', 'more', 'over', 'next', 'make', 'call', 'book', 'link', 'bio', 'get', 'our', 'out', 'now', 'let', 'see']);
const salient = (s: string): Set<string> => new Set((s.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !CLOSURE_STOP.has(w)));
const overlaps = (a: Set<string>, b: Set<string>): boolean => { for (const x of a) if (b.has(x)) return true; return false; };

export type ClosureFeasibilityStatus = 'closed' | 'contract' | 'infeasible';
export interface ClosureFeasibilityResult { readonly status: ClosureFeasibilityStatus; readonly outline: SlideRole[]; readonly bridgeRefs: string[]; readonly reason: string }

/**
 * Pre-draft closure feasibility. bridge units = substantive units (offer/mechanism fact, documented result, or
 * owned insight) whose salient tokens overlap the CTA action — i.e. the body can talk about what the CTA IS or
 * what it produced. CLOSED: the grounded outline already carries a bridge beat. CONTRACT_OUTLINE: a bridge unit
 * exists but no beat carries it → insert the smallest beat that binds it before the CTA. INFEASIBLE: nothing in
 * the authorized material develops the CTA action → the CTA cannot be earned; fail early (no 5 stochastic drafts).
 */
export function assessClosureFeasibility(outline: SlideRole[], snap: AssetAuthorizationSnapshot): ClosureFeasibilityResult {
  const ctaTokens = salient(snap.ctaFunction);
  if (!ctaTokens.size) return { status: 'closed', outline, bridgeRefs: [], reason: 'CTA names no specific object to earn' };
  const units = meaningUnits(snap);
  // a documented RESULT (proof) earns the ask on its own; an offer/mechanism fact or owned insight earns it when
  // it actually names/describes the CTA action (token overlap).
  const bridge = units.filter((u) => u.type === 'proof' || ((u.type === 'business_fact' || u.type === 'founder_insight') && overlaps(salient(u.text), ctaTokens)));
  if (!bridge.length) return { status: 'infeasible', outline: [], bridgeRefs: [], reason: `no authorized unit develops or earns the CTA action "${snap.ctaFunction}" — the body cannot earn it (material/communication gap); the authorized CTA is not changed` };
  const bridgeRefs = bridge.map((u) => u.ref);
  const carries = (o: SlideRole[]) => bindBeats(o, snap).some((b) => b.units.some((u) => bridgeRefs.includes(u.ref)));
  if (carries(outline)) return { status: 'closed', outline, bridgeRefs, reason: `bridge unit(s) ${bridgeRefs.join(',')} are carried in the body and earn the CTA` };
  // CONTRACT — add the smallest beat that binds a bridge unit, before the CTA (no padding beyond the bridge)
  const bridgeTypes = new Set(bridge.map((u) => u.type));
  const roleFor: SlideRole = bridgeTypes.has('proof') ? 'proof' : bridgeTypes.has('business_fact') ? 'context' : 'insight';
  const body = outline.filter((r) => r !== 'hook' && r !== 'cta');
  const contracted = (['hook', ...Array.from(new Set([...body, roleFor])).slice(0, 6), 'cta'] as SlideRole[]);
  if (carries(contracted)) return { status: 'contract', outline: contracted, bridgeRefs, reason: `inserted a "${roleFor}" beat so bridge unit(s) ${bridgeRefs.join(',')} develop the CTA action before the CTA` };
  return { status: 'infeasible', outline: [], bridgeRefs, reason: `a bridge unit exists (${bridgeRefs.join(',')}) but no beat role could carry it into the body` };
}

/**
 * Bind each beat of a (feasible) outline to the authorized meaning unit(s) it must faithfully realize — the
 * fixed semantic skeleton the constrained realization fallback works from. Hook is a non-propositional opener
 * (may lean on the audience/offer context but asserts nothing new); cta binds the authorized CTA function.
 */
export function bindBeats(outline: SlideRole[], snap: AssetAuthorizationSnapshot): BeatBinding[] {
  const units = meaningUnits(snap);
  const asUnit = (u: MeaningUnit) => ({ ref: u.ref, text: u.text, type: u.type });
  return outline.map((role): BeatBinding => {
    if (role === 'hook') return { role, units: [] };                     // non-propositional opener
    if (role === 'cta') return { role, units: units.filter((u) => u.type === 'cta_function').map(asUnit) };
    const req = requiredFor(role);
    return { role, units: units.filter((u) => req.includes(u.type)).slice(0, 2).map(asUnit) };
  });
}
