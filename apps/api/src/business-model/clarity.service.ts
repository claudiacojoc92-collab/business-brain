/**
 * Clarity / Sensemaking service — the orchestration + the confirmation boundary. A clarity turn: preserve the founder's
 * message → retrieve confirmed context → audit via the model → validate (fail closed) → persist an immutable clarity result
 * and any PROPOSED Understanding changes (pending). It NEVER writes confirmed Understanding. Accepting a proposal is a
 * separate, explicit founder action. Crystallizing into a Strategy Thread happens only on explicit founder confirmation.
 */
import { generateId } from '@bb/shared';
import type { ClarityModel } from './clarity-model';
import type { ClarityResult } from './clarity-result';
import { assembleClarityContext, type ClarityContextDeps } from './clarity-context';
import { PgClarityStore, type ProposedChangeRow } from './pg-clarity.repository';
import type { PgStrategicSessionRepository } from './pg-strategic-session.repository';
import type { PgContextSnapshotRepository } from './pg-context-snapshot.repository';
import type { PgUnderstandingItemRepository, UnderstandingItem } from './pg-understanding-item.repository';
import type { TruthLabel } from './clarity-result';
import { classifyStrategicJob } from './strategy-classifier';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export interface ClarityTurnResult {
  ok: boolean;                       // false → the model output was unusable; nothing new persisted; founder text preserved
  concernId: string;
  result: ClarityResult | null;
  proposedChanges: ProposedChangeRow[];
  retry: boolean;                    // true when ok=false and the founder should retry
}

export interface ClarityServiceDeps extends ClarityContextDeps {
  store: PgClarityStore;
  model: ClarityModel;
  db: AnyDB;                                   // for the transactional acceptance (item + resolution, atomic)
  understandingItems: PgUnderstandingItemRepository;
}

export class ClarityService {
  constructor(private readonly deps: ClarityServiceDeps) {}

  /** Start a new concern, or continue an existing one, with one founder message → one clarity turn. */
  async turn(founderId: string, founderInput: string, concernId: string | null, now: Date = new Date()): Promise<ClarityTurnResult> {
    const concern = concernId ? await this.deps.store.getConcern(founderId, concernId) : await this.deps.store.createConcern(founderId, founderInput, now);
    if (!concern) throw new Error('concern not found');

    // 1) Preserve the founder's testimony FIRST (never lost, even if the model fails).
    const prior = await this.deps.store.listMessages(founderId, concern.id);
    await this.deps.store.addMessage(founderId, concern.id, 'FOUNDER', founderInput, now);

    // 2) Retrieve confirmed context and audit.
    const context = await assembleClarityContext(founderId, this.deps, now);
    const result = await this.deps.model.clarify({ founderInput, priorMessages: prior.map((m) => ({ actor: m.actor, content: m.content })), context });

    // 3) Fail closed: no usable structured result → truthful retry; persist NO assistant turn, NO proposed state.
    if (!result) return { ok: false, concernId: concern.id, result: null, proposedChanges: [], retry: true };

    // 4) Persist the assistant turn: a plain-language message + the immutable structured result + PENDING proposed changes.
    const assistantText = result.clarifiedIssue ?? result.reflectedConcern;
    const msg = await this.deps.store.addMessage(founderId, concern.id, 'BUSINESS_BRAIN', assistantText, now);
    const saved = await this.deps.store.saveClarityResult(founderId, concern.id, msg.id, result, now);
    const proposedChanges = result.proposedUnderstandingChanges.length
      ? await this.deps.store.saveProposedChanges(founderId, concern.id, saved.id, result.proposedUnderstandingChanges, now)
      : [];
    await this.deps.store.updateConcern(founderId, concern.id, { clarifiedConcern: result.clarifiedIssue, status: result.clarifiedIssue ? 'clarified' : 'open' }, now);

    return { ok: true, concernId: concern.id, result, proposedChanges, retry: false };
  }

  /**
   * Explicit founder action — accept a pending proposal. ATOMICALLY: create a durable founder-governed Understanding item
   * AND mark the proposal accepted, in one transaction (both succeed or neither — a proposal is never accepted while its
   * Understanding write fails). The item carries a truth label that keeps it distinct from a Business Brain inference and
   * does NOT convert uncertainty into fact (an "unconfirmed / we disagree" proposal stays a disagreement). Returns the new
   * item, or null if the proposal isn't pending/owned. Confirmed only through THIS action; conversation never writes it.
   */
  async acceptProposedChange(founderId: string, changeId: string, now: Date = new Date()): Promise<UnderstandingItem | null> {
    const change = await this.deps.store.getProposedChange(founderId, changeId);
    if (!change || change.status !== 'pending') return null;
    // A CORRECT-type proposal supersedes a prior inference → "you corrected this"; otherwise keep the proposed label
    // (typically "you told me" for a founder affirmation, or "unconfirmed / we disagree" for an unresolved condition).
    const label: TruthLabel = change.changeType === 'CORRECT' ? 'you_corrected_this' : change.label;
    return this.deps.db.transaction().execute(async (tx: AnyDB) => {
      const item = await this.deps.understandingItems.create(founderId, {
        statement: change.statement, truthLabel: label, origin: 'clarity_acceptance',
        originConcernId: change.concernId, originClarityResultId: change.clarityResultId, originProposedChangeId: change.id,
      }, now, tx);
      const ok = await this.deps.store.resolveProposedChange(founderId, changeId, 'accepted', item.id, now, tx, item.id);
      if (!ok) throw new Error('proposal is no longer pending'); // rolls back the item insert — atomic
      return item;
    });
  }

  /**
   * Explicit founder action — correct a current Understanding item OR a synthesized conclusion. Appends a founder-authored
   * "you corrected this" item that SUPERSEDES the prior representation without deleting it (history preserved). Never alters
   * historical clarity results, recommendations, or decisions. Requires this explicit call; conversation alone cannot do it.
   */
  async correctUnderstanding(founderId: string, input: { supersedesItemId?: string; conclusionRef?: string; statement: string }, now: Date = new Date()): Promise<UnderstandingItem | null> {
    const statement = input.statement.trim();
    if (statement.length < 2) return null;
    if (input.supersedesItemId) {
      const prior = await this.deps.understandingItems.get(founderId, input.supersedesItemId);
      if (!prior) return null; // not owned / not found
    }
    return this.deps.understandingItems.create(founderId, {
      statement, truthLabel: 'you_corrected_this', origin: 'founder_correction',
      supersedesItemId: input.supersedesItemId ?? null, originConclusionRef: input.conclusionRef ?? null,
    }, now);
  }
  /** Explicit founder action — reject a pending proposal. Confirmed Understanding is left entirely unchanged. */
  async rejectProposedChange(founderId: string, changeId: string, now: Date = new Date()): Promise<boolean> {
    const change = await this.deps.store.getProposedChange(founderId, changeId);
    if (!change || change.status !== 'pending') return false;
    return this.deps.store.resolveProposedChange(founderId, changeId, 'rejected', null, now);
  }

  /** The founder-confirmed additions/corrections for the Understanding read model — accepted proposals only. */
  async confirmedFromClarity(founderId: string, concernId: string): Promise<ProposedChangeRow[]> {
    return (await this.deps.store.listProposedChanges(founderId, concernId)).filter((c) => c.status === 'accepted');
  }
}

export interface CrystallizeDeps {
  store: PgClarityStore;
  sessionRepo: PgStrategicSessionRepository;
  snapshotRepo: PgContextSnapshotRepository;
  captureContext: (founderId: string) => Promise<{ businessUnderstanding: unknown; founderStrategicContext: unknown; publicPositioningContext: unknown; provenance: unknown }>;
}

/**
 * Explicit founder confirmation → turn a clarified concern into a Strategy Thread (a strategic_session). It creates ONLY the
 * thread with the crystallized question; it creates NO recommendation and NO decision (the existing Strategy flow proceeds
 * from here). Returns the new session id, or null if the concern isn't ready/owned.
 */
export async function crystallizeConcern(founderId: string, concernId: string, question: string, deps: CrystallizeDeps, now: Date = new Date()): Promise<string | null> {
  const concern = await deps.store.getConcern(founderId, concernId);
  if (!concern || concern.crystallizedSessionId) return null;
  const cls = classifyStrategicJob(question);
  const subtype = cls.job === 'PRIORITY_DECISION' ? cls.subtype : 'GENERAL_30_DAY_PRIORITY';

  // Mint the frozen context snapshot the thread will reason from (Consumption Gate), then create the QUEUED thread.
  const c = await deps.captureContext(founderId);
  const snap = await deps.snapshotRepo.create(founderId, c.businessUnderstanding as never, c.founderStrategicContext as never, c.publicPositioningContext as never, c.provenance as never, now);
  const session = await deps.sessionRepo.create(founderId, {
    strategicJob: 'PRIORITY_DECISION', subtype, questionText: question,
    modelId: 'pending', promptVersion: 'pending', schemaVersion: 'pending', contextSnapshotId: snap.id,
  } as never, now);

  await deps.store.updateConcern(founderId, concernId, { status: 'crystallized', crystallizedSessionId: (session as { id: string }).id }, now);
  return (session as { id: string }).id;
}
