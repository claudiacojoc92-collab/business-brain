export const WEEKLY_CYCLE_INVARIANTS = [
  'Only one ACTIVE cycle per founder (status in COLLECTING, REASONING, CRITIQUE, COMMITTING).',
  'StartWeeklyCycle requires FounderProfile status === ACTIVE (F001 — checked in handler).',
  'BriefCommitted requires: uniquenessScore >= 50, no PII placeholders in payload.',
  'ContentRejected requires a reason_code from the RejectionReasonCode enum (F003).',
  'FALLBACK_COMMITTED cycles: all INFERENTIAL IntelligenceEvents are quarantined.',
  'Status transitions: PENDING → COLLECTING → REASONING → CRITIQUE → COMMITTING → COMMITTED|FAILED|FALLBACK_COMMITTED.',
] as const;
