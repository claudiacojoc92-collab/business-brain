/**
 * P1 · Slice 1 — production declaration capture (Value Spine, declaration foundation).
 *
 * Layer-2 orchestration over the UNCHANGED Capability B write path (`buildDeclaredFragments`, declared.ts).
 * Two responsibilities, nothing more:
 *   1. validateDeclareInput — deterministic 4xx validation of the POST /api/declare body. Founder input
 *      never throws to a 500; every malformed shape maps to a bounded { error } message.
 *   2. replaceDeclared — a founder-scoped ATOMIC replace: in ONE transaction, delete the founder's prior
 *      declaration (source 'founder') then append the fresh declared fragments. Commit only if both
 *      succeed; any failure rolls back and the prior declaration is retained unchanged. Observed and
 *      inferred evidence are NEVER touched. The frozen engine is never called (no recompute, no reflection).
 */
import type { IEvidenceRepository } from '@bb/domain';
import { buildDeclaredFragments, DECLARED_FIELDS, type DeclaredAnswer } from './declared';

/** Size limits (spec §6.2 / §8). Per-answer text cap and the six-field ceiling. */
export const MAX_ANSWER_CHARS = 4000;
export const MAX_ANSWERS = DECLARED_FIELDS.length; // 6 — the fixed declared-field set
const FIELD_KEYS = new Set(DECLARED_FIELDS.map((f) => f.key));

export type DeclareValidation =
  | { ok: true; answers: DeclaredAnswer[] }
  | { ok: false; error: string };

/**
 * Validate the POST /api/declare body. Whitelists the six field keys, requires non-empty bounded text,
 * rejects duplicates and over-length. Returns a typed result; the route maps `ok:false` → 400. Never throws.
 */
export function validateDeclareInput(body: unknown): DeclareValidation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: 'body must be an object' };
  const raw = (body as Record<string, unknown>)['answers'];
  if (!Array.isArray(raw)) return { ok: false, error: 'answers must be an array' };
  if (raw.length < 1) return { ok: false, error: 'at least one answer is required' };
  if (raw.length > MAX_ANSWERS) return { ok: false, error: `at most ${MAX_ANSWERS} answers` };

  const answers: DeclaredAnswer[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return { ok: false, error: 'each answer must be an object' };
    const o = entry as Record<string, unknown>;
    const field = o['field'];
    const text = o['text'];
    if (typeof field !== 'string' || !FIELD_KEYS.has(field)) return { ok: false, error: 'unknown or missing field' };
    if (seen.has(field)) return { ok: false, error: 'duplicate field' };
    if (typeof text !== 'string' || text.trim().length === 0) return { ok: false, error: 'text must be a non-empty string' };
    if (text.length > MAX_ANSWER_CHARS) return { ok: false, error: `text exceeds ${MAX_ANSWER_CHARS} characters` };
    seen.add(field);
    answers.push({ field, text });
  }
  return { ok: true, answers };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any; // Kysely db handle (mirrors delete.service.ts); .transaction().execute(tx => …)

/**
 * Founder-scoped ATOMIC replace of declared evidence. ONE transaction:
 *   (1) delete the founder's prior declaration (source 'founder');
 *   (2) append the fresh declared fragments;
 *   (3) commit only if BOTH succeed — any throw rolls back the delete, leaving the prior declaration intact.
 * Observed (website/upload) and inferred (business-model) evidence are NOT touched. No engine call.
 *
 * NOTE (Slice-1 scope): `source:'founder'` is currently the ONLY declaration producer in production, so a
 * source-level replace is exact and safe. Before Bets/decisions (also source:'founder') are promoted in a
 * later slice, replace granularity must be narrowed (see spec §7 / risk R1). `failAfterDelete` is a TEST
 * SEAM only (proves rollback); production passes nothing.
 */
export async function replaceDeclared(args: {
  founderId: string;
  answers: DeclaredAnswer[];
  evidence: IEvidenceRepository;
  db: AnyDB;
  failAfterDelete?: () => Promise<void>;
}): Promise<{ stored: number; fieldsCaptured: number }> {
  const { founderId, answers, evidence, db, failAfterDelete } = args;
  const frags = buildDeclaredFragments(founderId, answers);
  const fieldsCaptured = frags.filter((f) => f.payload?.['kind'] !== 'block').length; // unit fragments = fields
  const res: { stored: number; deduped: number } = await db.transaction().execute(async (tx: unknown) => {
    await evidence.deleteBySource(founderId, 'founder', tx);       // replace: drop the prior declaration
    if (failAfterDelete) await failAfterDelete();                  // test seam: throw here ⇒ full rollback
    return frags.length ? await evidence.appendMany(frags, tx) : { stored: 0, deduped: 0 };
  });
  return { stored: res.stored, fieldsCaptured };
}
