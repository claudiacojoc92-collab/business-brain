import { describe, it, expect } from 'vitest';
import { validateAha2, assertAha2WellFormed, type Aha2Output, type Aha2Refs } from '../../conversation/index';

// Typed founder refs: ref → founder-state kind (needed for state→claim-type compatibility).
const REFS: Aha2Refs = {
  business: new Set(['B1', 'B2', 'B3']),
  founder: new Map([
    ['F1', 'preference'],
    ['F2', 'goal'],
    ['F3', 'constraint'],
    ['F4', 'resource'],
    ['F5', 'intention'],
  ]),
  observation: new Set(['O1']),
};
const ok = (implication: string, businessRefs: string[], founderRefs: string[], observationRefs: string[] = []): Aha2Output => ({
  findings: [{ implication, businessRefs, founderRefs, observationRefs }],
});
const status = (implication: string, b: string[], f: string[]) => validateAha2(ok(implication, b, f), REFS).status;

describe('validateAha2 — cross-source + claim discipline', () => {
  it('passes a genuine business × founder synthesis', () => {
    const out = ok(
      'You want growth without depending on your personal visibility, but the site’s positioning is built around your own expertise, so the strategy will need a different way to prove quality.',
      ['B1'], ['F1'],
    );
    const v = validateAha2(out, REFS);
    expect(v.status).toBe('produced');
    expect(v.findings[0]?.businessRefs).toEqual(['B1']);
    expect(v.findings[0]?.founderRefs).toEqual(['F1']);
  });

  it('rejects a business-only "synthesis" (no founder ref)', () => {
    expect(status('The homepage and pricing page describe the offer differently.', ['B1'], [])).toBe('insufficient');
  });

  it('rejects a founder-only "synthesis" (no business ref)', () => {
    expect(status('You want twenty qualified leads in three months.', [], ['F1'])).toBe('insufficient');
  });

  it('drops psychology / hidden-motive claims (EN/RO/IT)', () => {
    expect(status('This suggests a deep fear of losing control over quality.', ['B1'], ['F1'])).toBe('insufficient');
    expect(status('Asta arată o frică de a pierde controlul.', ['B1'], ['F1'])).toBe('insufficient');
    expect(status('Questo rivela una paura di perdere il controllo.', ['B1'], ['F1'])).toBe('insufficient');
  });

  it('drops market/behavioral claims even when cross-source', () => {
    expect(status('Because you want growth, this will differentiate you from competitors.', ['B1'], ['F1'])).toBe('insufficient');
    expect(status('Given your goal, surfacing this will increase conversion.', ['B1'], ['F1'])).toBe('insufficient');
  });

  it('fails Aha 2 when it CHOOSES strategy (channel/tactic/bet selection)', () => {
    expect(status('You want more clients, therefore you should focus on Instagram.', ['B1'], ['F1'])).toBe('insufficient');
    expect(status('Given your capacity, you need to concentrate on one acquisition channel.', ['B1'], ['F4'])).toBe('insufficient');
    expect(status('You want growth without personal content, so the best strategy is founder-led video.', ['B1'], ['F1'])).toBe('insufficient');
    expect(status('Your capacity will need to concentrate on the highest-leverage single channel.', ['B1'], ['F4'])).toBe('insufficient');
    expect(status('Vrei creștere, deci ar trebui să te concentrezi pe un singur canal.', ['B1'], ['F1'])).toBe('insufficient');
    expect(status('Vuoi crescita, quindi dovresti concentrarti su un solo canale.', ['B1'], ['F1'])).toBe('insufficient');
  });

  it('PASSES Aha 2 when it only CONSTRAINS strategy (tension / boundary / requirement)', () => {
    expect(status('Any strategy we build cannot depend on daily founder-led video because you explicitly ruled that out.', ['B1'], ['F3'])).toBe('produced');
    expect(status('The business currently leans on your personal expertise, while you want growth not to depend on your visibility — a constraint any strategy will have to solve.', ['B1'], ['F1'])).toBe('produced');
    expect(status('There is a tension between your limited weekly capacity and the amount of content the site currently maintains.', ['B1'], ['F4'])).toBe('produced');
  });

  it('fails Aha 2 when it PREDICTS outcomes rather than describing structure', () => {
    expect(status('You want retainer work, and the current homepage will generate leads once shared.', ['B1'], ['F2'])).toBe('insufficient');
    expect(status('Because you want clients, the site as-is cannot fill the pipeline.', ['B1'], ['F2'])).toBe('insufficient');
    // Describing the conversion PATH (not the outcome) is allowed.
    expect(status('You want inbound clients, but the site gives visitors no obvious next action toward contacting you.', ['B1'], ['F2'])).toBe('produced');
  });

  describe('founder-state → claim-type compatibility', () => {
    it('PREFERENCE: "you prefer X while site is broad" passes; "X is your primary segment" fails', () => {
      expect(status('Any strategy we build needs to account for your preference for healthcare events while the site currently speaks to a much broader audience.', ['B1'], ['F1'])).toBe('produced');
      expect(status('Healthcare is therefore your primary segment.', ['B1'], ['F1'])).toBe('insufficient');
      expect(status('You should specialize in healthcare.', ['B1'], ['F1'])).toBe('insufficient');
      // The live leak: a channel preference "points toward a specific segment".
      expect(status('Your preference for healthcare events points toward a specific segment the site does not center.', ['B1'], ['F1'])).toBe('insufficient');
    });

    it('CONSTRAINT: "strategy cannot require Y" passes; "Y does not work for this audience" fails', () => {
      expect(status('Strategy cannot depend on daily founder-led video because you ruled it out, and the site currently leans on that kind of personal presence.', ['B1'], ['F3'])).toBe('produced');
      expect(status('Founder video does not work for this audience, given the site’s current framing.', ['B1'], ['F3'])).toBe('insufficient');
    });

    it('RESOURCE: "must fit within five hours" passes; "you therefore need one channel" fails', () => {
      expect(status('Any strategy must fit within the five hours you have available while the site maintains a large content surface.', ['B1'], ['F4'])).toBe('produced');
      expect(status('You therefore need one channel.', ['B1'], ['F4'])).toBe('insufficient');
    });

    it('GOAL: "judged against the recurring-client goal" passes; "retainers are the best business model" fails', () => {
      expect(status('The strategy must be judged against your recurring-client goal, and the site does not currently make that path obvious.', ['B1'], ['F2'])).toBe('produced');
      expect(status('Retainers are the best business model.', ['B1'], ['F2'])).toBe('insufficient');
    });

    it('a target claim IS licensed when a target-owning kind (goal/intention) is cited', () => {
      expect(status('You want healthcare companies to be your primary clients, but the site speaks to a much broader audience — a gap any strategy must close.', ['B1'], ['F5'])).toBe('produced');
    });

    it('rejects target upgrades in RO / IT when only a preference is cited', () => {
      expect(status('Sănătatea este segmentul tău principal.', ['B1'], ['F1'])).toBe('insufficient');
      expect(status('La sanità è quindi il tuo segmento principale.', ['B1'], ['F1'])).toBe('insufficient');
    });
  });

  it('drops findings whose refs do not resolve (fail closed)', () => {
    expect(status('You want X and the business does Y, so the strategy needs Z.', ['B9'], ['F9'])).toBe('insufficient');
  });

  it('strips internal ref tokens the model echoed into founder-facing prose', () => {
    const out = ok(
      'You want more volume (F1), but the site’s positioning is built around your expertise (B1, B2), so the strategy will need another path.',
      ['B1', 'B2'], ['F1'],
    );
    const v = validateAha2(out, REFS);
    expect(v.status).toBe('produced');
    expect(v.findings[0]?.implication).not.toMatch(/\([BFO]\d/);
    expect(v.findings[0]?.implication).toContain('another path');
  });

  it('assertAha2WellFormed throws on malformed output', () => {
    expect(() => assertAha2WellFormed(null)).toThrow();
    expect(() => assertAha2WellFormed({} as unknown as Aha2Output)).toThrow();
  });
});
