import {
  ok, err,
  type Result,
  type MarketingMode,
  type RejectionReasonCode,
  type EditType,
} from '@bb/shared';
import { AggregateRoot } from '../../shared/aggregate-root';
import { PreconditionFailed, ConflictError } from '../../shared/domain-error';
import type { ContentPiece } from '../entities/content-piece.entity';
import type { InternalBrief } from '../entities/internal-brief.entity';
import type { ForwardQuestion } from '../value-objects/forward-question.vo';
import {
  buildWeeklyCycleStartedEvent,
  buildSituationModelUpdatedEvent,
  buildProvisionalDecisionMadeEvent,
  buildCritiqueCompletedEvent,
  buildBriefCommittedEvent,
  buildFallbackBriefCommittedEvent,
  buildWeeklyCycleFailedEvent,
  buildIntelligenceEventsEmittedEvent,
  buildForwardQuestionSetEvent,
  buildContentApprovedEvent,
  buildContentEditedEvent,
  buildContentRejectedEvent,
} from '../events';
import type {
  IntelligenceEventPayload,
  CritiqueOutcome,
} from '../events/cycle-event-types';

export type CycleStatus =
  | 'PENDING'
  | 'COLLECTING'
  | 'REASONING'
  | 'CRITIQUE'
  | 'COMMITTING'
  | 'COMMITTED'
  | 'FAILED'
  | 'FALLBACK_COMMITTED';

export interface WeeklyCycleProps {
  id: string;
  founderId: string;
  cycleNumber: number;
  status: CycleStatus;
  scheduledFor: Date;
  contentDeliverBy: Date;
  campaignId: string | null;
  campaignPhaseIndex: number | null;
  selectedMode: MarketingMode | null;
  startedAt: Date | null;
  reasoningStartedAt: Date | null;
  committedAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  critiqueOutcome: CritiqueOutcome | null;
  critiqueReturnCount: number;
  isFallback: boolean;
}

/**
 * WeeklyCycle aggregate root.
 * Orchestrates the weekly marketing decision pipeline lifecycle.
 * Source: Domain Architecture V1 Chapter 03, Domain Behaviour Specification V1.
 */
export class WeeklyCycle extends AggregateRoot {
  founderId: string;
  cycleNumber: number;
  status: CycleStatus;
  scheduledFor: Date;
  contentDeliverBy: Date;
  campaignId: string | null;
  campaignPhaseIndex: number | null;
  selectedMode: MarketingMode | null;
  startedAt: Date | null;
  reasoningStartedAt: Date | null;
  committedAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  critiqueOutcome: CritiqueOutcome | null;
  critiqueReturnCount: number;
  isFallback: boolean;

  private constructor(props: WeeklyCycleProps) {
    super(props.id);
    this.founderId           = props.founderId;
    this.cycleNumber         = props.cycleNumber;
    this.status              = props.status;
    this.scheduledFor        = props.scheduledFor;
    this.contentDeliverBy    = props.contentDeliverBy;
    this.campaignId          = props.campaignId;
    this.campaignPhaseIndex  = props.campaignPhaseIndex;
    this.selectedMode        = props.selectedMode;
    this.startedAt           = props.startedAt;
    this.reasoningStartedAt  = props.reasoningStartedAt;
    this.committedAt         = props.committedAt;
    this.failedAt            = props.failedAt;
    this.failureReason       = props.failureReason;
    this.critiqueOutcome     = props.critiqueOutcome;
    this.critiqueReturnCount = props.critiqueReturnCount;
    this.isFallback          = props.isFallback;
  }

  // -----------------------------------------------------------------------
  // Factory: start a new cycle
  // Note: FounderProfile status check (F001) is enforced in the command
  // handler via SELECT FOR UPDATE — not here. The aggregate trusts it.
  // -----------------------------------------------------------------------

  static start(params: {
    cycleId: string;
    founderId: string;
    cycleNumber: number;
    scheduledFor: Date;
    contentDeliverBy: Date;
    campaignId: string | null;
    campaignPhaseIndex: number | null;
    correlationId: string;
    traceId: string;
  }): WeeklyCycle {
    const cycle = new WeeklyCycle({
      id:                params.cycleId,
      founderId:         params.founderId,
      cycleNumber:       params.cycleNumber,
      status:            'PENDING',
      scheduledFor:      params.scheduledFor,
      contentDeliverBy:  params.contentDeliverBy,
      campaignId:        params.campaignId,
      campaignPhaseIndex:params.campaignPhaseIndex,
      selectedMode:      null,
      startedAt:         null,
      reasoningStartedAt:null,
      committedAt:       null,
      failedAt:          null,
      failureReason:     null,
      critiqueOutcome:   null,
      critiqueReturnCount: 0,
      isFallback:        false,
    });
    cycle.recordEvent(
      cycle.buildEnvelope(
        'cycle.WeeklyCycle.WeeklyCycleStarted',
        buildWeeklyCycleStartedEvent({
          cycleId:           params.cycleId,
          founderId:         params.founderId,
          cycleNumber:       params.cycleNumber,
          scheduledFor:      params.scheduledFor,
          contentDeliverBy:  params.contentDeliverBy,
          campaignId:        params.campaignId,
          campaignPhaseIndex:params.campaignPhaseIndex,
        }),
        params.correlationId,
        null,
        params.traceId,
        'cycle-service',
      ),
    );
    return cycle;
  }

  static reconstitute(props: WeeklyCycleProps): WeeklyCycle {
    return new WeeklyCycle(props);
  }

  // -----------------------------------------------------------------------
  // UpdateSituationModel (Stage 3 progress event)
  // -----------------------------------------------------------------------

  updateSituationModel(params: {
    audienceTemperature: string;
    situationDeltaMagnitude: string;
    completenessScore: number;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    if (this.status !== 'REASONING') {
      this.status = 'REASONING';
      this.reasoningStartedAt = params.now;
    }
    this.recordEvent(
      this.buildEnvelope(
        'cycle.WeeklyCycle.SituationModelUpdated',
        buildSituationModelUpdatedEvent({
          cycleId:                 this.id,
          founderId:               this.founderId,
          audienceTemperature:     params.audienceTemperature,
          situationDeltaMagnitude: params.situationDeltaMagnitude,
          completenessScore:       params.completenessScore,
          stageCompletedAt:        params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'cycle-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // RecordProvisionalDecision (Stage 8 output)
  // -----------------------------------------------------------------------

  recordProvisionalDecision(params: {
    selectedMode: MarketingMode;
    modeConfidence: number;
    isFallback: boolean;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    this.status = 'CRITIQUE';
    this.selectedMode = params.selectedMode;
    this.recordEvent(
      this.buildEnvelope(
        'cycle.WeeklyCycle.ProvisionalDecisionMade',
        buildProvisionalDecisionMadeEvent({
          cycleId:        this.id,
          founderId:      this.founderId,
          selectedMode:   params.selectedMode,
          modeConfidence: params.modeConfidence,
          isFallback:     params.isFallback,
          stageCompletedAt: params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'cycle-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // RecordCritiqueResult (Stage 10 output)
  // -----------------------------------------------------------------------

  recordCritiqueResult(params: {
    outcome: CritiqueOutcome;
    lowConfidenceOverride: boolean;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    this.critiqueOutcome = params.outcome;
    if (params.outcome === 'REJECTED') {
      this.critiqueReturnCount += 1;
    }
    this.recordEvent(
      this.buildEnvelope(
        'cycle.WeeklyCycle.CritiqueCompleted',
        buildCritiqueCompletedEvent({
          cycleId:               this.id,
          founderId:             this.founderId,
          critiqueOutcome:       params.outcome,
          returnCount:           this.critiqueReturnCount,
          lowConfidenceOverride: params.lowConfidenceOverride,
          stageCompletedAt:      params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'cycle-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // CommitBrief (Stage 11 — main path)
  // -----------------------------------------------------------------------

  commitBrief(params: {
    brief: InternalBrief;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    if (params.brief.uniquenessScore < 50) {
      return err(new PreconditionFailed(
        'UNIQUENESS_SCORE_TOO_LOW',
        `Brief uniqueness score ${params.brief.uniquenessScore} is below minimum of 50.`,
      ));
    }
    this.status      = 'COMMITTED';
    this.committedAt = params.now;
    this.isFallback  = false;
    this.recordEvent(
      this.buildEnvelope(
        'cycle.WeeklyCycle.BriefCommitted',
        buildBriefCommittedEvent({
          cycleId:           this.id,
          founderId:         this.founderId,
          briefId:           params.brief.id,
          cycleNumber:       this.cycleNumber,
          selectedMode:      params.brief.mode,
          briefConfidence:   params.brief.briefConfidence,
          uniquenessScore:   params.brief.uniquenessScore,
          validationResult:  params.brief.validationResult,
          isFallback:        false,
          reviewFlag:        params.brief.reviewFlag,
          audienceTemperature: params.brief.audienceTemperature,
          campaignId:        params.brief.campaignId,
          committedAt:       params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'cycle-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // CommitFallbackBrief (Stage 11 — fallback path)
  // -----------------------------------------------------------------------

  commitFallbackBrief(params: {
    brief: InternalBrief;
    fallbackReason: string;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    this.status      = 'FALLBACK_COMMITTED';
    this.committedAt = params.now;
    this.isFallback  = true;
    this.recordEvent(
      this.buildEnvelope(
        'cycle.WeeklyCycle.FallbackBriefCommitted',
        buildFallbackBriefCommittedEvent({
          cycleId:         this.id,
          founderId:       this.founderId,
          briefId:         params.brief.id,
          cycleNumber:     this.cycleNumber,
          selectedMode:    params.brief.mode,
          briefConfidence: params.brief.briefConfidence,
          uniquenessScore: params.brief.uniquenessScore,
          validationResult:params.brief.validationResult,
          isFallback:      true,
          reviewFlag:      true,
          audienceTemperature: params.brief.audienceTemperature,
          campaignId:      params.brief.campaignId,
          committedAt:     params.now,
          fallbackReason:  params.fallbackReason,
        }),
        params.correlationId,
        null,
        params.traceId,
        'cycle-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // FailCycle
  // -----------------------------------------------------------------------

  failCycle(params: {
    failureReason: string;
    retryCount: number;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    this.status        = 'FAILED';
    this.failedAt      = params.now;
    this.failureReason = params.failureReason;
    this.recordEvent(
      this.buildEnvelope(
        'cycle.WeeklyCycle.WeeklyCycleFailed',
        buildWeeklyCycleFailedEvent({
          cycleId:       this.id,
          founderId:     this.founderId,
          cycleNumber:   this.cycleNumber,
          failureReason: params.failureReason,
          failedAt:      params.now,
          retryCount:    params.retryCount,
        }),
        params.correlationId,
        null,
        params.traceId,
        'cycle-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // EmitIntelligenceEvents (Stage 12 — after brief committed)
  // -----------------------------------------------------------------------

  emitIntelligenceEvents(params: {
    intelligenceEvents: IntelligenceEventPayload[];
    forwardQuestion: ForwardQuestion | null;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    if (this.status !== 'COMMITTED' && this.status !== 'FALLBACK_COMMITTED') {
      return err(new PreconditionFailed(
        'CYCLE_NOT_COMMITTED',
        'Intelligence events can only be emitted after a brief is committed.',
      ));
    }
    this.recordEvent(
      this.buildEnvelope(
        'cycle.WeeklyCycle.IntelligenceEventsEmitted',
        buildIntelligenceEventsEmittedEvent({
          cycleId:             this.id,
          founderId:           this.founderId,
          events:              params.intelligenceEvents,
          forwardQuestion:     params.forwardQuestion
            ? {
                question:    params.forwardQuestion.question,
                targetLayer: params.forwardQuestion.targetLayer,
                priority:    params.forwardQuestion.priority,
              }
            : null,
        }),
        params.correlationId,
        null,
        params.traceId,
        'cycle-service',
      ),
    );
    // Also emit ForwardQuestionSet if a forward question exists (F011)
    if (params.forwardQuestion) {
      this.recordEvent(
        this.buildEnvelope(
          'cycle.WeeklyCycle.ForwardQuestionSet',
          buildForwardQuestionSetEvent({
            fromCycleId: this.id,
            founderId:   this.founderId,
            question:    params.forwardQuestion.question,
            targetLayer: params.forwardQuestion.targetLayer,
            priority:    params.forwardQuestion.priority,
            createdAt:   params.now,
          }),
          params.correlationId,
          null,
          params.traceId,
          'cycle-service',
        ),
      );
    }
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // ApproveContent (Stream B — real-time)
  // -----------------------------------------------------------------------

  approveContent(params: {
    contentPiece: ContentPiece;
    approvalType: 'ZERO_EDIT' | 'MINOR_EDIT' | 'AUTO_APPROVED';
    editDistance: number;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed | ConflictError> {
    if (!params.contentPiece.isAwaitingApproval()) {
      return err(new ConflictError(
        'PIECE_ALREADY_DECIDED',
        'Content piece has already been approved or rejected.',
      ));
    }
    params.contentPiece.approvalStatus = params.approvalType === 'AUTO_APPROVED'
      ? 'AUTO_APPROVED'
      : params.approvalType === 'ZERO_EDIT'
        ? 'APPROVED'
        : 'APPROVED_WITH_EDITS';
    params.contentPiece.approvedAt = params.now;
    this.recordEvent(
      this.buildEnvelope(
        'cycle.WeeklyCycle.ContentApproved',
        buildContentApprovedEvent({
          contentPieceId: params.contentPiece.id,
          cycleId:        this.id,
          founderId:      this.founderId,
          approvalType:   params.approvalType,
          editDistance:   params.editDistance,
          approvedAt:     params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'cycle-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // EditAndApproveContent (Stream B — real-time)
  // -----------------------------------------------------------------------

  editAndApproveContent(params: {
    contentPiece: ContentPiece;
    edits: Array<{
      editId: string;
      editType: EditType;
      originalFragment: string;
      replacementFragment: string;
    }>;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed | ConflictError> {
    if (params.edits.length === 0) {
      return err(new PreconditionFailed(
        'EDITS_REQUIRED',
        'At least one edit is required for edit-and-approve.',
      ));
    }
    if (!params.contentPiece.isAwaitingApproval()) {
      return err(new ConflictError(
        'PIECE_ALREADY_DECIDED',
        'Content piece has already been approved or rejected.',
      ));
    }
    // Emit one ContentEdited event per edit
    for (const edit of params.edits) {
      this.recordEvent(
        this.buildEnvelope(
          'cycle.WeeklyCycle.ContentEdited',
          buildContentEditedEvent({
            editId:              edit.editId,
            contentPieceId:      params.contentPiece.id,
            cycleId:             this.id,
            founderId:           this.founderId,
            editType:            edit.editType,
            originalFragment:    edit.originalFragment,
            replacementFragment: edit.replacementFragment,
            editedAt:            params.now,
          }),
          params.correlationId,
          null,
          params.traceId,
          'cycle-service',
        ),
      );
    }
    params.contentPiece.approvalStatus = 'APPROVED_WITH_EDITS';
    params.contentPiece.approvedAt = params.now;
    this.recordEvent(
      this.buildEnvelope(
        'cycle.WeeklyCycle.ContentApproved',
        buildContentApprovedEvent({
          contentPieceId: params.contentPiece.id,
          cycleId:        this.id,
          founderId:      this.founderId,
          approvalType:   'MINOR_EDIT',
          editDistance:   params.edits.length,
          approvedAt:     params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'cycle-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // RejectContent (Stream B — real-time)
  // -----------------------------------------------------------------------

  rejectContent(params: {
    contentPiece: ContentPiece;
    reasonCode: RejectionReasonCode;
    hardBoundaryFlag: boolean;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed | ConflictError> {
    if (!params.contentPiece.isAwaitingApproval()) {
      return err(new ConflictError(
        'PIECE_ALREADY_DECIDED',
        'Content piece has already been approved or rejected.',
      ));
    }
    params.contentPiece.approvalStatus = 'REJECTED';
    params.contentPiece.rejectedAt = params.now;
    params.contentPiece.rejectionReasonCode = params.reasonCode;
    this.recordEvent(
      this.buildEnvelope(
        'cycle.WeeklyCycle.ContentRejected',
        buildContentRejectedEvent({
          contentPieceId:   params.contentPiece.id,
          cycleId:          this.id,
          founderId:        this.founderId,
          reasonCode:       params.reasonCode,
          hardBoundaryFlag: params.hardBoundaryFlag,
          rejectedAt:       params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'cycle-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  isActive(): boolean {
    return (
      this.status === 'COLLECTING' ||
      this.status === 'REASONING' ||
      this.status === 'CRITIQUE' ||
      this.status === 'COMMITTING'
    );
  }

  isTerminal(): boolean {
    return (
      this.status === 'COMMITTED' ||
      this.status === 'FAILED' ||
      this.status === 'FALLBACK_COMMITTED'
    );
  }
}
