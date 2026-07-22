import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { readCookie, SESSION_COOKIE } from '../session/cookie';
import { resolveSession } from '../session/session.service';
import { PgPilotStore } from '../pilot/pg-pilot.repository';
import { PgUnderstandingItemRepository } from '../business-model/pg-understanding-item.repository';
import { PILOT_EVENTS } from '../pilot/pilot.service';

/**
 * Founder Validation Readiness — the founder-facing pilot surface: invite activation (+ consent), minimal business setup
 * (which feeds the SAME accumulation engine — understanding items — so it is immediately useful to the clarity flow),
 * a research reality marker, optional post-clarity feedback, and an admin-gated willingness-to-pay prompt. Cookie session;
 * founder-scoped. All research annotations; nothing here enters the AI context beyond the founder-governed items setup makes.
 */
export function registerPilotRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const identity = new PgIdentityRepository(db);
  const pilot = new PgPilotStore(db);
  const items = new PgUnderstandingItemRepository(db);

  async function need(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const sid = readCookie(request.headers['cookie'], SESSION_COOKIE);
    const f = sid ? await resolveSession(sid, identity, new Date()) : null;
    if (!f) { await reply.code(401).send({ error: 'authentication required' }); return null; }
    return f;
  }

  // POST /pilot/activate — { code, consentPilot, consentResearchReview } → binds an invite to this founder + records consent.
  server.post('/pilot/activate', async (request, reply) => {
    const f = await need(request, reply); if (!f) return;
    const b = (request.body ?? {}) as { code?: string; consentPilot?: boolean; consentResearchReview?: boolean };
    const code = (b.code ?? '').trim();
    if (!code) { await reply.code(400).send({ error: 'an invite code is required' }); return; }
    if (b.consentPilot !== true) { await reply.code(400).send({ error: 'pilot consent is required to activate' }); return; }
    const invite = await pilot.getInvite(code);
    if (!invite || invite.status === 'disabled') { await reply.code(409).send({ error: 'this invite is not available' }); return; }
    // idempotent: if already activated by THIS founder, accept; if by another founder, refuse.
    if (invite.status === 'activated' && invite.founderId && invite.founderId !== f) { await reply.code(409).send({ error: 'this invite has already been used' }); return; }
    const now = new Date();
    if (invite.status === 'invited') { const ok = await pilot.activateInvite(code, f, now); if (!ok) { await reply.code(409).send({ error: 'this invite has already been used' }); return; } }
    await pilot.ensurePilotFounder(f, code, invite.cohort, now);
    await pilot.updatePilotFounder(f, { consentPilot: true, consentResearchReview: b.consentResearchReview === true }, now);
    await pilot.emitEvent(f, invite.cohort, PILOT_EVENTS.inviteAccepted, code, {}, now);
    await reply.code(200).send({ activated: true });
  });

  // GET /pilot/me — the founder's pilot status (access / consent / setup).
  server.get('/pilot/me', async (request, reply) => {
    const f = await need(request, reply); if (!f) return;
    await reply.send({ pilot: await pilot.getPilotFounder(f) });
  });

  // POST /pilot/setup — minimal business setup. Every field optional; "I'm not sure"/incomplete allowed. What the founder
  // states becomes founder-governed Understanding ("you told me") so the clarity flow can use it immediately.
  server.post('/pilot/setup', async (request, reply) => {
    const f = await need(request, reply); if (!f) return;
    const pf = await pilot.getPilotFounder(f);
    if (!pf) { await reply.code(409).send({ error: 'activate the pilot first' }); return; }
    const b = (request.body ?? {}) as { businessName?: string; sells?: string; primaryCustomer?: string; stage?: string; goals?: string[]; constraints?: string[]; complete?: boolean };
    const now = new Date();
    await pilot.emitEvent(f, pf.cohort, PILOT_EVENTS.setupStarted, null, {}, now);
    const say = async (statement: string) => { const s = statement.trim(); if (s.length > 1) await items.create(f, { statement: s, truthLabel: 'you_told_me', origin: 'founder_correction' }, now); };
    if (b.sells) await say(`What we offer: ${b.sells}`);
    if (b.primaryCustomer) await say(`Our primary customer: ${b.primaryCustomer}`);
    for (const g of (b.goals ?? []).filter((x) => typeof x === 'string')) await say(`A current goal: ${g}`);
    for (const c of (b.constraints ?? []).filter((x) => typeof x === 'string')) await say(`A constraint we work within: ${c}`);
    await pilot.updatePilotFounder(f, { businessName: b.businessName?.trim() || null, stage: b.stage?.trim() || null, setupCompleted: b.complete === true }, now);
    if (b.complete === true) await pilot.emitEvent(f, pf.cohort, PILOT_EVENTS.setupCompleted, null, {}, now);
    await reply.code(200).send({ ok: true });
  });

  // POST /pilot/reality — { concernId, marker } research metadata (idempotent). Never downgrades the experience.
  server.post('/pilot/reality', async (request, reply) => {
    const f = await need(request, reply); if (!f) return;
    const b = (request.body ?? {}) as { concernId?: string; marker?: string };
    if (!b.concernId || !['yes_now', 'yes_not_urgent', 'exploratory'].includes(b.marker ?? '')) { await reply.code(400).send({ error: 'concernId and a valid marker are required' }); return; }
    await pilot.upsertReality(f, b.concernId, b.marker!, new Date());
    await reply.send({ ok: true });
  });

  // GET /pilot/should-feedback?concernId= — bounded rule: ask after the first completed concern, then selectively.
  server.get('/pilot/should-feedback', async (request, reply) => {
    const f = await need(request, reply); if (!f) return;
    const concernId = (request.query as { concernId?: string })?.concernId ?? '';
    if (!concernId) { await reply.send({ due: false }); return; }
    if (await pilot.getFeedback(f, concernId)) { await reply.send({ due: false }); return; } // already given
    const count = await pilot.countConcernsSubmitted(f);
    await reply.send({ due: count === 1 || (count > 0 && count % 3 === 0) });
  });

  // POST /pilot/ending — { concernId, ending: 'enough' | 'keep_exploring' } research signal for how the founder closed a reading.
  server.post('/pilot/ending', async (request, reply) => {
    const f = await need(request, reply); if (!f) return;
    const b = (request.body ?? {}) as { concernId?: string; ending?: string };
    const type = b.ending === 'enough' ? PILOT_EVENTS.endedEnough : b.ending === 'keep_exploring' ? PILOT_EVENTS.endedKeepExploring : null;
    if (!type) { await reply.code(400).send({ error: 'ending must be enough or keep_exploring' }); return; }
    const pf = await pilot.getPilotFounder(f);
    await pilot.emitEvent(f, pf?.cohort ?? null, type, b.concernId ?? null, {}, new Date());
    await reply.send({ ok: true });
  });

  // POST /pilot/feedback — optional; founder-scoped (own concern only); idempotent upsert.
  server.post('/pilot/feedback', async (request, reply) => {
    const f = await need(request, reply); if (!f) return;
    const b = (request.body ?? {}) as { concernId?: string; clarityResultId?: string; clearer?: string; changedAttention?: string; reachedAlone?: string; usefulText?: string; normalAlternative?: string };
    if (!b.concernId) { await reply.code(400).send({ error: 'concernId is required' }); return; }
    const now = new Date();
    await pilot.upsertFeedback(f, b.concernId, { clarityResultId: b.clarityResultId ?? null, clearer: b.clearer ?? null, changedAttention: b.changedAttention ?? null, reachedAlone: b.reachedAlone ?? null, usefulText: b.usefulText ?? null, normalAlternative: b.normalAlternative ?? null }, now);
    const pf = await pilot.getPilotFounder(f);
    await pilot.emitEvent(f, pf?.cohort ?? null, PILOT_EVENTS.feedbackSubmitted, b.concernId, { clearer: b.clearer, changedAttention: b.changedAttention, reachedAlone: b.reachedAlone }, now);
    await reply.send({ ok: true });
  });

  // POST /pilot/wtp — founder-submitted willingness-to-pay, ONLY when an admin has opened the prompt (pilot completion).
  server.post('/pilot/wtp', async (request, reply) => {
    const f = await need(request, reply); if (!f) return;
    const pf = await pilot.getPilotFounder(f);
    if (!pf?.wtpOpen) { await reply.code(409).send({ error: 'the pilot completion prompt is not open yet' }); return; }
    const b = (request.body ?? {}) as { wouldContinue?: boolean; wouldMiss?: string; wouldPay?: boolean; amount?: number; priceBand?: string; basis?: string };
    await pilot.addWtp(f, { wouldContinue: b.wouldContinue, wouldMiss: b.wouldMiss, wouldPay: b.wouldPay, amount: b.amount ?? null, priceBand: b.priceBand ?? null, basis: b.basis ?? null }, 'founder', new Date());
    await reply.send({ ok: true });
  });
}
