/**
 * Business Memory v1 — the C→B response loop (persist + respond). Today C surfaces a "what matters
 * now" tension and the loop stops. This closes it: each tension gets a structured founder RESPONSE
 * ("this matters" / "already handled" / "here's the missing context" + optional free text) that
 * becomes a `declared` fragment through B's EXACT pipeline — source 'founder', confidence_kind
 * 'declared', an opaque conversation:// URI (matches the FROZEN engine's DECLARED_PATTERN), unit +
 * block, visibility 'private', through the UNCHANGED honesty gate (makeFragment).
 *
 * No new confidence_kind, no second pipeline: the response is just more `declared` evidence, so it
 * RE-ENTERS the SAME recomputeFromSources on the next reflection — the next reflection reflects what
 * the founder said about C's own reasoning. Provenance ties the response to the specific tension it
 * answers (payload.respondsTo = the tension fragment's id). Attributed as declared ("you told me"),
 * NEVER as observed fact. Fail closed: no tension → no response.
 */
import { makeFragment, type EvidenceFragment, type IEvidenceRepository } from '@bb/domain';
import type { WhatMattersItem } from './what-matters';

/** The structured response set (reversible default — not open chat). */
export type ResponseChoice = 'matters' | 'handled' | 'context';
export interface TensionResponse { tensionId: string; tensionStatement: string; choice: ResponseChoice; text?: string }

const CHOICE_PHRASE: Record<ResponseChoice, string> = {
  matters: 'I agree this is what matters most right now',
  handled: 'I have already handled this',
  context: 'here is the context I think is missing',
};

/** Opaque declared-location URI for a response. The "conversation" label makes the FROZEN engine's
 *  DECLARED_PATTERN attribute it as the founder speaking; the tension id ties it to what it answers.
 *  Never dereferenced. */
export function responseUri(tensionId: string): string {
  return `conversation://response/${encodeURIComponent(tensionId)}`;
}

/** Render the response as declared TEXT the engine can read: quotes the tension as CONTEXT, then the
 *  founder's own position. Framed as the founder RESPONDING — never asserting the tension as fact. */
function renderResponse(r: TensionResponse, stmt: string): string {
  const base = `On the tension I was shown — "${stmt}" — ${CHOICE_PHRASE[r.choice]}`;
  const extra = r.text?.trim();
  return extra ? `${base}: ${extra}` : `${base}.`;
}

/**
 * Build `declared` fragments for a founder's response to a C tension — B's exact shape: a unit
 * fragment (engine input) + one block fragment (resolution unit, so a future inferred claim citing
 * the response resolves fail-closed). Provenance: payload.respondsTo = the tension fragment id.
 * FAIL CLOSED: missing founder / tension id / statement → nothing (no fabricated response).
 */
export function buildResponseFragments(founderId: string, r: TensionResponse): EvidenceFragment[] {
  const stmt = r.tensionStatement?.trim();
  if (!founderId || !r.tensionId || !stmt) return [];
  const text = renderResponse(r, stmt);
  const common = {
    founderId, source: 'founder', platform: null, sourceUrl: responseUri(r.tensionId),
    confidenceKind: 'declared' as const, visibility: 'private' as const, occurredAt: null as Date | null,
  };
  return [
    makeFragment({ ...common, payload: { text, respondsTo: r.tensionId, choice: r.choice, tensionStatement: stmt, field: 'response', label: 'Your response' } }),
    makeFragment({ ...common, payload: { kind: 'block', text, blockType: 'response', respondsTo: r.tensionId, choice: r.choice } }),
  ];
}

/** Persist a response through the UNCHANGED gate (append-only; content-addressed ids dedupe). */
export async function captureResponse(founderId: string, r: TensionResponse, repo: IEvidenceRepository): Promise<{ stored: number; deduped: number }> {
  const frags = buildResponseFragments(founderId, r);
  return frags.length ? repo.appendMany(frags) : { stored: 0, deduped: 0 };
}

export interface StoredResponse { choice: ResponseChoice; text: string; fragmentId: string }

/** Map tension-fragment-id → the founder's prior response (reads declared response UNITS only). */
export function responsesByTension(all: EvidenceFragment[]): Map<string, StoredResponse> {
  const m = new Map<string, StoredResponse>();
  for (const f of all) {
    if (f.confidenceKind !== 'declared' || f.source !== 'founder') continue;
    if (f.payload?.['kind'] === 'block') continue;
    const rt = f.payload?.['respondsTo']; const c = f.payload?.['choice'];
    if (typeof rt === 'string' && (c === 'matters' || c === 'handled' || c === 'context')) {
      m.set(rt, { choice: c, text: String(f.payload?.['text'] ?? ''), fragmentId: f.id });
    }
  }
  return m;
}

export interface RespondedItem extends WhatMattersItem { response?: StoredResponse }

/**
 * Fold prior responses into "what matters now": annotate each item with the founder's response, and
 * DEPRIORITIZE tensions the founder marked 'handled' (stable sort; reversible default). This is the
 * visible half of the closed loop — the next reflection reflects the response. (The engine also
 * re-reads the response as declared input on recompute; that is the deeper, live half.)
 */
export function applyResponses(items: WhatMattersItem[], byTension: Map<string, StoredResponse>): RespondedItem[] {
  const annotated: RespondedItem[] = items.map((it) => ({ ...it, response: byTension.get(it.tensionId) }));
  const handledWeight = (r?: StoredResponse) => (r?.choice === 'handled' ? 1 : 0);
  return annotated
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (handledWeight(a.it.response) - handledWeight(b.it.response)) || (a.i - b.i))
    .map((x, i) => ({ ...x.it, rank: i + 1 }));
}
