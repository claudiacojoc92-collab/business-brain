/**
 * Wave 4 — Strategic Execution Boundary (ADR-015). An append-only ledger of FOUNDER TESTIMONY about execution against a
 * plan milestone (or the plan). This is NOT execution, tasks, automation, or a product-performed action: the product
 * performs NOTHING and verifies NOTHING. Every active claim is UNVERIFIED_FOUNDER_REPORT / NOT_PERFORMED_BY_PRODUCT.
 * Effective state derives from an explicit sequence/predecessor chain (never createdAt). Corrections/withdrawals are new
 * events; history is never mutated. No plan/decision/commitment/review mutation; no downstream artifacts; no inference.
 *
 * Governed by docs/governance/strategic-execution-boundary-contract.md (L1–L12).
 */
import type { StrategicPlanRecord } from './strategic-plan';

export type ExecutionSubjectType = 'MILESTONE' | 'PLAN';
export const EXECUTION_SUBJECT_TYPES: ReadonlySet<string> = new Set(['MILESTONE', 'PLAN']);
/** Founder-reportable states. WITHDRAWN is an internal event state; effective becomes NOT_REPORTED (derived). */
export type ExecutionState = 'NOT_STARTED' | 'ATTEMPTED' | 'COMPLETED' | 'BLOCKED' | 'ABANDONED' | 'NOT_APPLICABLE';
export const EXECUTION_STATES: ReadonlySet<string> = new Set(['NOT_STARTED', 'ATTEMPTED', 'COMPLETED', 'BLOCKED', 'ABANDONED', 'NOT_APPLICABLE']);
export type ReportKind = 'REPORT' | 'CORRECT' | 'WITHDRAW';
export type EvidenceType = 'NOTE' | 'URL' | 'FILE_REFERENCE' | 'METRIC_OBSERVATION' | 'EXTERNAL_REFERENCE';
export const EVIDENCE_TYPES: ReadonlySet<string> = new Set(['NOTE', 'URL', 'FILE_REFERENCE', 'METRIC_OBSERVATION', 'EXTERNAL_REFERENCE']);

/** A bounded evidence reference. NEVER fetched, scraped, inspected, or verified by the product (Law 4). */
export interface EvidenceReference { type: EvidenceType; value: string; label: string | null }

export interface ExecutionReport {
  id: string; founderId: string;
  subjectType: ExecutionSubjectType; subjectId: string;
  planLogicalId: string; planId: string; planRevision: number;
  reportSequence: number; predecessorReportId: string | null;
  reportKind: ReportKind; executionState: ExecutionState | 'WITHDRAWN';
  founderStatement: string; occurredAt: string | null; reportedAt: string;
  evidenceReferences: EvidenceReference[]; idempotencyKey: string; source: string; createdAt: string;
}

export interface ExecutionReportInput {
  subjectType: ExecutionSubjectType; subjectId: string;
  executionState: ExecutionState; founderStatement: string; occurredAt?: string | null;
  evidenceReferences?: EvidenceReference[]; idempotencyKey: string;
}

export type ExecutionRejection =
  | 'PLAN_ITEM_NOT_FOUND' | 'INVALID_SUBJECT' | 'INVALID_STATE' | 'STATEMENT_REQUIRED' | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'INVALID_EVIDENCE' | 'ALREADY_ACTIVE' | 'NO_ACTIVE_REPORT' | 'STALE_HEAD';
export class ExecutionReportError extends Error {
  constructor(public readonly reason: ExecutionRejection, message: string) { super(message); this.name = 'ExecutionReportError'; }
}

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Normalise + bound evidence references. Rejects unknown types. Never verifies anything (Law 4). */
export function normalizeEvidence(refs: unknown): EvidenceReference[] {
  if (!Array.isArray(refs)) return [];
  return refs.slice(0, 20).map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const type = String(o['type'] ?? '');
    if (!EVIDENCE_TYPES.has(type)) throw new ExecutionReportError('INVALID_EVIDENCE', 'Unknown evidence type.');
    return { type: type as EvidenceType, value: s(o['value']).slice(0, 2000), label: s(o['label']) ? s(o['label']).slice(0, 200) : null };
  });
}

/**
 * The chain head for one subject on one EXACT plan revision = the highest-`reportSequence` event (deterministic; never
 * createdAt). Execution identity is REVISION-SCOPED (ADR-015 remediation): the chain is filtered by `planId` (the exact
 * plan revision), so a report on another revision's identical milestone id can never be the head here.
 */
export function chainHead(events: ExecutionReport[], planId: string, subjectType: ExecutionSubjectType, subjectId: string): ExecutionReport | null {
  const chain = events.filter((e) => e.planId === planId && e.subjectType === subjectType && e.subjectId === subjectId);
  return chain.length ? chain.reduce((hi, e) => (e.reportSequence > hi.reportSequence ? e : hi)) : null;
}
/** Is this subject on this exact plan revision currently under an active founder claim? (head exists and is not WITHDRAW) */
export function isActivelyReported(events: ExecutionReport[], planId: string, subjectType: ExecutionSubjectType, subjectId: string): boolean {
  const head = chainHead(events, planId, subjectType, subjectId);
  return head != null && head.reportKind !== 'WITHDRAW';
}

/** Deterministically assert an execution-report action is admissible. No inference, no verification. */
export function assertExecutionReportAdmissible(activelyReported: boolean, kind: ReportKind, input: ExecutionReportInput): void {
  if (!input.subjectType || !EXECUTION_SUBJECT_TYPES.has(input.subjectType)) throw new ExecutionReportError('INVALID_SUBJECT', 'Choose a plan milestone or the plan.');
  if (!s(input.idempotencyKey)) throw new ExecutionReportError('IDEMPOTENCY_KEY_REQUIRED', 'An execution report requires an idempotency key.');
  if (!s(input.founderStatement)) throw new ExecutionReportError('STATEMENT_REQUIRED', 'Say, in your words, what happened. This is your report — not verified by Business Brain.');
  if (kind !== 'WITHDRAW' && (!input.executionState || !EXECUTION_STATES.has(input.executionState))) throw new ExecutionReportError('INVALID_STATE', 'Choose a reported state.');
  if (kind === 'REPORT' && activelyReported) throw new ExecutionReportError('ALREADY_ACTIVE', 'There is already an active report here — correct or withdraw it instead.');
  if ((kind === 'CORRECT' || kind === 'WITHDRAW') && !activelyReported) throw new ExecutionReportError('NO_ACTIVE_REPORT', 'There is no active report to correct or withdraw.');
}

/** Lineage for the NEXT event on a subject's chain FOR ONE EXACT REVISION: seq = head.seq+1 (or 1 — a new revision restarts
 * at 1); predecessor = head.id (or null at seq 1). Revision-scoped, so a new revision's first report is always sequence 1. */
export function nextExecutionLineage(events: ExecutionReport[], planId: string, subjectType: ExecutionSubjectType, subjectId: string): { reportSequence: number; predecessorReportId: string | null } {
  const head = chainHead(events, planId, subjectType, subjectId);
  return head ? { reportSequence: head.reportSequence + 1, predecessorReportId: head.id } : { reportSequence: 1, predecessorReportId: null };
}

/** Build the immutable content fields (lineage computed separately by the repo under the chain lock). */
export function buildExecutionReportFields(plan: StrategicPlanRecord, kind: ReportKind, input: ExecutionReportInput, now: Date): Omit<ExecutionReport, 'id' | 'founderId' | 'reportSequence' | 'predecessorReportId' | 'reportedAt' | 'createdAt'> {
  return {
    subjectType: input.subjectType, subjectId: s(input.subjectId).slice(0, 64),
    planLogicalId: plan.logicalPlanId, planId: plan.id, planRevision: plan.revision,
    reportKind: kind, executionState: kind === 'WITHDRAW' ? 'WITHDRAWN' : input.executionState,
    founderStatement: s(input.founderStatement).slice(0, 4000),
    occurredAt: input.occurredAt && s(input.occurredAt) ? new Date(input.occurredAt).toISOString() : null,
    evidenceReferences: normalizeEvidence(input.evidenceReferences), idempotencyKey: s(input.idempotencyKey).slice(0, 200), source: 'FOUNDER',
  };
}

export interface EffectiveExecution {
  subjectType: ExecutionSubjectType; subjectId: string;
  reportedState: ExecutionState | 'NOT_REPORTED';
  headReportId: string | null; reportSequence: number;
  founderStatement: string | null; occurredAt: string | null; reportedAt: string | null;
  evidenceReferences: EvidenceReference[];
  verificationStatus: 'UNVERIFIED_FOUNDER_REPORT' | 'NONE';
  productExecutionStatus: 'NOT_PERFORMED_BY_PRODUCT';
}

/** Derive effective founder-reported state per (EXACT plan revision, subject) from the chain head (Law 8 + revision-scope:
 * absence/withdraw → NOT_REPORTED; a report on one revision never affects another's effective state). */
export function deriveEffectiveExecution(events: ExecutionReport[]): EffectiveExecution[] {
  const heads = new Map<string, ExecutionReport>();
  for (const e of events) {
    const key = `${e.planId}::${e.subjectType}::${e.subjectId}`; // revision-scoped identity
    const cur = heads.get(key);
    if (!cur || e.reportSequence > cur.reportSequence) heads.set(key, e);
  }
  return [...heads.values()].map((h) => effectiveFromHead(h)).sort((a, b) => (a.subjectId < b.subjectId ? -1 : 1));
}

/** Effective execution for a single subject given its head (or a synthetic NOT_REPORTED when no head). */
export function effectiveFromHead(head: ExecutionReport | null, subjectType?: ExecutionSubjectType, subjectId?: string): EffectiveExecution {
  if (!head) return { subjectType: subjectType ?? 'MILESTONE', subjectId: subjectId ?? '', reportedState: 'NOT_REPORTED', headReportId: null, reportSequence: 0, founderStatement: null, occurredAt: null, reportedAt: null, evidenceReferences: [], verificationStatus: 'NONE', productExecutionStatus: 'NOT_PERFORMED_BY_PRODUCT' };
  const withdrawn = head.reportKind === 'WITHDRAW';
  return {
    subjectType: head.subjectType, subjectId: head.subjectId,
    reportedState: withdrawn ? 'NOT_REPORTED' : (head.executionState as ExecutionState),
    headReportId: head.id, reportSequence: head.reportSequence,
    founderStatement: withdrawn ? null : head.founderStatement, occurredAt: withdrawn ? null : head.occurredAt,
    reportedAt: head.reportedAt, evidenceReferences: withdrawn ? [] : head.evidenceReferences,
    verificationStatus: withdrawn ? 'NONE' : 'UNVERIFIED_FOUNDER_REPORT',
    productExecutionStatus: 'NOT_PERFORMED_BY_PRODUCT',
  };
}

/** Founder-legible label — NEVER a bare "Completed" (Law 3/12). */
export function reportedLabel(state: ExecutionState | 'NOT_REPORTED'): string {
  switch (state) {
    case 'NOT_REPORTED': return 'No execution report';
    case 'NOT_STARTED': return 'Reported not started';
    case 'ATTEMPTED': return 'Reported attempted';
    case 'COMPLETED': return 'Reported completed';
    case 'BLOCKED': return 'Reported blocked';
    case 'ABANDONED': return 'Reported abandoned';
    case 'NOT_APPLICABLE': return 'Reported not applicable';
  }
}

/** Founder-safe view of one immutable report event. */
export function toExecutionReportView(e: ExecutionReport) {
  return {
    reportId: e.id, subjectType: e.subjectType, subjectId: e.subjectId, reportKind: e.reportKind,
    executionState: e.executionState, label: e.reportKind === 'WITHDRAW' ? 'Withdrew report' : reportedLabel(e.executionState as ExecutionState),
    founderStatement: e.founderStatement, occurredAt: e.occurredAt, reportedAt: e.reportedAt,
    evidenceReferences: e.evidenceReferences, reportSequence: e.reportSequence, predecessorReportId: e.predecessorReportId,
    plan: { logicalPlanId: e.planLogicalId, planId: e.planId, revision: e.planRevision },
    // constant truth reminders (Laws 3, 4, 5)
    verificationStatus: e.reportKind === 'WITHDRAW' ? 'NONE' : 'UNVERIFIED_FOUNDER_REPORT',
    productExecutionStatus: 'NOT_PERFORMED_BY_PRODUCT', evidenceVerified: false,
  };
}

/** Founder-safe effective-execution view (label + explicit unverified + not-performed-by-product). */
export function toEffectiveExecutionView(e: EffectiveExecution) {
  return {
    subjectType: e.subjectType, subjectId: e.subjectId,
    reportedState: e.reportedState, label: reportedLabel(e.reportedState),
    founderStatement: e.founderStatement, occurredAt: e.occurredAt, reportedAt: e.reportedAt,
    evidenceReferences: e.evidenceReferences, headReportId: e.headReportId, reportSequence: e.reportSequence,
    verificationStatus: e.verificationStatus, productExecutionStatus: e.productExecutionStatus, evidenceVerified: false,
  };
}
