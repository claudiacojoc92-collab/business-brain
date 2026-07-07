/**
 * Business Memory v1 — Open Threads. Persisted STATE + history over C's EXISTING grounded tensions
 * (what-matters.ts). NOT a business profile, NOT a derived-fact/Company/Profile object, NOT a new
 * confidence_kind, NOT a second pipeline — just relationship state: which declared↔observed tension
 * is open / recurring / addressed / resolved, and how it got there.
 *
 * THREAD IDENTITY is the whole risk. A thread is matched across recomputes by its GROUNDED CONTENT —
 * category + declared FIELD(s) + observed SOURCE-KEY(s) — NEVER by the tension fragment's id. The
 * tensionId is `makeFragment`'s content address over statement + derivedFrom + evidenceChain, all of
 * which churn every recompute (LLM rewording, re-crawled evidence → new fragment ids). Matching on it
 * would re-create every thread each reflection — the amnesia failure. The declared field and the
 * observed page-key are the STABLE anchors: they survive rewording and evidence churn, and they
 * distinguish a tension on `direction` from one on `target`, or one page from another.
 *
 * RESOLUTION is never silent. A thread becomes 'resolved' ONLY via a grounded reason: the founder's
 * response was 'handled', a Decision committed, or the tension is GONE from a fresh recompute. No
 * recompute and no explicit grounded action → the thread stays open. Nothing here fabricates.
 */
import { createHash } from 'node:crypto';
import type { EvidenceFragment } from '@bb/domain';
import type { WhatMattersItem } from './what-matters';
import type { StoredResponse } from './memory';

export type ThreadStatus = 'open' | 'recurring' | 'addressed' | 'resolved';
export type ThreadEventType = 'opened' | 'recurred' | 'addressed' | 'resolved';
export type ResolveReason = 'handled' | 'decision' | 'tension_gone';

export interface ThreadEvent {
  event: ThreadEventType;
  at: Date;
  tensionId: string | null; // the churny inferred-fragment id at this moment — AUDIT ONLY, never identity
  reason?: ResolveReason;   // present on 'resolved' (the grounded reason)
}

export interface MemoryThread {
  founderId: string;
  signature: string;         // grounded identity — hash(category, declared FIELDS, observed SOURCE-KEYS)
  category: string;
  declaredFields: string[];  // sorted, unique — the declared anchor(s), for display/audit
  observedKeys: string[];    // sorted, unique — the observed source-key(s), for display/audit
  status: ThreadStatus;
  currentTensionId: string | null; // latest matched tension fragment id (link to the live C item + responses)
  resolvedReason: ResolveReason | null;
  recurrenceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  history: ThreadEvent[];
}

const fragmentKey = (f: EvidenceFragment): string => f.sourceUrl ?? f.source;
/** Declared anchor: the structural FIELD (direction/target/…). Falls back to the source-key (which for
 *  a declared answer is `conversation://declared/{field}` — still field-encoding) if a field is absent. */
const declaredAnchor = (f: EvidenceFragment): string => String(f.payload?.['field'] ?? f.sourceUrl ?? f.source);
const uniqSort = (xs: string[]): string[] => [...new Set(xs.filter(Boolean))].sort();

export interface GroundedAnchors { category: string; declaredFields: string[]; observedKeys: string[]; signature: string }

/**
 * The GROUNDED identity of a C tension: category + declared FIELD(s) + observed SOURCE-KEY(s), hashed.
 * Stable across recomputes (independent of statement wording, evidenceChain, and observed fragment ids).
 *
 * SAME-CELL BOUNDARY (accepted v1 definition of a thread): two SUBSTANTIVELY different tensions that
 * share the same (category, declared field, observed page) collapse to ONE thread — because a "thread"
 * IS the ongoing tension between a declared field and an observed surface. This is a conscious v1
 * definition, not a silent merge; distinct fields / pages / categories always separate.
 */
export function groundedAnchors(item: WhatMattersItem, byId: Map<string, EvidenceFragment>): GroundedAnchors {
  const declaredFields = uniqSort(item.declaredFragmentIds.map((id) => { const f = byId.get(id); return f ? declaredAnchor(f) : ''; }));
  const observedKeys = uniqSort(item.observedFragmentIds.map((id) => { const f = byId.get(id); return f ? fragmentKey(f) : ''; }));
  const category = item.category;
  const signature = createHash('sha256').update(JSON.stringify([category, declaredFields, observedKeys])).digest('hex');
  return { category, declaredFields, observedKeys, signature };
}

function cloneThread(t: MemoryThread): MemoryThread {
  return { ...t, declaredFields: [...t.declaredFields], observedKeys: [...t.observedKeys], history: t.history.map((e) => ({ ...e })) };
}

export interface ReconcileResult { threads: MemoryThread[]; opened: string[]; recurred: string[]; resolvedGone: string[] }

/**
 * Recompute-driven reconciliation. `items` MUST be the FULL fresh grounded-tension set from ONE
 * recompute (so absence is meaningful). Pure — clones input, returns the next thread set:
 *   - fresh signature, no thread  → OPEN a thread (history: 'opened'); never re-creates an existing one;
 *   - fresh signature matches a thread → RECUR (history: 'recurred'), NOT a new thread — even though the
 *     tensionId churned; a resolved thread whose tension reappears reopens to 'recurring';
 *   - a non-resolved thread whose signature is ABSENT from this fresh recompute → RESOLVE with reason
 *     'tension_gone' (grounded in THIS recompute — the engine no longer produces it).
 * Nothing else resolves here; explicit grounded resolution (response=handled / decision) is separate.
 */
export function reconcileRecompute(
  founderId: string,
  existing: MemoryThread[],
  items: WhatMattersItem[],
  byId: Map<string, EvidenceFragment>,
  now: Date,
): ReconcileResult {
  const threads = existing.map(cloneThread);
  const bySig = new Map(threads.map((t) => [t.signature, t]));
  const freshSigs = new Set<string>();
  const opened: string[] = [], recurred: string[] = [], resolvedGone: string[] = [];

  for (const item of items) {
    const a = groundedAnchors(item, byId);
    freshSigs.add(a.signature);
    const t = bySig.get(a.signature);
    if (!t) {
      const created: MemoryThread = {
        founderId, signature: a.signature, category: a.category, declaredFields: a.declaredFields, observedKeys: a.observedKeys,
        status: 'open', currentTensionId: item.tensionId, resolvedReason: null, recurrenceCount: 1,
        firstSeenAt: now, lastSeenAt: now, history: [{ event: 'opened', at: now, tensionId: item.tensionId }],
      };
      threads.push(created); bySig.set(a.signature, created); opened.push(a.signature);
    } else {
      // grounded content matched an existing thread despite tensionId churn → recurrence (or reopen).
      t.recurrenceCount += 1; t.currentTensionId = item.tensionId; t.lastSeenAt = now;
      t.resolvedReason = null; t.status = 'recurring';
      t.history.push({ event: 'recurred', at: now, tensionId: item.tensionId });
      recurred.push(a.signature);
    }
  }

  for (const t of threads) {
    if (!freshSigs.has(t.signature) && t.status !== 'resolved') {
      t.status = 'resolved'; t.resolvedReason = 'tension_gone'; t.lastSeenAt = now;
      t.history.push({ event: 'resolved', at: now, tensionId: t.currentTensionId, reason: 'tension_gone' });
      resolvedGone.push(t.signature);
    }
  }
  return { threads, opened, recurred, resolvedGone };
}

/**
 * Grounded resolution from the founder's RESPONSE to the currently-shown tension (memory.ts). 'handled'
 * is a grounded commitment that it is done → RESOLVED ('handled'). 'matters'/'context' is engagement,
 * not resolution → 'addressed' (still open in substance). Matches the thread by its CURRENT tension id
 * (the founder responds to the tension they were shown, so respondsTo === currentTensionId).
 */
export function applyResponseToThreads(threads: MemoryThread[], tensionId: string, response: StoredResponse, now: Date): MemoryThread[] {
  return threads.map((t0) => {
    if (t0.currentTensionId !== tensionId || t0.status === 'resolved') return t0;
    const t = cloneThread(t0);
    if (response.choice === 'handled') {
      t.status = 'resolved'; t.resolvedReason = 'handled';
      t.history.push({ event: 'resolved', at: now, tensionId, reason: 'handled' });
    } else {
      t.status = 'addressed';
      t.history.push({ event: 'addressed', at: now, tensionId });
    }
    return t;
  });
}

/** Grounded resolution from a captured Decision (an explicit declared/founder commitment, decision.ts).
 *  `decidesOn` = the tension id the commitment answers. Resolves the matching thread with reason 'decision'. */
export function applyDecisionToThreads(threads: MemoryThread[], tensionId: string, now: Date): MemoryThread[] {
  return threads.map((t0) => {
    if (t0.currentTensionId !== tensionId || t0.status === 'resolved') return t0;
    const t = cloneThread(t0);
    t.status = 'resolved'; t.resolvedReason = 'decision';
    t.history.push({ event: 'resolved', at: now, tensionId, reason: 'decision' });
    return t;
  });
}

/** Thread persistence contract (STATE, not append-only evidence). The Pg implementation + wiring land
 *  with the reflection surface (post-gate); the gate proves the matching/resolution logic in memory. */
export interface IThreadRepository {
  load(founderId: string): Promise<MemoryThread[]>;
  save(founderId: string, threads: MemoryThread[]): Promise<void>;
}

export class InMemoryThreadRepository implements IThreadRepository {
  private readonly byFounder = new Map<string, MemoryThread[]>();
  async load(founderId: string): Promise<MemoryThread[]> { return (this.byFounder.get(founderId) ?? []).map(cloneThread); }
  async save(founderId: string, threads: MemoryThread[]): Promise<void> { this.byFounder.set(founderId, threads.map(cloneThread)); }
}
