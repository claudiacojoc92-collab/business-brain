/**
 * Business Brain V1 — deterministic Import producer (fixture).
 * Stands in for the real Instagram import behind the frozen logical boundary.
 * Produces TRANSIENT observations only; raw content is never persisted.
 */
import type { MeasureKind } from '../domain/model';

export interface TransientObservation {
  readonly kind: MeasureKind;
  readonly value?: number;
  readonly claimLabel: string;
}

export type ImportMode = 'sufficient' | 'insufficient';

/** Deterministic fixture: the travel/lifestyle/personal example account. */
export function deterministicImport(mode: ImportMode): readonly TransientObservation[] {
  if (mode === 'insufficient') {
    return [{ kind: 'presence', claimLabel: 'a single lifestyle observation' }];
  }
  return [
    { kind: 'proportion', value: 87, claimLabel: 'personal / lifestyle / travel share' },
    { kind: 'proportion', value: 5, claimLabel: 'business-relevant share' },
    { kind: 'absence', claimLabel: 'proof-of-results posts' },
    { kind: 'absence', claimLabel: 'recurring educational theme' },
  ];
}
