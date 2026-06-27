// Shared base classes
export { AggregateRoot } from './shared/aggregate-root';
export { Entity } from './shared/entity';
export { ValueObject } from './shared/value-object';
export type { DomainEventEnvelope } from './shared/domain-event';
export {
  DomainError,
  PreconditionFailed,
  NotFoundError,
  ConflictError,
} from './shared/domain-error';

// Founder context
export { FounderProfile } from './founder/aggregates/founder-profile.aggregate';
export type { FounderProfileProps } from './founder/aggregates/founder-profile.aggregate';
export { FounderVoice } from './founder/value-objects/founder-voice.vo';
export type { FounderVoiceProps, VoiceDerivedFrom, SentenceRhythm, ConvictionPosture, VulnerabilityLevel, SpecificityLevel, CtaStyle } from './founder/value-objects/founder-voice.vo';
export { BeliefChain } from './founder/value-objects/belief-chain.vo';
export type { BeliefChainProps, Belief, BeliefType } from './founder/value-objects/belief-chain.vo';
export { ConvictionAngle } from './founder/value-objects/conviction-angle.vo';
export type { ConvictionAngleProps } from './founder/value-objects/conviction-angle.vo';
export { AudienceLanguageFingerprint } from './founder/value-objects/audience-language-fingerprint.vo';
export type { AudienceLanguageFingerprintProps, EmotionalRegister } from './founder/value-objects/audience-language-fingerprint.vo';
export { Audience } from './founder/value-objects/audience.vo';
export type { AudienceProps, SophisticationLevel } from './founder/value-objects/audience.vo';
export { Offer } from './founder/value-objects/offer.vo';
export type { OfferProps } from './founder/value-objects/offer.vo';
export type { OfferAvailability, OfferMaturity, OfferPriceTier, OfferSalesMechanism } from './founder/value-objects/offer-enums';
export type { NotificationChannel } from './founder/value-objects/notification-preferences';
export { IntakeSession } from './founder/entities/intake-session.entity';
export { RecalibrationSession } from './founder/entities/recalibration-session.entity';
export type { RecalibrationType } from './founder/entities/recalibration-types';
export type { IFounderProfileRepository } from './founder/repositories/founder-profile.repository';
export type {
  IFounderVoiceRepository,
  UpsertVoiceFromIntakeInput,
  FounderVoiceRecord,
} from './founder/repositories/founder-voice.repository';
export { FounderEligibilityService } from './founder/domain-services/founder-eligibility.service';
export type { EligibilityFlags } from './founder/domain-services/founder-eligibility.service';
export * from './founder/events';

// Cycle context
export { WeeklyCycle } from './cycle/aggregates/weekly-cycle.aggregate';
export type { WeeklyCycleProps, CycleStatus } from './cycle/aggregates/weekly-cycle.aggregate';
export { ContentPiece } from './cycle/entities/content-piece.entity';
export type { ContentPieceProps, ContentPieceType } from './cycle/entities/content-piece.entity';
export { InternalBrief } from './cycle/entities/internal-brief.entity';
export type {
  InternalBriefProps,
  AudienceTemperature,
  ValidationResult,
} from './cycle/entities/internal-brief.entity';
export { CycleSignal } from './cycle/entities/cycle-signal.entity';
export type { CycleSignalProps, SignalDirection } from './cycle/entities/cycle-signal.entity';
export { ForwardQuestion } from './cycle/value-objects/forward-question.vo';
export type {
  ForwardQuestionProps,
  ForwardQuestionPriority,
} from './cycle/value-objects/forward-question.vo';
export { ApprovalDecision } from './cycle/value-objects/approval-decision.vo';
export type { ApprovalDecisionProps, ApprovalActionType } from './cycle/value-objects/approval-decision.vo';
export { ContentEdit } from './cycle/value-objects/content-edit.vo';
export type { ContentEditProps } from './cycle/value-objects/content-edit.vo';
export type {
  IWeeklyCycleRepository,
  CycleHistory,
  PagedResult,
} from './cycle/repositories/weekly-cycle.repository';
export type { IInternalBriefRepository } from './cycle/repositories/internal-brief.repository';
export * from './cycle/events';

// Memory context
export { BusinessMemory } from './memory/aggregates/business-memory.aggregate';
export type { BusinessMemoryProps } from './memory/aggregates/business-memory.aggregate';
export { MemoryLayerVO } from './memory/value-objects/memory-layer.vo';
export type { MemoryLayerProps } from './memory/value-objects/memory-layer.vo';
export { VoiceSignature } from './memory/value-objects/voice-signature.vo';
export type { VoiceSignatureProps } from './memory/value-objects/voice-signature.vo';
export { MemorySnapshot } from './memory/value-objects/memory-snapshot.vo';
export type { MemorySnapshotProps } from './memory/value-objects/memory-snapshot.vo';
export { IntelligenceEvent } from './memory/entities/intelligence-event.entity';
export type {
  IntelligenceEventProps,
  IntelligenceEventType,
  QuarantineStatus,
} from './memory/entities/intelligence-event.entity';
export { Pattern } from './memory/entities/pattern.entity';
export type { PatternProps } from './memory/entities/pattern.entity';
export type { PatternStatus } from './memory/repositories/business-memory.repository';
export type { IBusinessMemoryRepository } from './memory/repositories/business-memory.repository';
export * from './memory/events';

// Campaign context
export { Campaign } from './campaign/aggregates/campaign.aggregate';
export type { CampaignProps, CampaignStatus } from './campaign/aggregates/campaign.aggregate';
export { CampaignPhase } from './campaign/entities/campaign-phase.entity';
export type { CampaignPhaseProps } from './campaign/entities/campaign-phase.entity';
export type { ICampaignRepository } from './campaign/repositories/campaign.repository';
export * from './campaign/events';

// Outcome context
export { OutcomeReport } from './outcome/entities/outcome-report.entity';
export type {
  OutcomeReportProps,
  AttributionStatus,
} from './outcome/entities/outcome-report.entity';
export type { IOutcomeReportRepository } from './outcome/repositories/outcome-report.repository';
export * from './outcome/events';
