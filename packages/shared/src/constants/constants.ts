/**
 * System-wide constants for Business Brain.
 * No magic numbers anywhere else in the codebase.
 * Every constant traces to a specification document.
 */

// Founder lifecycle — Corrections Addendum V1 F004
export const APPROVAL_WINDOW_HOURS_DEFAULT = 72;

// Recalibration cooldown — Corrections Addendum V1 F017
export const RECALIBRATION_COOLDOWN_DAYS = 14;

// VoiceSignature update threshold — Corrections Addendum V1 F012
export const VOICE_SIGNATURE_CONFIDENCE_THRESHOLD = 0.60;
export const VOICE_SIGNATURE_OBSERVATION_THRESHOLD = 12;
export const VOICE_SIGNATURE_UPDATE_COOLDOWN_WEEKS = 8;

// Business Memory — LLM Architecture Spec V1 + Corrections F018
export const MEMORY_SNAPSHOT_MAX_TOKENS = 1500;
export const MEMORY_SNAPSHOT_STALENESS_MINUTES = 5;

// Intelligence event rules — Corrections Addendum V1 F002
export const INTELLIGENCE_EVENT_INCREASE_MAX_DELTA = 0.20;

// LLM pipeline quality thresholds — Prompt Registry V1
export const CONFIDENCE_HALLUCINATION_PENALTY = 0.10;
export const UNIQUENESS_SCORE_MIN_MAIN = 50;
export const UNIQUENESS_SCORE_MIN_FALLBACK = 40;
export const CRITIQUE_SECOND_ARG_MIN_WORDS = 80;
export const HYPOTHESIS_MIN_COUNT = 3;
export const HYPOTHESIS_MAX_COUNT = 5;
export const INDIVIDUATION_ELEMENTS_MIN = 3;

// Pipeline and scheduler timing — Implementation Spec V1 + Corrections F009 F013
export const LLM_PIPELINE_TIMEOUT_MS = 180_000;
export const SCHEDULER_TICK_INTERVAL_MS = 30_000;
export const OUTBOX_RELAY_LOCK_MINUTES = 5;
export const CYCLE_START_HOUR_LOCAL = 3;
export const CYCLE_START_MINUTE_LOCAL = 30;

// Cache and idempotency TTLs — Implementation Spec V1 Section 13
export const IDEMPOTENCY_KEY_TTL_SECONDS = 86_400;
export const CONSUMED_EVENT_TTL_SECONDS = 2_592_000;
export const MANUAL_TRIGGER_TTL_SECONDS = 172_800;

// BullMQ queue names — Repository Structure V1 Section 10
export const QUEUES = {
  LLM_PIPELINE:     'bb-llm-pipeline',
  CONTENT_DELIVERY: 'bb-content-delivery',
  MEMORY:           'bb-memory-accumulate',
  ATTRIBUTION:      'bb-attribution',
  NOTIFICATIONS:    'bb-notifications',
  PROJECTIONS:      'bb-projections',
  DEAD_LETTER:      'bb-dead-letter',
} as const;

export type QueueName = typeof QUEUES[keyof typeof QUEUES];
