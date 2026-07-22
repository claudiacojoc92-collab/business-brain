import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { generateId } from '@bb/shared';
import { sha256Hex } from '../business-model/context-snapshot';
import { PgPilotStore } from '../pilot/pg-pilot.repository';
import { isPilotAdmin, toCsv, PILOT_EVENTS } from '../pilot/pilot.service';

/**
 * Founder Validation Readiness — the protected internal pilot admin. Server-authorized by X-Pilot-Admin-Token (fail-closed
 * when unset); NOT session-based and never exposes founder content broadly. Provides invite management, a metadata summary,
 * facilitator annotations, WTP interview capture, and safe research export (raw business text excluded by default; a
 * deliberate per-founder raw export is separate). Founder identifiers are anonymized (hashed) in research exports.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;
const anon = (founderId: string): string => sha256Hex(founderId).slice(0, 12);

export function registerPilotAdminRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const pilot = new PgPilotStore(db);

  const admin = async (request: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    if (!isPilotAdmin(request)) { await reply.code(403).send({ error: 'forbidden' }); return false; }
    return true;
  };

  // ── invites ──────────────────────────────────────────────────────────────────────────────────────────────────────
  server.post('/admin/pilot/invites', async (request, reply) => {
    if (!(await admin(request, reply))) return;
    const b = (request.body ?? {}) as { cohort?: string; count?: number; note?: string };
    const cohort = (b.cohort ?? 'pilot-1').trim(); const count = Math.min(Math.max(Number(b.count ?? 1), 1), 50);
    const now = new Date(); const created: string[] = [];
    for (let i = 0; i < count; i++) { const code = `BB-${generateId().slice(-8).toUpperCase()}`; await pilot.createInvite(code, cohort, b.note ?? null, now); created.push(code); }
    await reply.code(201).send({ codes: created });
  });
  server.get('/admin/pilot/invites', async (request, reply) => { if (!(await admin(request, reply))) return; await reply.send({ invites: await pilot.listInvites() }); });
  server.post('/admin/pilot/invites/:code/disable', async (request, reply) => {
    if (!(await admin(request, reply))) return;
    await pilot.setInviteStatus((request.params as { code: string }).code, 'disabled', new Date());
    await reply.send({ disabled: true });
  });

  // ── founder access + facilitator + WTP (admin-recorded interview) ────────────────────────────────────────────────
  server.post('/admin/pilot/founders/:id/access', async (request, reply) => {
    if (!(await admin(request, reply))) return;
    const status = ((request.body as { status?: string })?.status ?? '') === 'disabled' ? 'disabled' : 'active';
    await pilot.updatePilotFounder((request.params as { id: string }).id, { accessStatus: status }, new Date());
    await reply.send({ accessStatus: status });   // disables access WITHOUT deleting founder data
  });
  server.post('/admin/pilot/founders/:id/wtp-open', async (request, reply) => {
    if (!(await admin(request, reply))) return;
    await pilot.updatePilotFounder((request.params as { id: string }).id, { wtpOpen: ((request.body as { open?: boolean })?.open) !== false }, new Date());
    await reply.send({ ok: true });
  });
  server.post('/admin/pilot/facilitator-note', async (request, reply) => {
    if (!(await admin(request, reply))) return;
    const b = (request.body ?? {}) as { founderId?: string; concernId?: string; author?: string; note?: string };
    if (!b.founderId || !b.note) { await reply.code(400).send({ error: 'founderId and note are required' }); return; }
    const id = await pilot.addFacilitatorNote(b.founderId, b.concernId ?? null, (b.author ?? 'facilitator').trim(), b.note, new Date());
    await reply.code(201).send({ id });   // research annotation ONLY — never enters AI context
  });
  server.post('/admin/pilot/wtp', async (request, reply) => {
    if (!(await admin(request, reply))) return;
    const b = (request.body ?? {}) as { founderId?: string; wouldContinue?: boolean; wouldMiss?: string; wouldPay?: boolean; amount?: number; priceBand?: string; basis?: string };
    if (!b.founderId) { await reply.code(400).send({ error: 'founderId is required' }); return; }
    const id = await pilot.addWtp(b.founderId, b, 'admin', new Date());
    await reply.code(201).send({ id });
  });

  // ── summary (metadata, deliberate drill-down) ────────────────────────────────────────────────────────────────────
  server.get('/admin/pilot/summary', async (request, reply) => {
    if (!(await admin(request, reply))) return;
    await reply.send({ founders: await buildSummary(db, pilot) });
  });

  // ── research export (raw business text EXCLUDED) — anonymized per-founder rows ────────────────────────────────────
  server.get('/admin/pilot/export.csv', async (request, reply) => {
    if (!(await admin(request, reply))) return;
    const rows = await buildSummary(db, pilot);
    const cols = ['anonId', 'cohort', 'accessStatus', 'setupCompleted', 'realConcerns', 'firstConcernAt', 'secondConcernAt', 'naturalReturn', 'clarityResults', 'accepted', 'corrected', 'revalidated', 'contextReused', 'feedbackClearer', 'feedbackChangedAttention', 'feedbackReachedAlone', 'wouldContinue', 'wouldPay', 'amount', 'basis'];
    reply.header('content-type', 'text/csv').header('content-disposition', 'attachment; filename="pilot-research.csv"');
    await reply.send(toCsv(rows as unknown as Array<Record<string, unknown>>, cols));
  });

  // ── anonymized research events (metadata only; no raw content) ───────────────────────────────────────────────────
  server.get('/admin/pilot/events.csv', async (request, reply) => {
    if (!(await admin(request, reply))) return;
    const events = await pilot.listEvents();
    const rows = events.map((e) => ({ anonId: e.founderId ? anon(e.founderId) : '', cohort: e.cohort ?? '', eventType: e.eventType, at: e.createdAt, meta: JSON.stringify(e.metadata) }));
    reply.header('content-type', 'text/csv').header('content-disposition', 'attachment; filename="pilot-events.csv"');
    await reply.send(toCsv(rows, ['anonId', 'cohort', 'eventType', 'at', 'meta']));
  });

  // ── DELIBERATE raw export for ONE founder (contains business text; separate, explicit) ───────────────────────────
  server.get('/admin/pilot/founders/:id/raw', async (request, reply) => {
    if (!(await admin(request, reply))) return;
    const f = (request.params as { id: string }).id;
    const [concerns, clarity, feedback, facilitator, notes] = await Promise.all([
      db.selectFrom('business.concern').selectAll().where('founder_id', '=', f).execute(),
      db.selectFrom('business.clarity_result').select(['id', 'concern_id', 'reflected_concern', 'clarified_issue', 'created_at']).where('founder_id', '=', f).execute(),
      pilot.listFeedback(f), pilot.listFacilitatorNotes(f), pilot.listWtp(f),
    ]);
    await pilot.emitEvent(f, null, PILOT_EVENTS.exportRequested, null, { by: 'admin' }, new Date());
    await reply.send({ founderId: f, concerns, clarity, feedback, facilitatorNotes: facilitator, wtp: notes });
  });
}

/** Per-founder research summary derived from immutable data + annotations. No raw concern/result text. */
async function buildSummary(db: AnyDB, pilot: PgPilotStore): Promise<Array<Record<string, unknown>>> {
  const pf = await db.selectFrom('pilot.pilot_founder').selectAll().execute();
  const out: Array<Record<string, unknown>> = [];
  for (const p of pf as AnyDB[]) {
    const fid = p.founder_id;
    const events = await pilot.listEvents(fid);
    const concernSubmits = events.filter((e) => e.eventType === PILOT_EVENTS.concernSubmitted);
    const accepted = (await db.selectFrom('business.proposed_understanding_change').select('id').where('founder_id', '=', fid).where('status', '=', 'accepted').execute()).length;
    const corrected = (await db.selectFrom('business.understanding_item').select('id').where('founder_id', '=', fid).where('origin', '=', 'founder_correction').execute()).length;
    const revalidated = (await db.selectFrom('business.understanding_revalidation').select('id').where('founder_id', '=', fid).execute()).length;
    const reused = (await db.selectFrom('business.clarity_context_use').select('id').where('founder_id', '=', fid).execute()).length > 0;
    const clarityResults = (await db.selectFrom('business.clarity_result').select('id').where('founder_id', '=', fid).execute()).length;
    const fb = (await pilot.listFeedback(fid)).slice(-1)[0];
    const wtp = (await pilot.listWtp(fid)).slice(-1)[0];
    out.push({
      anonId: anon(fid), founderId: fid, cohort: p.cohort, accessStatus: p.access_status, setupCompleted: p.setup_completed,
      realConcerns: concernSubmits.length, firstConcernAt: concernSubmits[0]?.createdAt ?? '', secondConcernAt: concernSubmits[1]?.createdAt ?? '',
      naturalReturn: events.some((e) => e.eventType === PILOT_EVENTS.secondDistinctConcern),
      clarityResults, accepted, corrected, revalidated, contextReused: reused,
      feedbackClearer: fb?.clearer ?? '', feedbackChangedAttention: fb?.changed_attention ?? '', feedbackReachedAlone: fb?.reached_alone ?? '',
      wouldContinue: wtp?.would_continue ?? '', wouldPay: wtp?.would_pay ?? '', amount: wtp?.amount ?? '', basis: wtp?.basis ?? '',
    });
  }
  return out;
}
