import {
  ok, err,
  type Result,
  type FounderStatus,
  RECALIBRATION_COOLDOWN_DAYS,
  generateId,
} from '@bb/shared';
import { AggregateRoot } from '../../shared/aggregate-root';
import { PreconditionFailed, ConflictError } from '../../shared/domain-error';
import type { FounderVoice } from '../value-objects/founder-voice.vo';
import type { BeliefChain } from '../value-objects/belief-chain.vo';
import type { ConvictionAngle } from '../value-objects/conviction-angle.vo';
import type { Audience } from '../value-objects/audience.vo';
import type { Offer } from '../value-objects/offer.vo';
import type { OfferAvailability } from '../value-objects/offer-enums';
import type { IntakeSession } from '../entities/intake-session.entity';
import type { RecalibrationType } from '../entities/recalibration-types';
import type { NotificationChannel } from '../value-objects/notification-preferences';

// Domain events
import {
  buildFounderCreatedEvent,
  buildIntakeStartedEvent,
  buildIntakeCompletedEvent,
  buildIntakeCompletedWithoutDerivationEvent,
  buildFounderVoiceVersionedEvent,
  buildOfferAvailabilityChangedEvent,
  buildOfferCreatedEvent,
  buildOfferClosedEvent,
  buildFounderPausedEvent,
  buildFounderResumedEvent,
  buildRecalibrationStartedEvent,
  buildRecalibrationCompletedEvent,
} from '../events';

export interface FounderProfileProps {
  id: string;
  email: string;
  name: string;
  businessName: string;
  timezone: string;
  status: FounderStatus;
  currentVoice: FounderVoice | null;
  currentBeliefChain: BeliefChain | null;
  currentConviction: ConvictionAngle | null;
  currentAudience: Audience | null;
  currentOffer: Offer | null;
  notificationChannel: NotificationChannel;
  autoApproveOnWindowClose: boolean;
  approvalWindowHours: number;
  registeredAt: Date;
  activatedAt: Date | null;
  pausedAt: Date | null;
}

/**
 * FounderProfile aggregate root.
 * All state transitions are enforced here. No aggregate queries the database.
 * Source: Domain Architecture V1 Chapter 03, Domain Behaviour Specification V1.
 */
export class FounderProfile extends AggregateRoot {
  email: string;
  name: string;
  businessName: string;
  timezone: string;
  status: FounderStatus;
  currentVoice: FounderVoice | null;
  currentBeliefChain: BeliefChain | null;
  currentConviction: ConvictionAngle | null;
  currentAudience: Audience | null;
  currentOffer: Offer | null;
  notificationChannel: NotificationChannel;
  autoApproveOnWindowClose: boolean;
  approvalWindowHours: number;
  registeredAt: Date;
  activatedAt: Date | null;
  pausedAt: Date | null;

  private constructor(props: FounderProfileProps) {
    super(props.id);
    this.email                    = props.email;
    this.name                     = props.name;
    this.businessName             = props.businessName;
    this.timezone                 = props.timezone;
    this.status                   = props.status;
    this.currentVoice             = props.currentVoice;
    this.currentBeliefChain       = props.currentBeliefChain;
    this.currentConviction        = props.currentConviction;
    this.currentAudience          = props.currentAudience;
    this.currentOffer             = props.currentOffer;
    this.notificationChannel      = props.notificationChannel;
    this.autoApproveOnWindowClose = props.autoApproveOnWindowClose;
    this.approvalWindowHours      = props.approvalWindowHours;
    this.registeredAt             = props.registeredAt;
    this.activatedAt              = props.activatedAt;
    this.pausedAt                 = props.pausedAt;
  }

  // -----------------------------------------------------------------------
  // Factory: register a new founder
  // -----------------------------------------------------------------------

  static register(params: {
    email: string;
    name: string;
    businessName: string;
    timezone: string;
    correlationId: string;
    traceId: string;
    now: Date;
  }): FounderProfile {
    const id = generateId();
    const founder = new FounderProfile({
      id,
      email:                    params.email,
      name:                     params.name,
      businessName:             params.businessName,
      timezone:                 params.timezone,
      status:                   'CREATED',
      currentVoice:             null,
      currentBeliefChain:       null,
      currentConviction:        null,
      currentAudience:          null,
      currentOffer:             null,
      notificationChannel:      'EMAIL',
      autoApproveOnWindowClose: true,
      approvalWindowHours:      72,
      registeredAt:             params.now,
      activatedAt:              null,
      pausedAt:                 null,
    });
    founder.recordEvent(
      founder.buildEnvelope(
        'founder.FounderProfile.FounderCreated',
        buildFounderCreatedEvent({
          founderId:    id,
          email:        params.email,
          name:         params.name,
          businessName: params.businessName,
          timezone:     params.timezone,
          registeredAt: params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'founder-service',
      ),
    );
    return founder;
  }

  // -----------------------------------------------------------------------
  // Reconstitute from persistence
  // -----------------------------------------------------------------------

  static reconstitute(props: FounderProfileProps): FounderProfile {
    return new FounderProfile(props);
  }

  // -----------------------------------------------------------------------
  // StartIntake
  // -----------------------------------------------------------------------

  startIntake(params: {
    sessionId: string;
    mandatorySignalTypes: string[];
    expiresAt: Date;
    correlationId: string;
    traceId: string;
  }): Result<void, PreconditionFailed> {
    if (this.status !== 'CREATED') {
      return err(new PreconditionFailed(
        'FOUNDER_NOT_IN_CREATED_STATE',
        'Intake can only be started from CREATED state.',
      ));
    }
    this.status = 'INTAKE_PENDING';
    this.recordEvent(
      this.buildEnvelope(
        'founder.FounderProfile.IntakeStarted',
        buildIntakeStartedEvent({
          founderId:            this.id,
          sessionId:            params.sessionId,
          expiresAt:            params.expiresAt,
          mandatorySignalTypes: params.mandatorySignalTypes,
        }),
        params.correlationId,
        null,
        params.traceId,
        'founder-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // CompleteIntake
  // -----------------------------------------------------------------------

  completeIntake(params: {
    session: IntakeSession;
    voice: FounderVoice;
    beliefChain: BeliefChain;
    conviction: ConvictionAngle;
    audience: Audience;
    offer: Offer;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    if (this.status !== 'INTAKE_PENDING') {
      return err(new PreconditionFailed(
        'FOUNDER_NOT_INTAKE_PENDING',
        'CompleteIntake requires INTAKE_PENDING state.',
      ));
    }
    if (!params.session.hasAllMandatorySignals()) {
      return err(new PreconditionFailed(
        'INTAKE_INCOMPLETE',
        'Not all mandatory signals have been submitted.',
      ));
    }
    this.status         = 'INTAKE_COMPLETE';
    this.currentVoice   = params.voice;
    this.currentBeliefChain = params.beliefChain;
    this.currentConviction  = params.conviction;
    this.currentAudience    = params.audience;
    this.currentOffer       = params.offer;
    this.activatedAt        = params.now;
    this.recordEvent(
      this.buildEnvelope(
        'founder.FounderProfile.IntakeCompleted',
        buildIntakeCompletedEvent({
          founderId:     this.id,
          sessionId:     params.session.id,
          completedAt:   params.now,
          voice:         params.voice,
          beliefChain:   params.beliefChain,
          conviction:    params.conviction,
          audience:      params.audience,
          offer:         params.offer,
        }),
        params.correlationId,
        null,
        params.traceId,
        'founder-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // CompleteIntakeWithoutDerivation (B1 Option-1)
  // -----------------------------------------------------------------------
  // Transitions INTAKE_PENDING → ACTIVE without deriving voice/conviction/
  // audience/offer from the 28 answers. The raw intake signals stay in
  // founder.intake_sessions for the pipeline to consume later.
  // -----------------------------------------------------------------------

  completeIntakeWithoutDerivation(params: {
    sessionId: string;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    if (this.status !== 'INTAKE_PENDING') {
      return err(new PreconditionFailed(
        'FOUNDER_NOT_INTAKE_PENDING',
        'CompleteIntake requires INTAKE_PENDING state.',
      ));
    }
    this.status      = 'ACTIVE';
    this.activatedAt = params.now;
    this.recordEvent(
      this.buildEnvelope(
        'founder.FounderProfile.IntakeCompletedWithoutDerivation',
        buildIntakeCompletedWithoutDerivationEvent({
          founderId:   this.id,
          sessionId:   params.sessionId,
          completedAt: params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'founder-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // Pause
  // -----------------------------------------------------------------------

  pause(params: {
    reason?: string;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed | ConflictError> {
    if (this.status === 'PAUSED') {
      return err(new ConflictError(
        'FOUNDER_ALREADY_PAUSED',
        'Founder is already paused.',
      ));
    }
    if (this.status === 'ARCHIVED') {
      return err(new PreconditionFailed(
        'FOUNDER_NOT_PAUSABLE',
        'Archived founders cannot be paused.',
      ));
    }
    this.status   = 'PAUSED';
    this.pausedAt = params.now;
    this.recordEvent(
      this.buildEnvelope(
        'founder.FounderProfile.FounderPaused',
        buildFounderPausedEvent({
          founderId: this.id,
          reason:    params.reason,
          pausedAt:  params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'founder-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // Resume
  // -----------------------------------------------------------------------

  resume(params: {
    nextCycleScheduledFor: Date;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, ConflictError> {
    if (this.status !== 'PAUSED') {
      return err(new ConflictError(
        'FOUNDER_NOT_PAUSED',
        'Founder is not paused.',
      ));
    }
    this.status   = 'ACTIVE';
    this.pausedAt = null;
    this.recordEvent(
      this.buildEnvelope(
        'founder.FounderProfile.FounderResumed',
        buildFounderResumedEvent({
          founderId:             this.id,
          resumedAt:             params.now,
          nextCycleScheduledFor: params.nextCycleScheduledFor,
        }),
        params.correlationId,
        null,
        params.traceId,
        'founder-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // UpdateOfferAvailability
  // -----------------------------------------------------------------------

  updateOfferAvailability(params: {
    newAvailability: OfferAvailability;
    updatedOffer: Offer;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed | ConflictError> {
    if (this.status !== 'ACTIVE') {
      return err(new PreconditionFailed(
        'FOUNDER_NOT_ACTIVE',
        'Founder must be ACTIVE to update offer availability.',
      ));
    }
    if (!this.currentOffer) {
      return err(new PreconditionFailed(
        'NO_ACTIVE_OFFER',
        'No active offer to update.',
      ));
    }
    if (this.currentOffer.availability === params.newAvailability) {
      return err(new ConflictError(
        'AVAILABILITY_UNCHANGED',
        'New availability is the same as current.',
      ));
    }
    const previousAvailability = this.currentOffer.availability;
    this.currentOffer = params.updatedOffer;
    this.recordEvent(
      this.buildEnvelope(
        'founder.FounderProfile.OfferAvailabilityChanged',
        buildOfferAvailabilityChangedEvent({
          founderId:            this.id,
          offerId:              this.currentOffer.id,
          previousAvailability,
          newAvailability:      params.newAvailability,
          changedAt:            params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'founder-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // VersionOffer
  // -----------------------------------------------------------------------

  versionOffer(params: {
    previousOfferId: string;
    newOffer: Offer;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    if (this.status !== 'ACTIVE') {
      return err(new PreconditionFailed(
        'FOUNDER_NOT_ACTIVE',
        'Founder must be ACTIVE to version an offer.',
      ));
    }
    // Emit OfferClosed for the previous offer
    this.recordEvent(
      this.buildEnvelope(
        'founder.FounderProfile.OfferClosed',
        buildOfferClosedEvent({
          founderId:     this.id,
          offerId:       params.previousOfferId,
          versionNumber: this.currentOffer?.versionNumber ?? 0,
          closedAt:      params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'founder-service',
      ),
    );
    this.currentOffer = params.newOffer;
    // Emit OfferCreated for the new offer
    this.recordEvent(
      this.buildEnvelope(
        'founder.FounderProfile.OfferCreated',
        buildOfferCreatedEvent({
          founderId: this.id,
          offer:     params.newOffer,
          createdAt: params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'founder-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // TriggerRecalibration — F017: 14-day cooldown enforced here
  // -----------------------------------------------------------------------

  triggerRecalibration(params: {
    sessionId: string;
    recalibrationType: RecalibrationType;
    questions: { sequence: number; signalType: string; prompt: string }[];
    expiresAt: Date;
    triggeredBy: 'SYSTEM' | 'FOUNDER';
    triggerReason: string;
    daysSinceLastRecalibration: number | null;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed | ConflictError> {
    if (this.status !== 'ACTIVE' && this.status !== 'RECALIBRATING') {
      return err(new PreconditionFailed(
        'FOUNDER_NOT_ACTIVE',
        'Recalibration requires ACTIVE or RECALIBRATING state.',
      ));
    }
    // F017: 14-day cooldown
    if (
      params.daysSinceLastRecalibration !== null &&
      params.daysSinceLastRecalibration < RECALIBRATION_COOLDOWN_DAYS
    ) {
      return err(new ConflictError(
        'RECALIBRATION_COOLDOWN_ACTIVE',
        `A recalibration session was started ${params.daysSinceLastRecalibration} days ago. Cooldown: ${RECALIBRATION_COOLDOWN_DAYS} days.`,
      ));
    }
    this.status = 'RECALIBRATING';
    this.recordEvent(
      this.buildEnvelope(
        'founder.FounderProfile.RecalibrationStarted',
        buildRecalibrationStartedEvent({
          founderId:           this.id,
          sessionId:           params.sessionId,
          recalibrationType:   params.recalibrationType,
          triggeredBy:         params.triggeredBy,
          triggerReason:       params.triggerReason,
          expiresAt:           params.expiresAt,
          questions:           params.questions,
        }),
        params.correlationId,
        null,
        params.traceId,
        'founder-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // CompleteRecalibration
  // -----------------------------------------------------------------------

  completeRecalibration(params: {
    sessionId: string;
    newVoice: FounderVoice | null;
    newConviction: ConvictionAngle | null;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    if (this.status !== 'RECALIBRATING') {
      return err(new PreconditionFailed(
        'FOUNDER_NOT_RECALIBRATING',
        'CompleteRecalibration requires RECALIBRATING state.',
      ));
    }
    if (params.newVoice) {
      this.currentVoice = params.newVoice;
    }
    if (params.newConviction) {
      this.currentConviction = params.newConviction;
    }
    this.status = 'ACTIVE';
    this.recordEvent(
      this.buildEnvelope(
        'founder.FounderProfile.RecalibrationCompleted',
        buildRecalibrationCompletedEvent({
          founderId:           this.id,
          sessionId:           params.sessionId,
          completedAt:         params.now,
          voiceVersionUpdated: params.newVoice !== null,
          newVoiceVersionId:   params.newVoice ? generateId() : null,
          convictionUpdated:   params.newConviction !== null,
          newConvictionId:     params.newConviction ? generateId() : null,
        }),
        params.correlationId,
        null,
        params.traceId,
        'founder-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // UpdateVoiceFromBehaviour (F012)
  // -----------------------------------------------------------------------

  updateVoiceFromBehaviour(params: {
    newVoice: FounderVoice;
    previousVoiceVersionId: string;
    correlationId: string;
    traceId: string;
  }): Result<void, PreconditionFailed> {
    if (this.status !== 'ACTIVE') {
      return err(new PreconditionFailed(
        'FOUNDER_NOT_ACTIVE',
        'Voice can only be updated from behaviour when founder is ACTIVE.',
      ));
    }
    this.currentVoice = params.newVoice;
    this.recordEvent(
      this.buildEnvelope(
        'founder.FounderProfile.FounderVoiceVersioned',
        buildFounderVoiceVersionedEvent({
          founderId:          this.id,
          voiceVersionId:     generateId(),
          versionNumber:      params.newVoice.versionNumber,
          derivedFrom:        'EDIT_PATTERN',
          previousVersionId:  params.previousVoiceVersionId,
          voice:              params.newVoice,
        }),
        params.correlationId,
        null,
        params.traceId,
        'founder-service',
      ),
    );
    return ok(undefined);
  }
}
