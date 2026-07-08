/**
 * Business Memory v1 — Decisions. An explicit founder COMMITMENT about a tension ("I have decided to
 * X"), captured as `declared`/`founder` evidence through B's EXACT pipeline — structurally identical
 * to a memory.ts response, a DIFFERENT payload intent. No new confidence_kind, no second pipeline: a
 * decision is just more `declared` evidence, so it RE-ENTERS the SAME recomputeFromSources on the next
 * reflection, and it can serve as a GROUNDED reason to resolve the tension's Open Thread.
 *
 * FAIL CLOSED — the anti-fabrication rule for decisions: a Decision fragment is built ONLY from an
 * explicit founder commitment (founder id + the tension it answers + a non-empty commitment text).
 * There is NO path that infers a decision; the engine/LLM never produce one. Missing any part → nothing.
 */
import { makeFragment, type EvidenceFragment, type IEvidenceRepository } from '@bb/domain';

/** An explicit founder commitment about a shown tension. `commitment` is the founder's own words. */
export interface Decision { tensionId: string; tensionStatement: string; commitment: string }

/** Opaque declared-location URI for a decision. The "conversation" label matches the FROZEN engine's
 *  DECLARED_PATTERN (→ attributed as the founder speaking); the tension id ties it to what it commits on.
 *  Never dereferenced. */
export function decisionUri(tensionId: string): string {
  return `conversation://decision/${encodeURIComponent(tensionId)}`;
}

/** Render the decision as declared TEXT the engine can read: quotes the tension as CONTEXT, then the
 *  founder's own commitment. Framed as the founder DECIDING — never asserting the tension as fact. */
function renderDecision(d: Decision): string {
  return `On the tension I was shown — "${d.tensionStatement.trim()}" — I have decided: ${d.commitment.trim()}`;
}

/**
 * Build `declared` fragments for a founder decision — B's exact shape: a unit fragment (engine input)
 * + one block fragment (resolution unit, so a future inferred claim citing the decision resolves
 * fail-closed). Provenance: payload.decidesOn = the tension fragment id. FAIL CLOSED: missing founder /
 * tension id / statement / commitment → [] (no fabricated decision, no inferred decision).
 */
export function buildDecisionFragments(founderId: string, d: Decision): EvidenceFragment[] {
  const stmt = d.tensionStatement?.trim();
  const commit = d.commitment?.trim();
  if (!founderId || !d.tensionId || !stmt || !commit) return [];
  const text = renderDecision(d);
  const common = {
    founderId, source: 'founder', platform: null, sourceUrl: decisionUri(d.tensionId),
    confidenceKind: 'declared' as const, visibility: 'private' as const, occurredAt: null as Date | null,
  };
  return [
    makeFragment({ ...common, payload: { text, decidesOn: d.tensionId, commitment: commit, tensionStatement: stmt, field: 'decision', label: 'Your decision' } }),
    makeFragment({ ...common, payload: { kind: 'block', text, blockType: 'decision', decidesOn: d.tensionId } }),
  ];
}

/** Persist a decision through the UNCHANGED gate (append-only; content-addressed ids dedupe). */
export async function captureDecision(founderId: string, d: Decision, repo: IEvidenceRepository): Promise<{ stored: number; deduped: number }> {
  const frags = buildDecisionFragments(founderId, d);
  return frags.length ? repo.appendMany(frags) : { stored: 0, deduped: 0 };
}

export interface StoredDecision { tensionId: string; commitment: string; fragmentId: string }

/** Map tension-fragment-id → the founder's decision (reads declared decision UNITS only). A decision is
 *  a GROUNDED reason to resolve that tension's Open Thread (thread.ts applyDecisionToThreads). */
export function decisionsByTension(all: EvidenceFragment[]): Map<string, StoredDecision> {
  const m = new Map<string, StoredDecision>();
  for (const f of all) {
    if (f.confidenceKind !== 'declared' || f.source !== 'founder') continue;
    if (f.payload?.['kind'] === 'block') continue;
    const on = f.payload?.['decidesOn']; const commit = f.payload?.['commitment'];
    if (typeof on === 'string' && typeof commit === 'string' && commit) {
      m.set(on, { tensionId: on, commitment: commit, fragmentId: f.id });
    }
  }
  return m;
}
