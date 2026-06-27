/**
 * Documents the invariants enforced by FounderProfile.
 * These are the rules — the aggregate methods enforce them in code.
 * Source: Domain Behaviour Specification V1 Chapter 02.
 */
export const FOUNDER_PROFILE_INVARIANTS = [
  'An INTAKE_PENDING founder must have exactly one active intake session.',
  'An ACTIVE founder must have exactly one active offer.',
  'A RECALIBRATING founder cannot start a new weekly cycle.',
  'TriggerRecalibration requires no session started within the last 14 days (F017).',
  'At most one open recalibration session per founder.',
  'FounderVoice updates from EDIT_PATTERN require: Layer 2 confidence >= 0.60 AND observation_count >= 12 (F012).',
] as const;
