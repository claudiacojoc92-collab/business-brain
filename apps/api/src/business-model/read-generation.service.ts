/**
 * Business Read GENERATION orchestration (S1-T4). Composes the S1-T1/T2/T3 pipeline behind ONE sanctioned
 * engine call and persists an immutable snapshot. This layer ORCHESTRATES existing services — it never
 * re-implements engine, recompute, assembler, receipt, or persistence semantics.
 *
 * ENGINE BOUNDARY (invariant): the frozen engine is called EXACTLY ONCE, via recomputeFromSources. The
 * assembler is engine-free (receipts resolve inside it, S1-T2). No per-section recompute, no second
 * interpretation pass, no mutation of engine output, no filler for empty sections — S4 stays empty.
 *
 * ATOMICITY: persistence (step 8) is the LAST action, after recompute + assemble + validate all pass. A
 * failure anywhere before it leaves NO snapshot (a Read is either complete-and-persisted or not created).
 */
import type { PgEvidenceRepository } from '@bb/infrastructure';
import { recomputeFromSources } from './recompute';
import { assembleRead, type BusinessRead, type SectionId } from './read-assembler';
import type { PgRecommendationRepository } from './pg-recommendation.repository';
import { PgBusinessReadRepository, READ_SCHEMA_VERSION, type StoredRead } from './pg-business-read.repository';

/** Outcome of a generation attempt — a real snapshot, or an HONEST domain "not yet" (a success state, not
 *  an error). A technical failure is NOT represented here: it throws and surfaces as a 500. */
export type GenerateOutcome =
  | { status: 'generated'; stored: StoredRead }
  | { status: 'insufficient_evidence'; reason: string; whatToDo: string };

/** The frozen 6-section order the assembler emits — the validation contract for a well-formed Read. */
const SECTION_ORDER: SectionId[] = ['what_i_read', 'what_i_observe', 'gaps', 'bets', 'my_read', 'cannot_see'];

/** A per-section non-empty summary for privacy-safe logging — COUNTS ONLY, never content. */
export function sectionCounts(read: BusinessRead): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of read.sections) out[s.id] = (s.claims?.length ?? 0) + (s.manifest?.length ?? 0) + (s.limits?.length ?? 0);
  return out;
}

// Structural validation of the assembled Read before it is allowed to persist. A malformed Read is a bug,
// not a founder state — it THROWS (→ 500), it is never persisted.
function assertWellFormed(read: BusinessRead, founderId: string): void {
  if (read.founderId !== founderId) throw new Error('assembled Read founderId mismatch');
  const ids = read.sections.map((s) => s.id);
  if (ids.length !== SECTION_ORDER.length || SECTION_ORDER.some((id, i) => ids[i] !== id)) {
    throw new Error(`assembled Read section order invalid: ${ids.join(',')}`);
  }
  const bets = read.sections.find((s) => s.id === 'bets');
  if (!bets || bets.empty !== true || (bets.claims?.length ?? 0) !== 0) throw new Error('assembled Read S4 (bets) must be empty');
}

export interface GenerateArgs {
  founderId: string;                       // the authenticated session founder (never client-asserted)
  evidence: PgEvidenceRepository;
  reads: PgBusinessReadRepository;
  recRepo: PgRecommendationRepository;
  anthropicApiKey: string;
  model?: string;
  now?: Date;
}

/**
 * Generate a fresh Read from the founder's PRESENT evidence and persist it. See the pipeline steps inline.
 * Eligibility is checked BEFORE the engine call, so a zero-evidence founder costs no engine call and
 * creates no snapshot — an honest "not yet", not an error.
 */
export async function generateBusinessRead(args: GenerateArgs): Promise<GenerateOutcome> {
  const { founderId, evidence, reads, recRepo, anthropicApiKey, model } = args;
  const now = args.now ?? new Date();

  // 2. Eligibility — the engine reads observed evidence; zero observed cannot ground a Read.
  const observed = await evidence.findObserved(founderId);
  if (observed.length === 0) {
    return {
      status: 'insufficient_evidence',
      reason: 'No grounded source evidence yet — there is nothing for me to read.',
      whatToDo: 'Connect a source (your website, a document, or Google) and I can generate your Business Read.',
    };
  }

  // 3. The ONE sanctioned engine call. Appends inferred fragments to the evidence store (existing behavior).
  const result = await recomputeFromSources({ founderId, repo: evidence, anthropicApiKey, model });

  // 4. Reload so the assembler sees the just-appended inferred fragments (memory-response precedent).
  const fragments = await evidence.findByFounder(founderId);
  // 5. LOAD stored recommendations for S5 (no refresh/regeneration — empty S5 is honest).
  const recommendations = await recRepo.load(founderId);
  // 6. Compose — engine-free; receipts resolved + attached inside assembleRead (S1-T2).
  const read = assembleRead(founderId, fragments, recommendations, result, now);
  // 7. Validate the complete Read (throws → 500 → NO persist).
  assertWellFormed(read, founderId);
  void READ_SCHEMA_VERSION; // the repo stamps + validates the version; referenced here to bind the contract

  // 8. Persist ONCE — the last action.
  const { readId } = await reads.save(read);
  // 9. Return the immutable snapshot exactly as stored.
  const stored = await reads.findById(founderId, readId);
  if (!stored) throw new Error('persisted Read could not be reloaded'); // never expected — fail loud
  return { status: 'generated', stored };
}
