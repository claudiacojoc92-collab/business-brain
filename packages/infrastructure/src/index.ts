export { createKyselyClient } from './database/client';
export type { KyselyDB } from './database/client';
export { setRlsContext } from './database/rls-context';
export { KyselyTransactionManager } from './database/transaction';

// Repository implementations
export { PgFounderProfileRepository } from './database/repositories/pg-founder-profile.repository';
export { PgFounderVoiceRepository } from './database/repositories/pg-founder-voice.repository';
export { PgWeeklyCycleRepository } from './database/repositories/pg-weekly-cycle.repository';
export { PgBusinessMemoryRepository } from './database/repositories/pg-business-memory.repository';
export { PgCampaignRepository } from './database/repositories/pg-campaign.repository';
export { PgOutcomeReportRepository } from './database/repositories/pg-outcome-report.repository';

// Projection implementations
export { PgFounderStatusProjection } from './database/projections/pg-founder-status.projection';
export type { FounderStatusProjection } from './database/projections/pg-founder-status.projection';
export { PgCurrentCycleProjection } from './database/projections/pg-current-cycle.projection';
export type { CurrentCycleProjection } from './database/projections/pg-current-cycle.projection';
export { PgCampaignProjection } from './database/projections/pg-campaign.projection';
export type { CampaignProjection } from './database/projections/pg-campaign.projection';
export { PgOutcomeHistoryProjection } from './database/projections/pg-outcome-history.projection';
export type { OutcomeHistoryItem } from './database/projections/pg-outcome-history.projection';
export { PgPatternProjection } from './database/projections/pg-pattern.projection';
export type { PatternProjection } from './database/projections/pg-pattern.projection';

// Event store
export { PgEventStore } from './event-store/pg-event-store';
export { OutboxRelay } from './event-store/outbox-relay';

// Cache
export { createRedisClient } from './cache/redis-client';
export { createBullMqConnection } from './cache/redis-client';

// CQRS buses + event bus
export { CommandBus } from './cqrs/command-bus';
export { QueryBus } from './cqrs/query-bus';
export { InProcessEventBus } from './event-bus/in-process-event-bus';

// Founder auth repository
export { PgFounderAuthRepository } from './database/repositories/pg-founder-auth.repository';

// Slice 0 — Business + Membership tenancy seam and founder account repositories
export { PgBusinessRepository } from './database/repositories/pg-business.repository';
export { PgFounderAccountRepository } from './database/repositories/pg-founder-account.repository';

// Slice 1 — website understanding + Aha persistence
export {
  PgBusinessEvidenceLinkRepository,
  PgDiscoveredProfileRepository,
  PgUnderstandingSnapshotRepository,
  PgAhaRepository,
  PgBusinessWebsiteRepository,
} from './database/repositories/pg-slice1.repository';

// Slice 2 — conversation + founder model + Aha 2 persistence
export {
  PgConversationRepository,
  PgInformationNeedRepository,
  PgFounderStateRepository,
  PgFounderObservationRepository,
  PgAha2Repository,
} from './database/repositories/pg-conversation.repository';

// Slice 3 — strategy: immutable versioned bundle + lifecycle pointer
export {
  PgStrategyRepository,
  PgStrategyPointerRepository,
} from './database/repositories/pg-strategy.repository';

// Slice 4 — voice: example-grounded Voice Model persistence
export { PgVoiceRepository } from './database/repositories/pg-voice.repository';
export { PgPlanRepository } from './database/repositories/pg-plan.repository';
export { PgCarouselRepository } from './database/repositories/pg-carousel.repository';
export { PgPhotoLedRepository } from './database/repositories/pg-photoled.repository';
export { ResvgCarouselRenderer } from './render/resvg-carousel.renderer';
export { FsBlobStore } from './storage/fs-blob-store';

// Internal brief projection
export { PgInternalBriefProjection } from './database/projections/pg-internal-brief.projection';
export { PgInternalBriefRepository } from './database/repositories/pg-internal-brief.repository';
export { PgContentPieceRepository } from './database/repositories/pg-content-piece.repository';
export { PgEvidenceRepository } from './database/repositories/pg-evidence.repository';

// Understanding→Audit vertical slice (Commit 2: fixture ingestion + corpus revision persistence)
export { PgRawCaptureRepository } from './database/repositories/pg-raw-capture.repository';
export { PgObservationRepository } from './database/repositories/pg-observation.repository';
export { PgUnderstandingRevisionRepository } from './database/repositories/pg-understanding-revision.repository';
export { PgIngestionIdempotencyRepository } from './database/repositories/pg-ingestion-idempotency.repository';
export { KyselyIngestionUnitOfWork } from './understanding/kysely-ingestion-unit-of-work';
export { SharedClockAdapter } from './understanding/shared-clock-adapter';
export { LoggingIngestionEventSink } from './understanding/logging-ingestion-event-sink';
// Commit 3: facet extraction + effective resolution
export { PgFacetRepository } from './database/repositories/pg-facet.repository';
export { PgFacetCorrectionRepository } from './database/repositories/pg-facet-correction.repository';
export { PgFacetExtractionRunRepository } from './database/repositories/pg-facet-extraction-run.repository';
export { KyselyFacetExtractionUnitOfWork } from './understanding/kysely-facet-extraction-unit-of-work';
export { LoggingFacetExtractionEventSink } from './understanding/logging-facet-extraction-event-sink';
// Commit 4: immutable snapshot generation
export { PgSnapshotRepository } from './database/repositories/pg-snapshot.repository';
export { KyselySnapshotUnitOfWork } from './understanding/kysely-snapshot-unit-of-work';
export { LoggingSnapshotGenerationEventSink } from './understanding/logging-snapshot-generation-event-sink';
// Commit 5: recognition append + snapshot-view read composition
export { PgRecognitionEventRepository } from './database/repositories/pg-recognition-event.repository';
export { KyselyRecognitionUnitOfWork } from './understanding/kysely-recognition-unit-of-work';
export { LoggingRecognitionEventSink } from './understanding/logging-recognition-event-sink';
// Commit 6: review lifecycle (append-only)
export { PgReviewRepository } from './database/repositories/pg-review.repository';
export { KyselyReviewUnitOfWork } from './understanding/kysely-review-unit-of-work';
export { LoggingReviewEventSink } from './understanding/logging-review-event-sink';
// Commit 7: presentation lifecycle (append-only)
export { PgPresentedEventRepository } from './database/repositories/pg-presented-event.repository';
export { KyselyPresentationUnitOfWork } from './understanding/kysely-presentation-unit-of-work';
export { LoggingPresentationEventSink } from './understanding/logging-presentation-event-sink';
// Commit 8: founder declaration lifecycle (append-only)
export { PgDeclarationRepository } from './database/repositories/pg-declaration.repository';
export { KyselyDeclarationUnitOfWork } from './understanding/kysely-declaration-unit-of-work';
export { LoggingDeclarationEventSink } from './understanding/logging-declaration-event-sink';
// Commit 9: claims lifecycle (append-only)
export { PgClaimRepository } from './database/repositories/pg-claim.repository';
export { KyselyClaimUnitOfWork } from './understanding/kysely-claim-unit-of-work';
export { LoggingClaimEventSink } from './understanding/logging-claim-event-sink';

// Business Brain V1 — versioned lifecycle persistence (V060)
export { PgBusinessBrainRepository } from './businessbrain/pg-businessbrain.repository';

// Intake session repository (B1 onboarding)
export { PgIntakeSessionRepository } from './database/repositories/pg-intake-session.repository';
export type { RedisClient } from './cache/redis-client';
export { RedisCache } from './cache/redis-cache';

// Queue
export { createQueues } from './queue/bullmq-client';
export type { QueueMap } from './queue/bullmq-client';
export {
  QueueRegistry,
} from './queue/queue-registry';
export type {
  BaseJobPayload,
  LLMPipelineJobPayload,
  NotificationJobPayload,
  MemoryAccumulateJobPayload,
  AttributionJobPayload,
  ProjectionJobPayload,
  ContentDeliveryJobPayload,
} from './queue/queue-registry';

// LLM
export { createAnthropicClient } from './llm/anthropic-client';
export type { AnthropicClient } from './llm/anthropic-client';
export { PromptRegistryClient } from './llm/prompt-registry-client';
export type { PromptRecord } from './llm/prompt-registry-client';
export { LLMRouter } from './llm/llm-router';
export type { LLMCallOptions, LLMResponse } from './llm/llm-router';

// Auth
export { JwtService } from './auth/jwt.service';
export type { JwtPayload, TokenPair } from './auth/jwt.service';
export { PasswordService } from './auth/password.service';

// Secrets
export { SecretsManager } from './secrets/secrets-manager';
export type { Secrets } from './secrets/secrets-manager';

// Encryption
export { FieldEncryptor } from './encryption/field-encryptor';

// Telemetry
export { initTelemetry, shutdownTelemetry } from './telemetry/otel-setup';
export { getTracer, withSpan } from './telemetry/tracer';
export { getMeter, registerMetrics } from './telemetry/meter';
export { createLogger } from './telemetry/logger';
export type { Logger } from './telemetry/logger';

// Health
export { HealthChecks } from './health/health-checks';
export type { HealthCheckResult, HealthStatus } from './health/health-checks';

// Slice 7 — Reel Creation (real MP4) infra
export { FfmpegReelRenderer } from './reel/ffmpeg-reel.renderer';
export { SkiaReelTextRenderer } from './reel/skia-reel-text.renderer';
export { DeepgramTranscription, FakeTranscription, type FakeScript } from './reel/reel-transcription.adapter';
export { LocalObjectStore, S3ObjectStore, type S3ObjectStoreConfig } from './storage/reel-object-store';

export { PgReelRepository } from './database/repositories/pg-reel.repository';

// Slice 7 V2 — "Tell me what to film" persistence
export { PgReelShootRepository } from './database/repositories/pg-reel-shoot.repository';

// Concrete Anthropic model adapters (relocated from apps/api — they implement @bb/application ports with the
// Anthropic SDK and contain no API-runtime behavior; shared by both the api and workers runtimes).
export { AnthropicUnderstandingModel } from './business-intelligence/anthropic-understanding.model';
export { AnthropicAha2Model } from './business-intelligence/anthropic-aha2.model';
export { AnthropicConversationModel } from './business-intelligence/anthropic-conversation.model';
export { AnthropicStrategyModel } from './business-intelligence/anthropic-strategy.model';
export { AnthropicVoiceModel } from './business-intelligence/anthropic-voice.model';
export { AnthropicPlanModel, PLAN_SYSTEM } from './business-intelligence/anthropic-plan.model';
export { AnthropicCarouselModel } from './business-intelligence/anthropic-carousel.model';
export { AnthropicObservationModel, AnthropicOpportunityModel } from './business-intelligence/anthropic-photoled.model';
export { AnthropicVideoObservationModel, AnthropicReelOpportunityModel } from './business-intelligence/anthropic-reel.model';
export { AnthropicConceptPlanModel } from './business-intelligence/anthropic-shoot.model';
export { AnthropicImpactModel } from './business-intelligence/anthropic-impact.model';
export { AnthropicMirrorModel } from './business-intelligence/anthropic-mirror.model';

// Website ingestion + social-discovery adapters (relocated from apps/api) + the API-agnostic website connector.
export { WebsiteIngestionAdapter } from './business-intelligence/website-ingestion.adapter';
export { SocialDiscoveryAdapter } from './business-intelligence/social-discovery.adapter';
export * from './connectors/website';
