import { ok, err, type Result } from '@bb/shared';
import { AggregateRoot } from '../../shared/aggregate-root';
import { PreconditionFailed, ConflictError } from '../../shared/domain-error';
import type { CampaignPhase } from '../entities/campaign-phase.entity';
import {
  buildCampaignCreatedEvent,
  buildCampaignPhaseStartedEvent,
  buildCampaignPhaseCompletedEvent,
  buildCampaignCompletedEvent,
  buildCampaignSucceededEvent,
  buildCampaignFailedEvent,
  buildCampaignInterruptedEvent,
} from '../events';
import type { CampaignType, InterruptedBy } from '../events/campaign-event-types';

export type CampaignStatus =
  | 'PLANNED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'INTERRUPTED';

export interface CampaignProps {
  id: string;
  founderId: string;
  campaignType: CampaignType;
  status: CampaignStatus;
  beliefTarget: string;
  successCriteria: Record<string, unknown>;
  maxDurationWeeks: number;
  phases: CampaignPhase[];
  startedAt: Date | null;
  completedAt: Date | null;
  interruptedAt: Date | null;
  interruptionReason: string | null;
  succeededAt: Date | null;
  failedAt: Date | null;
}

/**
 * Campaign aggregate root.
 * Enforces the one-active-campaign-per-founder invariant through the
 * hasActiveCampaign parameter — never queries the database.
 * Source: Domain Architecture V1 Chapter 03.
 */
export class Campaign extends AggregateRoot {
  founderId: string;
  campaignType: CampaignType;
  status: CampaignStatus;
  beliefTarget: string;
  successCriteria: Record<string, unknown>;
  maxDurationWeeks: number;
  phases: CampaignPhase[];
  startedAt: Date | null;
  completedAt: Date | null;
  interruptedAt: Date | null;
  interruptionReason: string | null;
  succeededAt: Date | null;
  failedAt: Date | null;

  private constructor(props: CampaignProps) {
    super(props.id);
    this.founderId          = props.founderId;
    this.campaignType       = props.campaignType;
    this.status             = props.status;
    this.beliefTarget       = props.beliefTarget;
    this.successCriteria    = props.successCriteria;
    this.maxDurationWeeks   = props.maxDurationWeeks;
    this.phases             = [...props.phases];
    this.startedAt          = props.startedAt;
    this.completedAt        = props.completedAt;
    this.interruptedAt      = props.interruptedAt;
    this.interruptionReason = props.interruptionReason;
    this.succeededAt        = props.succeededAt;
    this.failedAt           = props.failedAt;
  }

  static reconstitute(props: CampaignProps): Campaign {
    return new Campaign(props);
  }

  // -----------------------------------------------------------------------
  // Launch — enforces one-active-campaign invariant via parameter
  // -----------------------------------------------------------------------

  static launch(params: {
    campaignId: string;
    founderId: string;
    campaignType: CampaignType;
    beliefTarget: string;
    successCriteria: Record<string, unknown>;
    maxDurationWeeks: number;
    phases: CampaignPhase[];
    hasActiveCampaign: boolean;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<Campaign, ConflictError | PreconditionFailed> {
    if (params.hasActiveCampaign) {
      return err(new ConflictError(
        'CAMPAIGN_ALREADY_ACTIVE',
        'An active campaign already exists for this founder.',
      ));
    }
    if (params.phases.length === 0) {
      return err(new PreconditionFailed(
        'CAMPAIGN_NO_PHASES',
        'A campaign must have at least one phase.',
      ));
    }
    const campaign = new Campaign({
      id:                 params.campaignId,
      founderId:          params.founderId,
      campaignType:       params.campaignType,
      status:             'PLANNED',
      beliefTarget:       params.beliefTarget,
      successCriteria:    params.successCriteria,
      maxDurationWeeks:   params.maxDurationWeeks,
      phases:             params.phases,
      startedAt:          params.now,
      completedAt:        null,
      interruptedAt:      null,
      interruptionReason: null,
      succeededAt:        null,
      failedAt:           null,
    });
    campaign.status = 'ACTIVE';
    campaign.recordEvent(
      campaign.buildEnvelope(
        'campaign.Campaign.CampaignCreated',
        buildCampaignCreatedEvent({
          campaignId:       params.campaignId,
          founderId:        params.founderId,
          campaignType:     params.campaignType,
          beliefTarget:     params.beliefTarget,
          totalPhases:      params.phases.length,
          phases:           params.phases.map((p) => ({
            phaseIndex:  p.phaseIndex,
            mode:        p.mode,
            beliefTarget:p.beliefTarget,
          })),
          successCriteria:  params.successCriteria,
          maxDurationWeeks: params.maxDurationWeeks,
          createdAt:        params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'campaign-service',
      ),
    );
    return ok(campaign);
  }

  // -----------------------------------------------------------------------
  // AdvancePhase
  // -----------------------------------------------------------------------

  advancePhase(params: {
    phaseIndex: number;
    cycleId: string;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    if (this.status !== 'ACTIVE') {
      return err(new PreconditionFailed(
        'CAMPAIGN_NOT_ACTIVE',
        'Campaign must be ACTIVE to advance a phase.',
      ));
    }
    const phase = this.phases.find((p) => p.phaseIndex === params.phaseIndex);
    if (!phase) {
      return err(new PreconditionFailed(
        'CAMPAIGN_PHASE_NOT_FOUND',
        `Phase ${params.phaseIndex} not found in campaign.`,
      ));
    }
    phase.assignedCycleId = params.cycleId;
    phase.executedAt      = params.now;
    this.recordEvent(
      this.buildEnvelope(
        'campaign.Campaign.CampaignPhaseStarted',
        buildCampaignPhaseStartedEvent({
          campaignId:  this.id,
          founderId:   this.founderId,
          phaseIndex:  params.phaseIndex,
          mode:        phase.mode,
          beliefTarget:phase.beliefTarget,
          startedAt:   params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'campaign-service',
      ),
    );
    this.recordEvent(
      this.buildEnvelope(
        'campaign.Campaign.CampaignPhaseCompleted',
        buildCampaignPhaseCompletedEvent({
          campaignId:  this.id,
          founderId:   this.founderId,
          phaseIndex:  params.phaseIndex,
          cycleId:     params.cycleId,
          completedAt: params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'campaign-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // Complete
  // -----------------------------------------------------------------------

  complete(params: {
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    if (this.status !== 'ACTIVE') {
      return err(new PreconditionFailed(
        'CAMPAIGN_NOT_ACTIVE',
        'Campaign must be ACTIVE to complete.',
      ));
    }
    this.status      = 'COMPLETED';
    this.completedAt = params.now;
    this.recordEvent(
      this.buildEnvelope(
        'campaign.Campaign.CampaignCompleted',
        buildCampaignCompletedEvent({
          campaignId:     this.id,
          founderId:      this.founderId,
          phasesExecuted: this.phases.filter((p) => p.isExecuted()).length,
          completedAt:    params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'campaign-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // EvaluateSuccess
  // -----------------------------------------------------------------------

  evaluateSuccess(params: {
    succeeded: boolean;
    failureReason?: string;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    if (this.status !== 'COMPLETED') {
      return err(new PreconditionFailed(
        'CAMPAIGN_NOT_COMPLETED',
        'Campaign must be COMPLETED to evaluate success.',
      ));
    }
    if (params.succeeded) {
      this.status      = 'SUCCEEDED';
      this.succeededAt = params.now;
      this.recordEvent(
        this.buildEnvelope(
          'campaign.Campaign.CampaignSucceeded',
          buildCampaignSucceededEvent({
            campaignId:  this.id,
            founderId:   this.founderId,
            succeededAt: params.now,
          }),
          params.correlationId,
          null,
          params.traceId,
          'campaign-service',
        ),
      );
    } else {
      this.status   = 'FAILED';
      this.failedAt = params.now;
      this.recordEvent(
        this.buildEnvelope(
          'campaign.Campaign.CampaignFailed',
          buildCampaignFailedEvent({
            campaignId:    this.id,
            founderId:     this.founderId,
            failedAt:      params.now,
            failureReason: params.failureReason ?? 'Success criteria not met.',
          }),
          params.correlationId,
          null,
          params.traceId,
          'campaign-service',
        ),
      );
    }
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // Interrupt
  // -----------------------------------------------------------------------

  interrupt(params: {
    reason: string;
    interruptedBy: InterruptedBy;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    if (this.status !== 'ACTIVE') {
      return err(new PreconditionFailed(
        'CAMPAIGN_NOT_ACTIVE',
        'Campaign must be ACTIVE to interrupt.',
      ));
    }
    this.status             = 'INTERRUPTED';
    this.interruptedAt      = params.now;
    this.interruptionReason = params.reason;
    this.recordEvent(
      this.buildEnvelope(
        'campaign.Campaign.CampaignInterrupted',
        buildCampaignInterruptedEvent({
          campaignId:         this.id,
          founderId:          this.founderId,
          interruptionReason: params.reason,
          interruptedAt:      params.now,
          interruptedBy:      params.interruptedBy,
        }),
        params.correlationId,
        null,
        params.traceId,
        'campaign-service',
      ),
    );
    return ok(undefined);
  }

  currentPhase(): CampaignPhase | null {
    const unexecuted = this.phases
      .filter((p) => !p.isExecuted())
      .sort((a, b) => a.phaseIndex - b.phaseIndex);
    return unexecuted[0] ?? null;
  }

  phasesCompleted(): number {
    return this.phases.filter((p) => p.isExecuted()).length;
  }
}
