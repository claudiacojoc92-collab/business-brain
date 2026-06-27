import { describe, it, expect, vi } from 'vitest';
import { InternalBrief } from '@bb/domain';
import type { IWeeklyCycleRepository, IInternalBriefRepository } from '@bb/domain';
import { GetCycleBriefHandler } from '../../../cycle/queries/get-cycle-brief.handler';
import type { GetCycleBriefQuery } from '../../../cycle/queries/get-cycle-brief.query';

function makeBrief(overrides: Partial<ConstructorParameters<typeof InternalBrief>[0]> = {}): InternalBrief {
  return new InternalBrief({
    id: 'brief-real-1', cycleId: 'cycle-1', founderId: 'founder-1',
    mode: 'AUTHORITY', modeConfidence: 0.875, modeReason: 'r',
    beliefTargetPrimary: 'primary', beliefTargetSecondary: null, beliefGapAddressed: 'gap',
    audienceSegment: 'early adopters', audienceTemperature: 'WARM',
    relationshipMoveType: 'NURTURE', relationshipMoveDesc: 'd',
    voiceParameters: {}, hardBlocks: [], voiceBoundaries: [], offerConstraints: [],
    convictionAngle: 'angle', audienceLanguage: {}, strategicPurpose: 'build authority',
    campaignId: null, pieceObjectives: [],
    briefConfidence: 0.64, uniquenessScore: 72, validationResult: 'PASS',
    reviewFlag: false, memoryConfidence: 0.5, recalibrationNeeded: false, isFallback: false,
    committedAt: new Date('2026-06-27T10:00:00.000Z'),
    ...overrides,
  });
}

function makeCycleRepo(cycle: unknown): IWeeklyCycleRepository {
  return { findById: vi.fn().mockResolvedValue(cycle) } as unknown as IWeeklyCycleRepository;
}
function makeBriefRepo(brief: InternalBrief | null): IInternalBriefRepository {
  return { findByCycleId: vi.fn().mockResolvedValue(brief), findByBriefId: vi.fn() } as unknown as IInternalBriefRepository;
}
const terminalCycle = { founderId: 'founder-1', isTerminal: () => true };
const query = { type: 'GetCycleBrief', cycleId: 'cycle-1', founderId: 'founder-1', correlationId: 'c', traceId: 't' } as GetCycleBriefQuery;

describe('GetCycleBriefHandler (C1 hydration)', () => {
  it('returns the real committed brief — every previously-hollow field populated', async () => {
    const handler = new GetCycleBriefHandler(makeCycleRepo(terminalCycle), makeBriefRepo(makeBrief()));
    const dto = await handler.handle(query);

    expect(dto.briefId).toBe('brief-real-1'); // real id, not brief:cycle-1
    expect(dto.modeConfidence).toBe(0.875);
    expect(dto.strategicPurpose).toBe('build authority');
    expect(dto.audienceSegment).toBe('early adopters');
    expect(dto.briefConfidence).toBe(0.64);
    expect(dto.uniquenessScore).toBe(72);
    expect(dto.validationResult).toBe('PASS');
    expect(dto.isFallback).toBe(false);
    expect(dto.committedAt).toEqual(new Date('2026-06-27T10:00:00.000Z'));
  });

  it('surfaces is_fallback + validation_result for a fallback brief', async () => {
    const brief = makeBrief({ isFallback: true, validationResult: 'FALLBACK_GENERIC_RISK' });
    const dto = await new GetCycleBriefHandler(makeCycleRepo(terminalCycle), makeBriefRepo(brief)).handle(query);
    expect(dto.isFallback).toBe(true);
    expect(dto.validationResult).toBe('FALLBACK_GENERIC_RISK');
  });

  it('no committed brief (terminal cycle, no brief row) → BRIEF_NOT_FOUND, not zeroed fields', async () => {
    const handler = new GetCycleBriefHandler(makeCycleRepo(terminalCycle), makeBriefRepo(null));
    await expect(handler.handle(query)).rejects.toMatchObject({ code: 'BRIEF_NOT_FOUND' });
  });

  it('non-terminal cycle → CYCLE_NOT_COMMITTED (brief not read)', async () => {
    const briefRepo = makeBriefRepo(makeBrief());
    const handler = new GetCycleBriefHandler(makeCycleRepo({ founderId: 'founder-1', isTerminal: () => false }), briefRepo);
    await expect(handler.handle(query)).rejects.toMatchObject({ code: 'CYCLE_NOT_COMMITTED' });
    expect(briefRepo.findByCycleId).not.toHaveBeenCalled();
  });

  it('founder-scoping: another founder\'s cycle → CYCLE_NOT_FOUND (no brief read)', async () => {
    const briefRepo = makeBriefRepo(makeBrief());
    const handler = new GetCycleBriefHandler(makeCycleRepo({ founderId: 'other-founder', isTerminal: () => true }), briefRepo);
    await expect(handler.handle(query)).rejects.toMatchObject({ code: 'CYCLE_NOT_FOUND' });
    expect(briefRepo.findByCycleId).not.toHaveBeenCalled();
  });

  it('cycle not found → CYCLE_NOT_FOUND', async () => {
    const handler = new GetCycleBriefHandler(makeCycleRepo(null), makeBriefRepo(makeBrief()));
    await expect(handler.handle(query)).rejects.toMatchObject({ code: 'CYCLE_NOT_FOUND' });
  });
});
