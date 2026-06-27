import { describe, it, expect, vi } from 'vitest';
import { InternalBrief } from '@bb/domain';
import {
  ContentExecutionService,
  resolvePieceSpecs,
  extractCtaStyle,
  buildNeverList,
  extractAvoidPhrases,
  ContentExecutionError,
  type LlmCaller,
  type ContentExecutionConfig,
} from '../../content-delivery/content-execution.service';

function makeBrief(overrides: Partial<ConstructorParameters<typeof InternalBrief>[0]> = {}): InternalBrief {
  return new InternalBrief({
    id:                    'brief-1',
    cycleId:               'cycle-1',
    founderId:             'founder-1',
    mode:                  'AUTHORITY',
    modeConfidence:        0.8,
    modeReason:            'reason',
    beliefTargetPrimary:   'belief-primary',
    beliefTargetSecondary: null,
    beliefGapAddressed:    'gap',
    audienceSegment:       'segment',
    audienceTemperature:   'WARM',
    relationshipMoveType:  'NURTURE',
    relationshipMoveDesc:  'desc',
    voiceParameters:       { cta_style: 'INVITATION' },
    hardBlocks:            [],
    voiceBoundaries:       [],
    offerConstraints:      [],
    convictionAngle:       'the angle',
    audienceLanguage:      { primary_phrases: ['lets go'], avoid_phrases: [] },
    strategicPurpose:      'purpose',
    campaignId:            null,
    pieceObjectives:       [
      { role: 'REEL', objective: 'r1' },
      { role: 'REEL', objective: 'r2' },
      { role: 'REEL', objective: 'r3' },
      { role: 'CAROUSEL', objective: 'c1' },
      { role: 'CAROUSEL', objective: 'c2' },
    ],
    briefConfidence:       0.64,
    uniquenessScore:       72,
    validationResult:      'PASS',
    reviewFlag:            false,
    memoryConfidence:      0.5,
    recalibrationNeeded:   false,
    isFallback:            false,
    committedAt:           new Date('2026-06-27T10:00:00.000Z'),
    ...overrides,
  });
}

/** Builds a schema-valid output for whatever piece the prompt asked for. */
function validOutputFor(po: { piece_id: string; format: string; belief_target_ref: string }, cta: string | null = 'Come join us') {
  if (po.format === 'REEL') {
    return {
      piece_id: po.piece_id, format: 'REEL',
      hook: 'A strong hook', script: 'The script body',
      talking_points: ['point one here', 'point two here', 'point three here'],
      caption: 'A caption', cta, belief_target_ref: po.belief_target_ref,
    };
  }
  return {
    piece_id: po.piece_id, format: 'CAROUSEL',
    slides: Array.from({ length: 5 }, (_v, i) => ({ slide_number: i + 1, role: 'SLIDE', copy: `slide ${i + 1} copy` })),
    caption: 'A caption', cta, belief_target_ref: po.belief_target_ref,
  };
}

/** LlmCaller that returns a valid piece for each request (parses the PIECE_OBJECTIVE var). */
function validLlm(cta: string | null = 'Come join us'): LlmCaller {
  return {
    call: vi.fn(async ({ variables }) => {
      const po = JSON.parse(variables.PIECE_OBJECTIVE!);
      return { content: JSON.stringify(validOutputFor(po, cta)) };
    }),
  };
}

const silentLogger = { info: vi.fn(), warn: vi.fn() };

function cfg(overrides: Partial<ContentExecutionConfig> = {}): ContentExecutionConfig {
  return { maxRegenPerPiece: 2, wallClockMs: 90 * 60 * 1000, now: () => 0, ...overrides };
}

describe('ContentExecutionService — happy path', () => {
  it('generates one AWAITING_APPROVAL piece per objective, by priority', async () => {
    const llm = validLlm();
    const svc = new ContentExecutionService(llm, silentLogger, cfg());
    const pieces = await svc.execute(makeBrief());

    expect(pieces).toHaveLength(5);
    expect(pieces.filter((p) => p.pieceType === 'REEL')).toHaveLength(3);
    expect(pieces.filter((p) => p.pieceType === 'CAROUSEL')).toHaveLength(2);
    for (const p of pieces) {
      expect(p.approvalStatus).toBe('AWAITING_APPROVAL');
      expect(p.cycleId).toBe('cycle-1');
      expect(p.briefId).toBe('brief-1');
      expect(p.contentPreview).toBeTruthy();
      expect(() => JSON.parse(p.contentPreview as string)).not.toThrow();
    }
    expect((llm.call as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(5);
  });
});

describe('ContentExecutionService — piece_objectives derivation', () => {
  it('derives format + sequential piece_id from {role}', () => {
    const specs = resolvePieceSpecs(makeBrief());
    expect(specs.map((s) => s.pieceId)).toEqual(['R1', 'R2', 'R3', 'C1', 'C2']);
    expect(specs.map((s) => s.format)).toEqual(['REEL', 'REEL', 'REEL', 'CAROUSEL', 'CAROUSEL']);
  });

  it('orders by a numeric priority field when present', () => {
    const specs = resolvePieceSpecs(makeBrief({
      pieceObjectives: [
        { role: 'REEL', objective: 'low', priority: 3 },
        { role: 'REEL', objective: 'high', priority: 1 },
        { role: 'CAROUSEL', objective: 'mid', priority: 2 },
      ],
    }));
    expect(specs.map((s) => s.objective)).toEqual(['high', 'mid', 'low']);
    // piece_id assigned in priority order, per format
    expect(specs.map((s) => s.pieceId)).toEqual(['R1', 'C1', 'R2']);
  });

  it('uses a per-objective belief ref when present, else the brief primary', () => {
    const specs = resolvePieceSpecs(makeBrief({
      pieceObjectives: [
        { role: 'REEL', objective: 'a', belief_target_ref: 'belief-X' },
        { role: 'REEL', objective: 'b' },
      ],
    }));
    expect(specs[0]!.beliefTargetRef).toBe('belief-X');
    expect(specs[1]!.beliefTargetRef).toBe('belief-primary');
  });

  it('throws UNRESOLVABLE_PIECE_OBJECTIVE when format cannot be determined', () => {
    expect(() => resolvePieceSpecs(makeBrief({ pieceObjectives: [{ role: 'BLOG', objective: 'x' }] })))
      .toThrowError(/UNRESOLVABLE_PIECE_OBJECTIVE/);
  });

  it('throws TOO_MANY_REELS beyond 3 reels', () => {
    expect(() => resolvePieceSpecs(makeBrief({
      pieceObjectives: [
        { role: 'REEL' }, { role: 'REEL' }, { role: 'REEL' }, { role: 'REEL' },
      ],
    }))).toThrowError(/TOO_MANY_REELS/);
  });

  it('throws TOO_MANY_CAROUSELS beyond 2 carousels', () => {
    expect(() => resolvePieceSpecs(makeBrief({
      pieceObjectives: [{ role: 'CAROUSEL' }, { role: 'CAROUSEL' }, { role: 'CAROUSEL' }],
    }))).toThrowError(/TOO_MANY_CAROUSELS/);
  });

  it('execute() fails the job (throws) on an unresolvable objective — nothing returned', async () => {
    const svc = new ContentExecutionService(validLlm(), silentLogger, cfg());
    await expect(svc.execute(makeBrief({ pieceObjectives: [{ role: 'BLOG' }] })))
      .rejects.toBeInstanceOf(ContentExecutionError);
  });
});

describe('ContentExecutionService — NEVER-list (no retry)', () => {
  it('throws on a NEVER-list hit and does NOT retry', async () => {
    const llm: LlmCaller = {
      call: vi.fn(async ({ variables }) => {
        const po = JSON.parse(variables.PIECE_OBJECTIVE!);
        const out = validOutputFor(po);
        out.caption = 'this contains forbidden text';
        return { content: JSON.stringify(out) };
      }),
    };
    const brief = makeBrief({ hardBlocks: ['forbidden'], pieceObjectives: [{ role: 'REEL', objective: 'a' }] });
    const svc = new ContentExecutionService(llm, silentLogger, cfg());

    await expect(svc.execute(brief)).rejects.toThrowError(/NEVER_LIST_VIOLATION/);
    expect((llm.call as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1); // no retry
  });
});

describe('ContentExecutionService — retry / budget', () => {
  it('regenerates on a PII placeholder and succeeds within budget', async () => {
    let n = 0;
    const llm: LlmCaller = {
      call: vi.fn(async ({ variables }) => {
        const po = JSON.parse(variables.PIECE_OBJECTIVE!);
        const out = validOutputFor(po);
        n += 1;
        if (n === 1) out.script = 'Hi [FOUNDER_NAME]'; // first attempt leaks a placeholder
        return { content: JSON.stringify(out) };
      }),
    };
    const svc = new ContentExecutionService(llm, silentLogger, cfg());
    const pieces = await svc.execute(makeBrief({ pieceObjectives: [{ role: 'REEL', objective: 'a' }] }));
    expect(pieces).toHaveLength(1);
    expect((llm.call as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2); // regenerated once
  });

  it('throws REGEN_EXHAUSTED after maxRegenPerPiece regenerations', async () => {
    const llm: LlmCaller = {
      call: vi.fn(async ({ variables }) => {
        const po = JSON.parse(variables.PIECE_OBJECTIVE!);
        const out = validOutputFor(po);
        out.script = 'Hi [FOUNDER_NAME]'; // always leaks → always REGENERATE
        return { content: JSON.stringify(out) };
      }),
    };
    const svc = new ContentExecutionService(llm, silentLogger, cfg({ maxRegenPerPiece: 2 }));
    await expect(svc.execute(makeBrief({ pieceObjectives: [{ role: 'REEL' }] })))
      .rejects.toThrowError(/REGEN_EXHAUSTED/);
    expect((llm.call as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('bounded-retries a schema failure then succeeds', async () => {
    let n = 0;
    const llm: LlmCaller = {
      call: vi.fn(async ({ variables }) => {
        n += 1;
        if (n === 1) return { content: 'not valid json' };
        const po = JSON.parse(variables.PIECE_OBJECTIVE!);
        return { content: JSON.stringify(validOutputFor(po)) };
      }),
    };
    const svc = new ContentExecutionService(llm, silentLogger, cfg());
    const pieces = await svc.execute(makeBrief({ pieceObjectives: [{ role: 'REEL' }] }));
    expect(pieces).toHaveLength(1);
    expect((llm.call as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it('short-circuits when the wall-clock deadline is exceeded', async () => {
    const times = [0, 0, 5000]; // start, piece1 ok, piece2 past deadline
    const svc = new ContentExecutionService(validLlm(), silentLogger, cfg({
      wallClockMs: 1000,
      now: () => (times.length > 1 ? times.shift()! : 5000),
    }));
    await expect(svc.execute(makeBrief({
      pieceObjectives: [{ role: 'REEL', objective: 'a' }, { role: 'REEL', objective: 'b' }],
    }))).rejects.toThrowError(/CONTENT_GENERATION_TIMEOUT/);
  });
});

describe('ContentExecutionService — brief extractors', () => {
  it('extractCtaStyle reads voice_parameters.cta_style, defaults to INVITATION', () => {
    expect(extractCtaStyle(makeBrief({ voiceParameters: { cta_style: 'NONE' } }))).toBe('NONE');
    expect(extractCtaStyle(makeBrief({ voiceParameters: {} }))).toBe('INVITATION');
  });

  it('buildNeverList unions hard_blocks and voice_boundaries', () => {
    const list = buildNeverList(makeBrief({ hardBlocks: ['a'], voiceBoundaries: ['b'] }));
    expect(list).toEqual(['a', 'b']);
  });

  it('extractAvoidPhrases reads audience_language.avoid_phrases', () => {
    expect(extractAvoidPhrases(makeBrief({ audienceLanguage: { avoid_phrases: ['x', 'y'] } }))).toEqual(['x', 'y']);
    expect(extractAvoidPhrases(makeBrief({ audienceLanguage: {} }))).toEqual([]);
  });
});
