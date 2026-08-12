import { describe, it, expect } from 'vitest';
import { classifyClause, classifyLayers, isPermittedDiscourse, splitClauses } from '../../voice/proposition-classes';
import type { AuthorizedMessageSpec, SampleContent, LicensedProposition } from '../../voice/contracts';

const spec = (over: { licensed?: LicensedProposition[]; stances?: string[] } = {}): AuthorizedMessageSpec => ({
  communicationJob: 'cta', communicationJobKind: 'cta', requiredMaterialTypes: ['cta_direction'],
  availableMaterialRefs: ['book a short intro call'], feasibility: 'feasible', speakingRole: 'founder_self',
  audience: 'the audience', requiredMeaning: 'book a short intro call', licensedPropositions: over.licensed ?? [],
  internalDecisions: [], stanceStatements: over.stances ?? [], ctaFunction: 'book a short intro call', unknowns: [], forbiddenClasses: [],
});
const lp = (text: string): LicensedProposition => ({ text, source: 'business_evidence' });
const content = (s: string): SampleContent => ({ cta: s });
const kind = (c: string, s = spec()) => classifyClause(c, s).kind;
const pclass = (c: string, s = spec()) => classifyClause(c, s).propositionClass;

describe('corrected proposition contract — assertion + unlicensed concept (not verb keywords)', () => {
  // ── Final semantic table (CTA-only authorization) ────────────────────────────────────────────────
  it('1. "You\'re deciding who to work with." → L1 asserted reader-state', () => {
    expect(kind("You're deciding who to work with.")).toBe('layer1_proposition');
    expect(pclass("You're deciding who to work with.")).toBe('audience_situation');
  });
  it('2. "If you\'re deciding who to work with — let\'s talk." → L2 hypothetical (no violation, safe)', () => {
    expect(classifyLayers(content("If you're deciding who to work with — let's talk."), spec()).layer1Violations).toEqual([]);
    expect(classifyClause("If you're deciding who to work with", spec()).discourseCategory).toBe('conditional_framing');
  });
  it('3. "Still deciding who to work with?" → L1 (presuppositional state), NOT auto Layer 2', () => {
    expect(kind('Still deciding who to work with?')).toBe('layer1_proposition');
  });
  it('4. "Choosing a consulting partner?" → L1 unlicensed concept (CTA-only)', () => {
    expect(pclass('Choosing a consulting partner?')).toBe('unlicensed_concept');
  });
  it('5. "Evaluating SaaS for your operations team?" → L1 unlicensed concept', () => {
    expect(pclass('Evaluating SaaS for your operations team?')).toBe('unlicensed_concept');
  });
  it('6. "If you\'re looking for an agency — let\'s talk." → L1 unlicensed concept (agency), despite the if', () => {
    expect(pclass("If you're looking for an agency")).toBe('unlicensed_concept');
  });
  it('7. "If this is relevant — let\'s talk." → L2', () => {
    expect(kind('If this is relevant')).toBe('layer2_discourse');
  });
  it('8. "If you\'re deciding what to ask on the call — let\'s talk." → L2', () => {
    expect(kind("If you're deciding what to ask on the call")).toBe('layer2_discourse');
  });
  it('9. "Most founders struggle to choose the right partner." → L1', () => {
    expect(kind('Most founders struggle to choose the right partner.')).toBe('layer1_proposition');
  });
  it('10. "You may be comparing providers right now." → L1 (hedging ≠ non-propositional)', () => {
    expect(kind('You may be comparing providers right now.')).toBe('layer1_proposition');
  });
  it('11. "Thinking about who to work with?" → residual (state-attributing question), NOT auto Layer 2', () => {
    expect(kind('Thinking about who to work with?')).toBe('residual');
  });
  it('12. "If you\'re thinking about who to work with — let\'s talk." → L2', () => {
    expect(kind("If you're thinking about who to work with")).toBe('layer2_discourse');
  });

  // ── Polarity + scope: authorization is not substring presence ────────────────────────────────────
  it('polarity: "We are not an agency." does NOT license "…looking for an agency"', () => {
    expect(pclass("If you're looking for an agency", spec({ licensed: [lp('We are not an agency.')] }))).toBe('unlicensed_concept');
  });
  it('scope: "SaaS for finance teams" does NOT license "…operations team"', () => {
    expect(pclass('Evaluating SaaS for your operations team?', spec({ licensed: [lp('We build SaaS for finance teams.')] }))).toBe('unlicensed_concept');
  });
  it('authorization: a properly licensed "consulting partner" permits "Choosing a consulting partner?"', () => {
    expect(kind('Choosing a consulting partner?', spec({ licensed: [lp('We are a consulting partner for early-stage founders.')] }))).not.toBe('layer1_proposition');
  });
  it('authorization: licensed SaaS + operations teams permits "Evaluating SaaS for your operations team?"', () => {
    expect(kind('Evaluating SaaS for your operations team?', spec({ licensed: [lp('We build SaaS for operations teams.')] }))).not.toBe('layer1_proposition');
  });

  // ── Preserved behavior ───────────────────────────────────────────────────────────────────────────
  it('preserves: brevity L2, sales-process L1/stance-gated, relevance L2', () => {
    expect(classifyClause("I'll keep it short", spec()).discourseCategory).toBe('brevity_marker');
    expect(pclass('No long pitch')).toBe('operational_sales_process');
    expect(pclass('No pressure')).toBe('operational_sales_process');
    expect(classifyClause('No long pitch', spec()).licensedByStance).toBe(false);
    expect(classifyClause('No long pitch', spec({ stances: ['I do not use long sales pitches.'] })).licensedByStance).toBe(true);
  });
  it('exact vbizA reel does NOT persist under CTA-only (audience concept + sales-process caught; brevity permitted)', () => {
    const reel = content("If you're sizing up a partner, I'll keep it short. No long pitch. Book a short intro call.");
    const layered = classifyLayers(reel, spec());
    expect(layered.layer1Violations.length).toBeGreaterThan(0);
    expect(layered.permittedDiscourse.some((v) => v.discourseCategory === 'brevity_marker')).toBe(true); // "I'll keep it short"
    expect(layered.residual).toEqual([]); // the material clauses are resolved deterministically, not by Layer 3
  });
  it('the run-2 output "If you\'re deciding who to work with…" is SAFE (was a false alarm)', () => {
    expect(classifyLayers(content("If you're deciding who to work with — let's talk."), spec()).layer1Violations).toEqual([]);
  });
  it('isPermittedDiscourse post-filters Layer-3 so framing cannot be rejected', () => {
    expect(isPermittedDiscourse("I'll keep it short", spec())).toBe(true);
    expect(isPermittedDiscourse('Choosing a consulting partner?', spec())).toBe(false);
  });

  // ── Anti-collapse: distinct CTA-only forms with no unlicensed concept all pass ────────────────────
  it('anti-collapse: 3 distinct safe forms, 0 Layer-1 violations', () => {
    const forms = ['Book a short intro call.', "If you're deciding who to work with, let's talk.", 'If this is relevant, book a short intro call.'];
    for (const f of forms) expect(classifyLayers(content(f), spec()).layer1Violations.length).toBe(0);
    expect(new Set(forms).size).toBe(3);
  });

  it('splitClauses breaks a comma-joined sentence into independent clauses', () => {
    expect(splitClauses("If you're sizing up a partner, I'll keep it short.")).toEqual(["If you're sizing up a partner", "I'll keep it short."]);
  });
});
