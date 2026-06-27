import { describe, it, expect } from 'vitest';
import {
  validateContentOutput,
  checkNeverList,
  checkCtaConsistency,
  checkPiiPlaceholders,
  checkAudienceAvoidance,
  checkPieceSetCompleteness,
  collectPieceStrings,
  type ContentValidationContext,
} from '../../content-delivery/content-validators';
import type { ReelOutput, CarouselOutput } from '../../content-delivery/content-schemas';

function validReel(overrides: Partial<ReelOutput> = {}): ReelOutput {
  return {
    piece_id:          'R1',
    format:            'REEL',
    hook:              'Most advice keeps you busy, not booked.',
    script:            'Here is the shift that actually changes your week.',
    talking_points:    ['First, name the real bottleneck', 'Then remove one step', 'Measure what changed'],
    caption:           'A short read on focus.',
    cta:               'Book a discovery call',
    belief_target_ref: 'belief-1',
    ...overrides,
  };
}

function validCarousel(overrides: Partial<CarouselOutput> = {}): CarouselOutput {
  return {
    piece_id:          'C1',
    format:            'CAROUSEL',
    slides: [
      { slide_number: 1, role: 'HOOK', copy: 'The myth you were sold' },
      { slide_number: 2, role: 'PROBLEM', copy: 'Why it keeps failing' },
      { slide_number: 3, role: 'INSIGHT', copy: 'The reframe' },
      { slide_number: 4, role: 'PROOF', copy: 'What it looks like in practice' },
      { slide_number: 5, role: 'CLOSE', copy: 'Where to start' },
    ],
    caption:           'Five slides on positioning.',
    cta:               null,
    belief_target_ref: 'belief-2',
    ...overrides,
  };
}

const baseCtx: ContentValidationContext = { neverList: [], ctaStyle: 'DIRECT', audienceAvoidPhrases: [] };

describe('validateContentOutput — schema (§8 parse/schema/bounds)', () => {
  it('passes a valid reel', async () => {
    const res = await validateContentOutput(JSON.stringify(validReel()), baseCtx);
    expect(res.severity).toBe('PASS');
    expect(res.piece?.piece_id).toBe('R1');
  });

  it('passes a valid carousel (cta_style NONE, cta null)', async () => {
    const res = await validateContentOutput(JSON.stringify(validCarousel()), { ...baseCtx, ctaStyle: 'NONE' });
    expect(res.severity).toBe('PASS');
    expect(res.piece?.format).toBe('CAROUSEL');
  });

  it('strips markdown fences before parsing', async () => {
    const fenced = '```json\n' + JSON.stringify(validReel()) + '\n```';
    const res = await validateContentOutput(fenced, baseCtx);
    expect(res.severity).toBe('PASS');
  });

  it('REGENERATEs on invalid JSON', async () => {
    const res = await validateContentOutput('not json', baseCtx);
    expect(res.severity).toBe('REGENERATE');
    expect(res.piece).toBeNull();
  });

  it('REGENERATEs on a missing required field', async () => {
    const noHook: Record<string, unknown> = { ...validReel() };
    delete noHook.hook;
    const res = await validateContentOutput(JSON.stringify(noHook), baseCtx);
    expect(res.severity).toBe('REGENERATE');
  });

  it('REGENERATEs on a bad enum (piece_id)', async () => {
    const res = await validateContentOutput(JSON.stringify(validReel({ piece_id: 'R9' as never })), baseCtx);
    expect(res.severity).toBe('REGENERATE');
  });

  it('REGENERATEs when talking_points are out of bounds (2 < 3)', async () => {
    const res = await validateContentOutput(JSON.stringify(validReel({ talking_points: ['a', 'b'] })), baseCtx);
    expect(res.severity).toBe('REGENERATE');
  });

  it('REGENERATEs when talking_points exceed 6', async () => {
    const res = await validateContentOutput(
      JSON.stringify(validReel({ talking_points: ['1', '2', '3', '4', '5', '6', '7'] })),
      baseCtx,
    );
    expect(res.severity).toBe('REGENERATE');
  });

  it('REGENERATEs when carousel slides are out of bounds (4 < 5)', async () => {
    const res = await validateContentOutput(
      JSON.stringify(validCarousel({ slides: validCarousel().slides.slice(0, 4) })),
      { ...baseCtx, ctaStyle: 'NONE' },
    );
    expect(res.severity).toBe('REGENERATE');
  });
});

describe('NEVER-list (§8 hard, no retry)', () => {
  it('FAILS_NO_RETRY when an output string contains a blocked phrase', async () => {
    const res = await validateContentOutput(
      JSON.stringify(validReel({ caption: 'We guarantee results fast' })),
      { ...baseCtx, neverList: ['guarantee results'] },
    );
    expect(res.severity).toBe('FAIL_NO_RETRY');
    expect(res.issues[0]!.rule).toBe('NEVER_LIST');
  });

  it('is case-insensitive and pure', () => {
    const issues = checkNeverList(validReel({ hook: 'BIG PROMISE here' }), ['big promise']);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('FAIL_NO_RETRY');
  });

  it('an avoid phrase that is also a NEVER-list entry resolves to FAIL_NO_RETRY (precedence)', async () => {
    const res = await validateContentOutput(
      JSON.stringify(validReel({ caption: 'literally the best' })),
      { ...baseCtx, neverList: ['literally'], audienceAvoidPhrases: ['literally'] },
    );
    expect(res.severity).toBe('FAIL_NO_RETRY');
  });
});

describe('CTA consistency (§8 both directions)', () => {
  it('REGENERATEs when cta_style is NONE but a cta is present', () => {
    const issues = checkCtaConsistency(validReel({ cta: 'Buy now' }), 'NONE');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('REGENERATE');
  });

  it('REGENERATEs when cta_style requires a cta but it is null', () => {
    const issues = checkCtaConsistency(validReel({ cta: null }), 'DIRECT');
    expect(issues).toHaveLength(1);
  });

  it('passes when cta_style and cta agree (NONE → null)', () => {
    expect(checkCtaConsistency(validReel({ cta: null }), 'NONE')).toHaveLength(0);
  });

  it('passes when cta_style and cta agree (DIRECT → non-empty)', () => {
    expect(checkCtaConsistency(validReel({ cta: 'Apply today' }), 'DIRECT')).toHaveLength(0);
  });
});

describe('PII placeholders (§8)', () => {
  it('REGENERATEs when a placeholder token leaks into output', async () => {
    const res = await validateContentOutput(
      JSON.stringify(validReel({ script: 'Hi [FOUNDER_NAME], welcome' })),
      baseCtx,
    );
    expect(res.severity).toBe('REGENERATE');
    expect(res.issues.some((i) => i.rule === 'PII_PLACEHOLDER')).toBe(true);
  });

  it('pure detector finds no placeholders in clean output', () => {
    expect(checkPiiPlaceholders(validReel())).toHaveLength(0);
  });
});

describe('audience-language avoidance (§8 regenerate)', () => {
  it('REGENERATEs when an avoid phrase is used', () => {
    const issues = checkAudienceAvoidance(validReel({ caption: 'unlock your potential' }), ['unlock your potential']);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('REGENERATE');
  });
});

describe('completeness (Phase-D wired; pure here)', () => {
  it('flags missing pieces', () => {
    const issues = checkPieceSetCompleteness(['R1', 'R2'], ['R1', 'R2', 'R3', 'C1', 'C2']);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.detail).toContain('R3');
  });

  it('passes a complete set', () => {
    expect(checkPieceSetCompleteness(['R1', 'C1'], ['R1', 'C1'])).toHaveLength(0);
  });
});

describe('collectPieceStrings', () => {
  it('gathers reel strings incl. talking points', () => {
    const strings = collectPieceStrings(validReel());
    expect(strings).toContain('Most advice keeps you busy, not booked.');
    expect(strings).toContain('Measure what changed');
  });

  it('gathers carousel slide copy and omits null cta', () => {
    const strings = collectPieceStrings(validCarousel());
    expect(strings).toContain('The reframe');
    expect(strings).not.toContain(null as never);
  });
});
