/**
 * Business Brain V1 — Promotion criteria (pure).
 * A Candidate is promotable only when import is Sufficient, diagnosis was
 * Produced, and validation Passed. Promotion itself is atomic (coordination).
 */
import type { ImportState, DiagnosisState, ValidationState } from './model';

export function meetsPromotionCriteria(args: {
  readonly importState: ImportState;
  readonly diagnosisState: DiagnosisState;
  readonly validationState: ValidationState;
}): boolean {
  return (
    args.importState === 'sufficient' &&
    args.diagnosisState === 'produced' &&
    args.validationState === 'passed'
  );
}
