/**
 * Capability B v1 — declared intent capture. Turns the founder's answers to the six structured
 * questions (spec §2, designed backward from what Counsel needs) into `declared` evidence
 * fragments through the UNCHANGED three-layer honesty gate.
 *
 * `declared` is the model's existing THIRD confidence kind (ADR-007) — NOT observed, NOT inferred,
 * and NOT a new kind. It flows into the SAME recomputeFromSources path as observed; the frozen
 * engine already distinguishes it by source label (DECLARED_PATTERN → "the founder speaking").
 *
 * Provenance: source 'founder', an OPAQUE `conversation://` location URI whose label matches the
 * engine's DECLARED_PATTERN (so the engine attributes it as declared), visibility 'private'. Each
 * answer yields a unit fragment + one block fragment, so an inferred claim citing declared intent
 * resolves fail-closed (mirrors upload/google). Reversible defaults (question wording/order/count)
 * are noted; the six FIELDS are the architecture, the phrasing is polish.
 */
import { makeFragment, type EvidenceFragment, type IEvidenceRepository } from '@bb/domain';

export interface DeclaredField { key: string; label: string; question: string }

/** The six fields (spec §2). Wording/order = reversible default, tune later. */
export const DECLARED_FIELDS: DeclaredField[] = [
  { key: 'direction',   label: 'Direction',                 question: 'What are you actually trying to build?' },
  { key: 'target',      label: 'Target',                    question: 'Who are you really trying to serve?' },
  { key: 'changing',    label: "What's changing",           question: "What's changing for you right now?" },
  { key: 'challenge',   label: 'Biggest challenge now',     question: "What's your single biggest challenge right now?" },
  { key: 'assumptions', label: 'Load-bearing assumptions',  question: "What are you assuming that, if it turned out wrong, would hurt the most?" },
  { key: 'success',     label: 'Success definition',        question: 'A year from now, what would make this a clear win for you?' },
];

const FIELD_BY_KEY = new Map(DECLARED_FIELDS.map((f) => [f.key, f]));

/** Opaque declared-location URI. The "conversation" label makes the FROZEN engine's
 *  DECLARED_PATTERN treat it as a declared/spoken source. Never dereferenced. */
export function declaredUri(field: string): string {
  return `conversation://declared/${encodeURIComponent(field)}`;
}

export interface DeclaredAnswer { field: string; text: string }

/**
 * Build `declared` fragments for a founder's answers: for each answered field, a unit fragment
 * (the answer, engine input) + one block fragment (the same text, resolution unit so an inferred
 * claim citing declared intent resolves fail-closed). Typed `declared`, source 'founder',
 * visibility 'private' — through the UNCHANGED gate. Empty answers are skipped (no fabrication).
 */
export function buildDeclaredFragments(founderId: string, answers: DeclaredAnswer[]): EvidenceFragment[] {
  const frags: EvidenceFragment[] = [];
  for (const a of answers) {
    const text = a.text.trim();
    const meta = FIELD_BY_KEY.get(a.field);
    if (!text || !meta) continue; // unknown field or empty answer → nothing (honest silence)
    const common = {
      founderId, source: 'founder', platform: null, sourceUrl: declaredUri(a.field),
      confidenceKind: 'declared' as const, visibility: 'private' as const, occurredAt: null as Date | null,
    };
    frags.push(makeFragment({ ...common, payload: { text, field: a.field, question: meta.question, label: meta.label } }));
    frags.push(makeFragment({ ...common, payload: { kind: 'block', text, blockType: 'answer', field: a.field } }));
  }
  return frags;
}

/** Persist declared answers through the gate (append-only; content-addressed ids dedupe re-answers). */
export async function captureDeclared(
  founderId: string,
  answers: DeclaredAnswer[],
  repo: IEvidenceRepository,
): Promise<{ stored: number; deduped: number; fields: number }> {
  const frags = buildDeclaredFragments(founderId, answers);
  const res = frags.length ? await repo.appendMany(frags) : { stored: 0, deduped: 0 };
  return { ...res, fields: frags.filter((f) => f.payload?.['kind'] !== 'block').length };
}
