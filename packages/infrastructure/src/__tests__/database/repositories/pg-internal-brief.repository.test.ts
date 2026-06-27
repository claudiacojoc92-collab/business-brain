import { describe, it, expect, vi } from 'vitest';
import { PgInternalBriefRepository } from '../../../database/repositories/pg-internal-brief.repository';

/** A row as pg returns it: NUMERIC confidences are STRINGS; JSONB is pre-parsed. */
function makeBriefRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id:                      'brief-1',
    cycle_id:                'cycle-1',
    founder_id:              'founder-1',
    mode:                    'AUTHORITY',
    mode_confidence:         '0.875',
    mode_reason:             'high signal density',
    belief_target_primary:   'primary belief',
    belief_target_secondary: null,
    belief_gap_addressed:    'the gap',
    audience_segment:        'early adopters',
    audience_temperature:    'WARM',
    relationship_move_type:  'NURTURE',
    relationship_move_desc:  'deepen trust',
    voice_parameters:        { tone: 'direct' },
    hard_blocks:             ['no jargon'],
    voice_boundaries:        ['stay humble'],
    offer_constraints:       ['no discount'],
    conviction_angle:        'the angle',
    audience_language:       { warm: ['friend'] },
    strategic_purpose:       'build authority',
    campaign_id:             null,
    piece_objectives:        [
      { priority: 1, piece_type: 'REEL', objective: 'hook' },
      { priority: 2, piece_type: 'CAROUSEL', objective: 'educate' },
    ],
    brief_confidence:        '0.640',
    uniqueness_score:        72,
    validation_result:       'PASS',
    review_flag:             false,
    memory_confidence:       '0.500',
    recalibration_needed:    false,
    is_fallback:             false,
    committed_at:            '2026-06-27T10:00:00.000Z',
    ...overrides,
  };
}

function makeMockDb(row: unknown) {
  const executeTakeFirst = vi.fn().mockResolvedValue(row);
  const where = vi.fn().mockReturnThis();
  const selectAll = vi.fn().mockReturnThis();
  const selectFrom = vi.fn().mockReturnValue({ selectAll, where, executeTakeFirst });
  return { db: { selectFrom } as never, selectFrom, where };
}

describe('PgInternalBriefRepository', () => {
  describe('findByCycleId', () => {
    it('maps a populated brief including piece_objectives', async () => {
      const { db, selectFrom, where } = makeMockDb(makeBriefRow());
      const repo = new PgInternalBriefRepository(db);

      const brief = await repo.findByCycleId('cycle-1');

      expect(selectFrom).toHaveBeenCalledWith('cycle.internal_briefs');
      expect(where).toHaveBeenCalledWith('cycle_id', '=', 'cycle-1');
      expect(brief).not.toBeNull();
      expect(brief!.id).toBe('brief-1');
      expect(brief!.cycleId).toBe('cycle-1');
      expect(brief!.founderId).toBe('founder-1');
      expect(brief!.mode).toBe('AUTHORITY');
      expect(brief!.beliefTargetSecondary).toBeNull();
      expect(brief!.campaignId).toBeNull();
      expect(brief!.voiceParameters).toEqual({ tone: 'direct' });
      expect(brief!.hardBlocks).toEqual(['no jargon']);
      expect(brief!.audienceLanguage).toEqual({ warm: ['friend'] });
      expect(brief!.pieceObjectives).toHaveLength(2);
      expect(brief!.pieceObjectives).toEqual([
        { priority: 1, piece_type: 'REEL', objective: 'hook' },
        { priority: 2, piece_type: 'CAROUSEL', objective: 'educate' },
      ]);
      expect(brief!.isFallback).toBe(false);
      expect(brief!.committedAt).toBeInstanceOf(Date);
    });

    it('Number()-converts every NUMERIC confidence field (not strings)', async () => {
      const { db } = makeMockDb(makeBriefRow());
      const repo = new PgInternalBriefRepository(db);

      const brief = await repo.findByCycleId('cycle-1');

      expect(typeof brief!.modeConfidence).toBe('number');
      expect(typeof brief!.briefConfidence).toBe('number');
      expect(typeof brief!.memoryConfidence).toBe('number');
      expect(typeof brief!.uniquenessScore).toBe('number');
      expect(brief!.modeConfidence).toBe(0.875);
      expect(brief!.briefConfidence).toBe(0.64);
      expect(brief!.memoryConfidence).toBe(0.5);
      expect(brief!.uniquenessScore).toBe(72);
    });

    it('returns null when no committed brief exists', async () => {
      const { db } = makeMockDb(undefined);
      const repo = new PgInternalBriefRepository(db);

      expect(await repo.findByCycleId('missing')).toBeNull();
    });
  });

  describe('findByBriefId', () => {
    it('maps a populated brief by brief id', async () => {
      const { db, where } = makeMockDb(makeBriefRow({ id: 'brief-9' }));
      const repo = new PgInternalBriefRepository(db);

      const brief = await repo.findByBriefId('brief-9');

      expect(where).toHaveBeenCalledWith('id', '=', 'brief-9');
      expect(brief!.id).toBe('brief-9');
      expect(brief!.pieceObjectives).toHaveLength(2);
    });

    it('returns null when no brief exists for the id', async () => {
      const { db } = makeMockDb(undefined);
      const repo = new PgInternalBriefRepository(db);

      expect(await repo.findByBriefId('missing')).toBeNull();
    });
  });
});
