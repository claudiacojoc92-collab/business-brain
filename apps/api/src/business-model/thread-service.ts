/**
 * Business Memory v1 — thread service. Wires Open Threads into the C→B flow:
 *   - reconcileThreadsOnRecompute: after a REAL recompute, open/recur/resolve-tension-gone threads
 *     from the fresh grounded tensions, and persist (the DB half of "still knows me");
 *   - markItems: annotate "what matters now" with new / recurring / addressed / resolved from thread
 *     STATE (grounded signature lookup — never the churny tensionId);
 *   - selectFollowUp: on a returning session, pick the highest-priority OPEN thread and build a
 *     grounded, honest proactive follow-up (history + current framing + an ask — never a prescription);
 *   - resolveByDecision / addressByResponse: grounded state transitions from an explicit founder action,
 *     applied to the LIVE thread and persisted.
 * No new confidence_kind, no second pipeline — threads are STATE over C's existing tensions.
 */
import type { IEvidenceRepository, EvidenceFragment } from '@bb/domain';
import { buildWhatMattersNow, type WhatMattersItem } from './what-matters';
import { responsesByTension } from './memory';
import {
  groundedAnchors, reconcileRecompute, applyDecisionToThreads, applyResponseToThreads,
  type MemoryThread, type IThreadRepository, type ThreadStatus,
} from './thread';

const inferredOf = (all: EvidenceFragment[]) => all.filter((f) => f.confidenceKind === 'inferred');

/** Reconcile threads against a fresh recompute's grounded tensions, then persist. Call after recompute. */
export async function reconcileThreadsOnRecompute(
  founderId: string, all: EvidenceFragment[], threadRepo: IThreadRepository, now: Date,
): Promise<MemoryThread[]> {
  const byId = new Map(all.map((f) => [f.id, f]));
  const items = buildWhatMattersNow(inferredOf(all), all);
  const existing = await threadRepo.load(founderId);
  const { threads } = reconcileRecompute(founderId, existing, items, byId, now);
  await threadRepo.save(founderId, threads);
  return threads;
}

export type ThreadMark = 'new' | 'recurring' | 'addressed' | 'resolved';
export interface MarkedItem extends WhatMattersItem { mark: ThreadMark; signature: string; recurrenceCount: number }

const MARK_OF: Record<ThreadStatus, ThreadMark> = { open: 'new', recurring: 'recurring', addressed: 'addressed', resolved: 'resolved' };

/** Annotate current "what matters" items with their thread STATE, matched by grounded signature. */
export function markItems(items: WhatMattersItem[], threads: MemoryThread[], byId: Map<string, EvidenceFragment>): MarkedItem[] {
  const bySig = new Map(threads.map((t) => [t.signature, t]));
  return items.map((it) => {
    const sig = groundedAnchors(it, byId).signature;
    const t = bySig.get(sig);
    return { ...it, signature: sig, mark: t ? MARK_OF[t.status] : 'new', recurrenceCount: t?.recurrenceCount ?? 1 };
  });
}

export interface FollowUp {
  signature: string;
  tensionId: string;
  category: string;
  statement: string;        // C's tension observation, verbatim — never rewritten
  recurrenceCount: number;
  firstSeen: string;        // ISO — when this thread first opened
  observedKeys: string[];   // where in the evidence it is grounded
  framing: string;          // grounded recall of the thread's history (no fabrication)
  ask: string;              // an honest ASK, never a prescription
}

/** Proactive follow-up for a RETURNING session: the highest-priority OPEN thread (open/recurring/
 *  addressed, never resolved), framed from its real history + current grounding + an honest ask. */
export function selectFollowUp(markedItems: MarkedItem[], threads: MemoryThread[]): FollowUp | null {
  const bySig = new Map(threads.map((t) => [t.signature, t]));
  const candidate = markedItems.find((it) => { const s = bySig.get(it.signature)?.status; return s === 'open' || s === 'recurring' || s === 'addressed'; });
  if (!candidate) return null;
  const t = bySig.get(candidate.signature)!;
  const recalled = t.recurrenceCount > 1
    ? `When you were last here, this same tension was open — it has now surfaced ${t.recurrenceCount} times.`
    : `When you were last here, this was the tension I flagged as mattering most.`;
  const where = candidate.observedFragmentIds.length ? ' It is still grounded in the same evidence on your site.' : '';
  return {
    signature: t.signature, tensionId: candidate.tensionId, category: candidate.category,
    statement: candidate.statement, recurrenceCount: t.recurrenceCount, firstSeen: t.firstSeenAt.toISOString(),
    observedKeys: t.observedKeys,
    framing: `${recalled}${where}`,
    ask: 'Is this still where you are — or have you moved on it? You can tell me it is handled, add the context I am missing, or record a decision.',
  };
}

export interface MemoryThreadState { whatMattersNow: MarkedItem[]; followUp: FollowUp | null; threadCount: number; openCount: number }

/** Returning-session state WITH threads — reads persisted evidence + thread STATE, NO recompute. */
export async function readMemoryThreadState(founderId: string, evidenceRepo: IEvidenceRepository, threadRepo: IThreadRepository): Promise<MemoryThreadState> {
  const all = await evidenceRepo.findByFounder(founderId);
  const byId = new Map(all.map((f) => [f.id, f]));
  const items = buildWhatMattersNow(inferredOf(all), all);
  const threads = await threadRepo.load(founderId);
  const marked = markItems(items, threads, byId);
  return {
    whatMattersNow: marked,
    followUp: selectFollowUp(marked, threads),
    threadCount: threads.length,
    openCount: threads.filter((t) => t.status !== 'resolved').length,
  };
}

/** Grounded resolution from an explicit founder DECISION on the live tension → resolved(decision), persisted. */
export async function resolveByDecision(founderId: string, tensionId: string, threadRepo: IThreadRepository, now: Date): Promise<MemoryThread | null> {
  const threads = applyDecisionToThreads(await threadRepo.load(founderId), tensionId, now);
  await threadRepo.save(founderId, threads);
  return threads.find((t) => t.currentTensionId === tensionId && t.status === 'resolved') ?? null;
}

/** Grounded transition from a founder RESPONSE on the live tension → resolved(handled) or addressed, persisted. */
export async function addressByResponse(founderId: string, tensionId: string, all: EvidenceFragment[], threadRepo: IThreadRepository, now: Date): Promise<MemoryThread | null> {
  const resp = responsesByTension(all).get(tensionId);
  if (!resp) return null;
  const threads = applyResponseToThreads(await threadRepo.load(founderId), tensionId, resp, now);
  await threadRepo.save(founderId, threads);
  return threads.find((t) => t.currentTensionId === tensionId) ?? null;
}
