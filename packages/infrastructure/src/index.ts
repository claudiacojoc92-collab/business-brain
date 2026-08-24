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
