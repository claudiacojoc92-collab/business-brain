import type { LandingProposition } from './contracts';

/**
 * Per-class divergence MEASUREMENT (non-blocking) — for every licensed atom class EXCEPT people (which the
 * people-fidelity guard blocks on), record whether the draft reproduced the licensed value verbatim (folded)
 * or diverged. Romanian inflects, so divergence is EXPECTED for services ("Kinetoterapie" → "kinetoterapia
 * noastră") and policy (reworded) — the point is DATA: how much each class diverges, so a later decision about
 * constraining a class rests on measurement, not a hunch. We do not constrain on it today.
 */
export interface ClassDivergence { readonly present: number; readonly diverged: number; readonly divergedValues: string[] }

const MEASURED: ReadonlyArray<NonNullable<LandingProposition['atomClass']>> = ['service', 'location', 'contact_booking', 'policy'];
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function measureDivergence(draftText: string, props: readonly LandingProposition[]): Record<string, ClassDivergence> {
  const fd = fold(draftText);
  const out: Record<string, ClassDivergence> = {};
  for (const cls of MEASURED) {
    const values = props.filter((p) => p.atomClass === cls).map((p) => p.text);
    if (!values.length) continue;
    const diverged = values.filter((v) => !fd.includes(fold(v)));
    out[cls] = { present: values.length - diverged.length, diverged: diverged.length, divergedValues: diverged };
  }
  return out;
}

/** One-line, log-friendly summary: "service 2/10 verbatim; policy 0/4 verbatim; …". */
export function summarizeDivergence(d: Record<string, ClassDivergence>): string {
  const parts = Object.entries(d).map(([cls, v]) => `${cls} ${v.present}/${v.present + v.diverged} verbatim`);
  return parts.length ? parts.join('; ') : '(no measured-class atoms)';
}
