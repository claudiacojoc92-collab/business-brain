import { describe, it, expect } from 'vitest';
import { assertFragmentHonest, makeFragment, type EvidenceFragment } from '@bb/domain';
import { DECLARED_PATTERN, type BusinessModel } from '@bb/business-model-engine';
import { buildDeclaredFragments, declaredUri, DECLARED_FIELDS } from '../../business-model/declared';
import { buildDeclaredLines } from '../../business-model/reflection';
import { resolveDerivedFrom, enforceEpistemicCeiling } from '../../business-model/recompute';

/**
 * Capability B §6 GATE — declared types + fuses without corrupting the honesty model.
 * `declared` is the model's existing third kind; the frozen engine already supports it. These
 * tests prove the declared-evidence path flows cleanly, structurally (no LLM):
 *   1. declared fragments type `declared`, distinct from observed, through the UNCHANGED gate;
 *   2. the frozen engine sees them as declared (DECLARED_PATTERN matches the source label);
 *   3. reflection attributes declared as "you told me", never observed phrasing;
 *   4. declared + observed FUSE into one inferred claim without collapsing the kinds;
 *   5. declared cannot be the sole basis for an external-reality (marketContext) claim (ceiling).
 */
const FID = 'dev-founder';
const DIRECTION = 'We are building calm project management software for small remote teams who hate bloated enterprise tools.';
const OBSERVED = 'Trusted by thousands, we deliver enterprise project management with advanced reporting and admin controls.';

const observed = (payload: Record<string, unknown>): EvidenceFragment =>
  makeFragment({ founderId: FID, source: 'website', platform: null, sourceUrl: 'https://acme.co/', confidenceKind: 'observed', visibility: 'public', occurredAt: null, payload });

describe('Capability B §6 gate — declared evidence types + fuses', () => {
  it('1: declared fragments are typed `declared`, source founder, private, through the UNCHANGED gate', () => {
    const frags = buildDeclaredFragments(FID, [{ field: 'direction', text: DIRECTION }]);
    expect(frags.length).toBe(2); // unit + block
    const unit = frags.find((f) => f.payload?.['kind'] !== 'block')!;
    expect(unit.confidenceKind).toBe('declared');
    expect(unit.confidenceKind).not.toBe('observed');
    expect(unit.source).toBe('founder');
    expect(unit.visibility).toBe('private');
    expect(String(unit.sourceUrl)).toMatch(/^conversation:\/\//);
    // passes the unchanged honesty gate (declared requires neither sourceUrl nor derivedFrom)
    for (const f of frags) expect(() => assertFragmentHonest({ confidenceKind: f.confidenceKind, sourceUrl: f.sourceUrl, derivedFrom: f.derivedFrom, source: f.source })).not.toThrow();
  });

  it('2: the frozen engine treats the declared source as declared (DECLARED_PATTERN matches label)', () => {
    for (const f of DECLARED_FIELDS) expect(DECLARED_PATTERN.test(declaredUri(f.key))).toBe(true);
  });

  it('3: reflection attributes declared as "you told me", never as observed truth', () => {
    const frags = buildDeclaredFragments(FID, [{ field: 'direction', text: DIRECTION }]);
    const lines = buildDeclaredLines(frags);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.kind).toBe('declared');
    expect(lines[0]!.text).toMatch(/^You told me:/);
    expect(lines[0]!.text.toLowerCase()).not.toContain('your website says');
    expect(lines[0]!.text.toLowerCase()).not.toContain('your business is');
    expect(lines[0]!.fragmentIds.length).toBeGreaterThan(0); // traceable
  });

  it('4: declared + observed FUSE into one inferred claim, kinds kept distinct (no collapse)', () => {
    const declaredFrags = buildDeclaredFragments(FID, [{ field: 'direction', text: DIRECTION }]);
    const oUnit = observed({ text: OBSERVED, pageType: 'home' });
    const oBlock = observed({ kind: 'block', text: OBSERVED, blockType: 'sentence' });
    const stored = [...declaredFrags, oUnit, oBlock];

    // An inferred contradiction grounded in BOTH a declared quote and an observed quote.
    const model = {
      contradictions: [{
        statement: 'You say you\'re building calm software for small teams, but your site presents enterprise project management — a direction gap.',
        contributingFields: ['direction'],
        evidenceChain: [
          { source: declaredUri('direction'), fragment: 'calm project management software for small remote teams' },
          { source: 'https://acme.co/', fragment: 'enterprise project management with advanced reporting' },
        ],
        confidenceKind: 'inferred',
      }],
      blindSpots: [], hiddenStrengths: [], hiddenWeaknesses: [], positioningOpportunities: [], marketContext: [],
    } as unknown as BusinessModel;

    const { toPersist, rejected } = resolveDerivedFrom(FID, model, stored);
    expect(rejected).toHaveLength(0);
    expect(toPersist).toHaveLength(1);
    const derived = [...(toPersist[0]!.derivedFrom ?? [])];
    expect(derived.length).toBeGreaterThanOrEqual(2);
    // The inferred claim cites BOTH a declared fragment AND an observed fragment — fused, not collapsed.
    const kinds = new Set(derived.map((id) => stored.find((f) => f.id === id)?.confidenceKind));
    expect(kinds.has('declared')).toBe(true);
    expect(kinds.has('observed')).toBe(true);
  });

  it('5: declared cannot ground an external-reality claim — epistemic ceiling rejects it', () => {
    const model = {
      marketContext: [{ statement: 'We are the market leader in project management.', evidenceChain: [{ source: declaredUri('direction'), fragment: 'calm project management software' }] }],
      contradictions: [], blindSpots: [], hiddenStrengths: [], hiddenWeaknesses: [], positioningOpportunities: [],
    } as unknown as BusinessModel;
    const violations = enforceEpistemicCeiling(model);
    expect(violations).toHaveLength(1); // "we're the market leader" from declared intent → rejected
    expect(violations[0]!.reason).toMatch(/declared/);
  });
});
