/**
 * Slice 6 §4/§5 — deterministic guarantees for EXTRACTIVE constrained realization. These run BEFORE proposition
 * safety (they do not replace it — the frozen Layer 1/2/3 kernel still runs afterward). They enforce two
 * structural properties the safety kernel does not:
 *   §4 BINDING: every SUBSTANTIVE block declares ≥1 authorized meaning-unit ref that actually exists; the CTA
 *      binds the CTA function (+ optional offer units); no slide introduces a beat absent from the approved
 *      outline. An unbound substantive block is invalid and can NEVER persist.
 *   §5 SCOPE PRESERVATION: a realization must not silently broaden quantifier / flip polarity / promise a future
 *      from a past result / turn a client result into the reader's / turn an alternative into "cheaper".
 * Both emit blocking GateFindings consumed by the service in constrained mode only.
 */
import type { AssetAuthorizationSnapshot, GateFinding, Slide, SlideRole, BeatBinding } from './contracts';
import { meaningUnits } from './feasibility';

/** Blocks that carry public meaning (must be bound). caption is decorative; cta is bound to the CTA function. */
const SUBSTANTIVE_BLOCK_ROLES = new Set(['headline', 'body', 'kicker']);

/**
 * §4 — every substantive block must be bound to an existing authorized unit; the CTA must bind the CTA function;
 * the produced roles must be a subset of the approved outline (no smuggled beat). Returns blocking findings.
 * The count of `unbound_block` findings is the "unbound-block persistence" guard (they fail-close, so persisted=0).
 */
export function validateExtractiveBindings(slides: Slide[], snapshot: AssetAuthorizationSnapshot, approvedOutline: SlideRole[]): GateFinding[] {
  const findings: GateFinding[] = [];
  const unitRefs = new Set(meaningUnits(snapshot).map((u) => u.ref));
  const allowedRoles = new Set<SlideRole>(approvedOutline);

  for (const s of slides) {
    if (!allowedRoles.has(s.semanticRole)) {
      findings.push({ code: 'unapproved_beat', severity: 'blocking', slideId: s.slideId, detail: `slide role "${s.semanticRole}" is not in the approved outline (${approvedOutline.join('→')})` });
    }
    for (const b of s.textBlocks) {
      if (b.role === 'cta') {
        if (!b.authorizedFrom.ctaFunction) findings.push({ code: 'cta_unbound', severity: 'blocking', slideId: s.slideId, detail: 'CTA block is not bound to the authorized CTA function' });
        continue;
      }
      if (!SUBSTANTIVE_BLOCK_ROLES.has(b.role)) continue;
      // Non-propositional invitations are permitted ref-less: the hook opener and any lead-in on the CTA slide
      // (a CTA is a Layer-2 invitation, not a proposition). The frozen kernel STILL runs on these blocks, so an
      // unlicensed claim smuggled into one is caught by safety — the binding rule only governs substantive claims.
      const isInvitation = s.semanticRole === 'hook' || s.semanticRole === 'cta';
      const hasBinding = Boolean(b.authorizedFrom.propositionRef || b.authorizedFrom.sourceRefId || b.authorizedFrom.ctaFunction);
      if (!hasBinding) {
        if (!isInvitation) findings.push({ code: 'unbound_block', severity: 'blocking', slideId: s.slideId, detail: `substantive ${b.role} declares no authorized meaning-unit ref: "${b.text.slice(0, 60)}"` });
        continue;
      }
      if (b.authorizedFrom.propositionRef && !unitRefs.has(b.authorizedFrom.propositionRef) && !b.authorizedFrom.sourceRefId) {
        findings.push({ code: 'unknown_ref', severity: 'blocking', slideId: s.slideId, detail: `block cites ref "${b.authorizedFrom.propositionRef}" not present in the authorization snapshot` });
      }
    }
  }
  return findings;
}

const has = (t: string, re: RegExp) => re.test(t.toLowerCase());
/** union all text of the units this slide's blocks are bound to (best-effort by ref). */
function boundTextFor(slide: Slide, unitByRef: Map<string, string>): string {
  const parts: string[] = [];
  for (const b of slide.textBlocks) { const ref = b.authorizedFrom.propositionRef; if (ref && unitByRef.has(ref)) parts.push(unitByRef.get(ref)!); }
  return parts.join('  ').toLowerCase();
}

/**
 * §5 — deterministic scope/polarity/modality preservation. High-precision checks only (the Layer-3 judge covers
 * the rest semantically). A realization that broadens scope beyond its bound units is a DIFFERENT claim.
 */
export function validateScopePreservation(slides: Slide[], snapshot: AssetAuthorizationSnapshot, beats: BeatBinding[]): GateFinding[] {
  const findings: GateFinding[] = [];
  const unitByRef = new Map(meaningUnits(snapshot).map((u) => [u.ref, u.text] as const));
  const allBoundText = beats.flatMap((b) => b.units.map((u) => u.text)).join('  ').toLowerCase();
  const anyBoundHasCost = has(allBoundText, /\b(cheap|cheaper|cost|price|afford|less expensive|save money|lower cost)\b/);

  for (const s of slides) {
    if (s.semanticRole === 'cta' || s.semanticRole === 'hook') continue; // CTA/opener judged by closure/safety
    const text = s.textBlocks.filter((b) => b.role !== 'cta').map((b) => b.text).join(' ');
    const lc = text.toLowerCase();
    const bound = boundTextFor(s, unitByRef);

    // quantifier broadening: universal in the surface that is not in the bound unit
    if (has(lc, /\b(most|all|every|everyone|always|never|no one|nobody|any founder)\b/) && !has(bound, /\b(most|all|every|everyone|always|never|no one|nobody)\b/)) {
      findings.push({ code: 'scope_broadened', severity: 'blocking', slideId: s.slideId, detail: `universal quantifier not licensed by the bound unit: "${text.slice(0, 70)}"` });
    }
    // future promise from a documented (past) result
    if (has(lc, /\b(will|guarantee|guaranteed|ensures?|you'?ll get|we'?ll (cut|save|grow|double))\b/) && !has(bound, /\b(will|guarantee|ensure)\b/)) {
      findings.push({ code: 'modality_shift', severity: 'blocking', slideId: s.slideId, detail: `future/guarantee modality not licensed by the bound (documented/past) unit: "${text.slice(0, 70)}"` });
    }
    // cost/value comparison invented from an "alternative" claim
    if (has(lc, /\b(cheaper|less expensive|save money|lower cost|more affordable|without the (full-time )?cost)\b/) && !anyBoundHasCost) {
      findings.push({ code: 'cost_claim', severity: 'blocking', slideId: s.slideId, detail: `cost/value comparison not licensed by any bound unit: "${text.slice(0, 70)}"` });
    }
    // client result reframed as the reader's result: a metric token + second person
    const metric = lc.match(/\b\d+\s?%/);
    if (metric && has(lc, /\b(you|your|you'?ll|you'?re)\b/)) {
      findings.push({ code: 'reader_outcome', severity: 'blocking', slideId: s.slideId, detail: `documented client metric addressed to the reader (client result ≠ reader result): "${text.slice(0, 70)}"` });
    }
  }
  return findings;
}
