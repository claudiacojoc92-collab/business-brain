/**
 * Founder Validation Readiness — small, dependency-light helpers: research event names, admin authorization, CSV export
 * that is safe from formula injection, and second-concern classification. No product reasoning here.
 */
import type { FastifyRequest } from 'fastify';
import type { PgPilotStore } from './pg-pilot.repository';

/** Research event names (metadata only — never raw sensitive content in payloads). */
export const PILOT_EVENTS = {
  inviteAccepted: 'invite_accepted', setupStarted: 'setup_started', setupCompleted: 'setup_completed',
  concernSubmitted: 'concern_submitted', clarityProduced: 'clarity_produced', clarityFailed: 'clarity_failed',
  endedEnough: 'ended_enough', endedKeepExploring: 'ended_keep_exploring', endedStrategyThread: 'ended_strategy_thread',
  proposalAccepted: 'proposal_accepted', proposalRejected: 'proposal_rejected',
  contextRevalidatedConfirmed: 'context_revalidated_confirmed', contextRevalidatedUnsure: 'context_revalidated_unsure', contextCorrected: 'context_corrected',
  secondDistinctConcern: 'second_distinct_concern', feedbackSubmitted: 'feedback_submitted',
  exportRequested: 'data_export_requested', deletionRequested: 'account_deletion_requested',
} as const;

/** Admin authorization — server-side, fail-closed. An admin presents X-Pilot-Admin-Token matching PILOT_ADMIN_TOKEN. */
export function isPilotAdmin(request: FastifyRequest): boolean {
  const configured = process.env['PILOT_ADMIN_TOKEN'] ?? '';
  if (!configured) return false; // fail closed when unconfigured — no admin access by default
  const presented = request.headers['x-pilot-admin-token'];
  return typeof presented === 'string' && presented.length > 0 && timingSafeEqual(presented, configured);
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0; for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** Is pilot access enforced? Only when PILOT_MODE=1 (so existing tests/dev are unaffected). */
export function pilotModeOn(): boolean { return process.env['PILOT_MODE'] === '1'; }

// ── CSV (formula-injection safe) ─────────────────────────────────────────────────────────────────────────────────
const DANGEROUS = /^[=+\-@\t\r]/;
/** Neutralize spreadsheet formula injection AND CSV-quote. A cell starting with = + - @ tab CR is prefixed with a quote. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (DANGEROUS.test(s)) s = `'${s}`;              // formula-injection guard
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}
export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const header = columns.map(csvCell).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}

/**
 * Classify a submitted concern. A turn that creates a NEW concern (no concernId) is a distinct concern; a turn continuing
 * an existing concern is a continuation. The KEY voluntary-return signal is the founder's 2nd+ NEW distinct concern.
 */
export async function classifyConcern(store: PgPilotStore, founderId: string, isNewConcern: boolean): Promise<{ ordinal: number; kind: 'first' | 'new_distinct' | 'continuation' }> {
  if (!isNewConcern) return { ordinal: 0, kind: 'continuation' };
  const priorNew = await store.countConcernsSubmitted(founderId); // prior 'concern_submitted' events (new concerns only)
  const ordinal = priorNew + 1;
  return { ordinal, kind: ordinal === 1 ? 'first' : 'new_distinct' };
}
