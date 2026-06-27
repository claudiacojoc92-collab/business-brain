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
