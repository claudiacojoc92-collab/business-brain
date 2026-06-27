import { describe, it, expect } from 'vitest';
import { WeeklyCycle } from '../../../cycle/aggregates/weekly-cycle.aggregate';
import { ContentPiece } from '../../../cycle/entities/content-piece.entity';
import { ForwardQuestion } from '../../../cycle/value-objects/forward-question.vo';
import { InternalBrief } from '../../../cycle/entities/internal-brief.entity';
import { generateId } from '@bb/shared';

const NOW  = new Date('2025-01-06T04:00:00Z');
const CORR = 'corr-01';
const TRACE = 'trace-01';

function makeCycle(): WeeklyCycle {
  return WeeklyCycle.start({
    cycleId:           generateId(),
    founderId:         generateId(),
    cycleNumber:       1,
    scheduledFor:      NOW,
    contentDeliverBy:  new Date('2025-01-06T08:00:00Z'),
    campaignId:        null,
    campaignPhaseIndex:null,
    correlationId:     CORR,
    traceId:           TRACE,
  });
}

function makePiece(cycleId: string, founderId: string): ContentPiece {
  return new ContentPiece({
    id:                      generateId(),
    cycleId,
    founderId,
    briefId:                 generateId(),
    pieceType:               'REEL',
    pieceRole:               'Authority',
    contentBlobKey:          null,
    contentPreview:          null,
    approvalStatus:          'AWAITING_APPROVAL',
    approvalWindowExpiresAt: null,
    approvedAt:              null,
    rejectedAt:              null,
    rejectionReasonCode:     null,
    publishedAt:             null,
    platformPostId:          null,
  });
}

function makeBrief(cycleId: string, founderId: string, uniquenessScore = 65): InternalBrief {
  return new InternalBrief({
    id:                    generateId(),
    cycleId,
    founderId,
    mode:                  'AUTHORITY',
    modeConfidence:        0.75,
    modeReason:            'High authority foundation.',
    beliefTargetPrimary:   'That posting daily is a low-ROI signal of insecurity.',
    beliefTargetSecondary: null,
    beliefGapAddressed:    'ABSENT',
    audienceSegment:       'Growth-stage service professionals.',
    audienceTemperature:   'WARM',
    relationshipMoveType:  'CHALLENGE',
    relationshipMoveDesc:  'Challenge the daily posting dogma.',
    voiceParameters:       {},
    hardBlocks:            [],
    voiceBoundaries:       [],
    offerConstraints:      [],
    convictionAngle:       'Consistency beats volume in authority building.',
    audienceLanguage:      {},
    strategicPurpose:      'Establish authority on content strategy.',
    campaignId:            null,
    pieceObjectives:       [],
    briefConfidence:       0.74,
    uniquenessScore,
    validationResult:      'PASS',
    reviewFlag:            false,
    memoryConfidence:      0.64,
    recalibrationNeeded:   false,
    isFallback:            false,
    committedAt:           NOW,
  });
}

describe('WeeklyCycle.start', () => {
  it('creates cycle in PENDING status', () => {
    const c = makeCycle();
    expect(c.status).toBe('PENDING');
  });

  it('emits WeeklyCycleStarted event', () => {
    const c = makeCycle();
    const events = c.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe('cycle.WeeklyCycle.WeeklyCycleStarted');
  });
});

describe('WeeklyCycle.commitBrief', () => {
  it('transitions to COMMITTED and emits BriefCommitted', () => {
    const c = makeCycle();
    c.pullEvents();
    const brief = makeBrief(c.id, c.founderId);
    const result = c.commitBrief({ brief, correlationId: CORR, traceId: TRACE, now: NOW });
    expect(result.isOk).toBe(true);
    expect(c.status).toBe('COMMITTED');
    const events = c.pullEvents();
    expect(events[0]?.event_type).toBe('cycle.WeeklyCycle.BriefCommitted');
  });

  it('fails if uniquenessScore < 50', () => {
    const c = makeCycle();
    c.pullEvents();
    const brief = makeBrief(c.id, c.founderId, 45);
    const result = c.commitBrief({ brief, correlationId: CORR, traceId: TRACE, now: NOW });
    expect(result.isErr).toBe(true);
    expect(result.isErr && result.error.code).toBe('UNIQUENESS_SCORE_TOO_LOW');
  });
});

describe('WeeklyCycle.failCycle', () => {
  it('transitions to FAILED and emits WeeklyCycleFailed', () => {
    const c = makeCycle();
    c.pullEvents();
    const result = c.failCycle({
      failureReason: 'LLM API unavailable.', retryCount: 2,
      correlationId: CORR, traceId: TRACE, now: NOW,
    });
    expect(result.isOk).toBe(true);
    expect(c.status).toBe('FAILED');
    const events = c.pullEvents();
    expect(events[0]?.event_type).toBe('cycle.WeeklyCycle.WeeklyCycleFailed');
  });
});

describe('WeeklyCycle.emitIntelligenceEvents (F011)', () => {
  it('emits IntelligenceEventsEmitted and ForwardQuestionSet when fq present', () => {
    const c = makeCycle();
    c.pullEvents();
    const brief = makeBrief(c.id, c.founderId);
    c.commitBrief({ brief, correlationId: CORR, traceId: TRACE, now: NOW });
    c.pullEvents();
    const fq = new ForwardQuestion({
      question:    'Has rejection rate on CTA_AGGRESSIVE changed?',
      targetLayer: 3,
      priority:    'HIGH',
    });
    const result = c.emitIntelligenceEvents({
      intelligenceEvents: [],
      forwardQuestion:    fq,
      correlationId:      CORR,
      traceId:            TRACE,
      now:                NOW,
    });
    expect(result.isOk).toBe(true);
    const events = c.pullEvents();
    const types = events.map((e) => e.event_type);
    expect(types).toContain('cycle.WeeklyCycle.IntelligenceEventsEmitted');
    expect(types).toContain('cycle.WeeklyCycle.ForwardQuestionSet');
  });

  it('emits only IntelligenceEventsEmitted when no forward question', () => {
    const c = makeCycle();
    c.pullEvents();
    const brief = makeBrief(c.id, c.founderId);
    c.commitBrief({ brief, correlationId: CORR, traceId: TRACE, now: NOW });
    c.pullEvents();
    c.emitIntelligenceEvents({
      intelligenceEvents: [],
      forwardQuestion:    null,
      correlationId:      CORR,
      traceId:            TRACE,
      now:                NOW,
    });
    const events = c.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe('cycle.WeeklyCycle.IntelligenceEventsEmitted');
  });

  it('fails if cycle not committed', () => {
    const c = makeCycle();
    c.pullEvents();
    const result = c.emitIntelligenceEvents({
      intelligenceEvents: [], forwardQuestion: null,
      correlationId: CORR, traceId: TRACE, now: NOW,
    });
    expect(result.isErr).toBe(true);
    expect(result.isErr && result.error.code).toBe('CYCLE_NOT_COMMITTED');
  });
});

describe('WeeklyCycle approval commands', () => {
  function setupCommitted() {
    const c = makeCycle();
    c.pullEvents();
    const brief = makeBrief(c.id, c.founderId);
    c.commitBrief({ brief, correlationId: CORR, traceId: TRACE, now: NOW });
    c.pullEvents();
    const piece = makePiece(c.id, c.founderId);
    return { c, piece };
  }

  it('approveContent emits ContentApproved', () => {
    const { c, piece } = setupCommitted();
    const result = c.approveContent({
      contentPiece: piece, approvalType: 'ZERO_EDIT',
      editDistance: 0, correlationId: CORR, traceId: TRACE, now: NOW,
    });
    expect(result.isOk).toBe(true);
    expect(piece.approvalStatus).toBe('APPROVED');
    const events = c.pullEvents();
    expect(events[0]?.event_type).toBe('cycle.WeeklyCycle.ContentApproved');
  });

  it('approveContent fails if already decided', () => {
    const { c, piece } = setupCommitted();
    piece.approvalStatus = 'APPROVED';
    const result = c.approveContent({
      contentPiece: piece, approvalType: 'ZERO_EDIT',
      editDistance: 0, correlationId: CORR, traceId: TRACE, now: NOW,
    });
    expect(result.isErr).toBe(true);
    expect(result.isErr && result.error.code).toBe('PIECE_ALREADY_DECIDED');
  });

  it('editAndApproveContent emits ContentEdited per edit then ContentApproved', () => {
    const { c, piece } = setupCommitted();
    const result = c.editAndApproveContent({
      contentPiece: piece,
      edits: [
        {
          editId:              generateId(),
          editType:            'VOICE_CORRECTION',
          originalFragment:    'we believe',
          replacementFragment: 'I believe',
        },
      ],
      correlationId: CORR, traceId: TRACE, now: NOW,
    });
    expect(result.isOk).toBe(true);
    const events = c.pullEvents();
    const types = events.map((e) => e.event_type);
    expect(types).toContain('cycle.WeeklyCycle.ContentEdited');
    expect(types).toContain('cycle.WeeklyCycle.ContentApproved');
  });

  it('rejectContent emits ContentRejected with correct reason code (F003)', () => {
    const { c, piece } = setupCommitted();
    const result = c.rejectContent({
      contentPiece:     piece,
      reasonCode:       'VOICE_MISMATCH',
      hardBoundaryFlag: false,
      correlationId:    CORR,
      traceId:          TRACE,
      now:              NOW,
    });
    expect(result.isOk).toBe(true);
    expect(piece.approvalStatus).toBe('REJECTED');
    const events = c.pullEvents();
    expect(events[0]?.event_type).toBe('cycle.WeeklyCycle.ContentRejected');
  });

  it('rejectContent fails if already decided (no double-action)', () => {
    const { c, piece } = setupCommitted();
    piece.approvalStatus = 'REJECTED';
    const result = c.rejectContent({
      contentPiece: piece, reasonCode: 'VOICE_MISMATCH', hardBoundaryFlag: false,
      correlationId: CORR, traceId: TRACE, now: NOW,
    });
    expect(result.isErr).toBe(true);
    expect(result.isErr && result.error.code).toBe('PIECE_ALREADY_DECIDED');
    expect(c.pullEvents()).toHaveLength(0);
  });

  it('editAndApproveContent fails if already decided (edit-after-final-state)', () => {
    const { c, piece } = setupCommitted();
    piece.approvalStatus = 'APPROVED';
    const result = c.editAndApproveContent({
      contentPiece: piece,
      edits: [{
        editId: generateId(), editType: 'VOICE_CORRECTION',
        originalFragment: 'we believe', replacementFragment: 'I believe',
      }],
      correlationId: CORR, traceId: TRACE, now: NOW,
    });
    expect(result.isErr).toBe(true);
    expect(result.isErr && result.error.code).toBe('PIECE_ALREADY_DECIDED');
    expect(c.pullEvents()).toHaveLength(0);
  });
});
