import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerDeps } from '../server';
import { AuthenticationError, NotFoundError, ValidationError } from '@bb/shared';
import {
  checkParsedReport, todayFactFromReport, CONTACT_TYPES, OUTCOME_TYPES, TOUCH_CHANNELS, TOUCH_TYPES,
  type ConfirmedReportItem, type ContactType, type ContactView, type OutcomeType, type TouchChannel, type TouchType, type WritingEntryKind, type WritingRule,
} from '@bb/application';
import { recordFounderEvent } from '../telemetry/founder-events';
import { contentLanguageFor } from './content-language';
import { scrub } from './impact.routes';

/**
 * RESULT LOOP V1 (intent/2026-10-14-result-loop): the acquisition loop's state and the founder's messages.
 *   contacts (supporting state of the held strategy, shown on Strategy) · touches · follow-ups ·
 *   report parse → founder confirms / corrects item by item → typed write → impact evaluation ·
 *   sender + writing evidence · brief → draft (sendability-gated) → "I sent it".
 * Founder-facing projections only; /v1, JWT, business membership first.
 */
interface AuthedUser { sub: string; role: string }
function founderOf(request: FastifyRequest): string {
  const user = (request as unknown as { user?: AuthedUser }).user;
  if (!user?.sub) throw new AuthenticationError('MISSING_AUTH_TOKEN', 'Authentication required.');
  return user.sub;
}

const s = (v: unknown, max = 300): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function projectContact(v: ContactView) {
  const c = v.contact;
  return {
    id: c.id, type: c.type, name: c.name, organisationName: c.organisationName, role: c.role, email: c.email, phone: c.phone, website: c.website,
    status: c.status, needsDetails: c.status === 'NEEDS_DETAILS',
    lastTouch: v.lastTouch ? { type: v.lastTouch.type, channel: v.lastTouch.channel, at: v.lastTouch.occurredAt, summary: v.lastTouch.summary } : null,
    lastOutcome: v.lastOutcome ? { type: v.lastOutcome.outcomeType, at: v.lastOutcome.occurredAt, note: v.lastOutcome.note } : null,
    nextFollowUp: v.openFollowUp ? { id: v.openFollowUp.id, what: v.openFollowUp.what, dueOn: v.openFollowUp.dueOn } : null,
  };
}

/** Confirmed items from the client: re-validated (shape + enums); quotes must still be the founder's words unless she edited. */
function confirmedItems(raw: unknown, statement: string): ConfirmedReportItem[] {
  if (!Array.isArray(raw)) throw new ValidationError('ITEMS_REQUIRED', 'Nothing to confirm.');
  const checked = checkParsedReport({ items: raw }, statement, raw.map((x) => ({ id: s((x as { contact?: { existingContactId?: unknown } })?.contact?.existingContactId) ?? '' })));
  // Keep the founder's edit flag; checkParsedReport rebuilt ids, so match by position of surviving items.
  const edits = new Set(raw.map((x, i) => ((x as { edited?: unknown })?.edited === true ? i : -1)).filter((i) => i >= 0));
  return checked.items.map((it) => ({ ...it, ...(edits.has(Number(it.id.slice(1)) - 1) ? { edited: true } : {}) }));
}

/** A writing rule as the founder sees it: what, from what kind of evidence, how much, and for which context. */
const ruleView = (r: WritingRule) => ({ key: r.key, value: r.value, source: r.source, evidenceCount: r.evidence.length, ...(r.scope ? { scope: r.scope } : {}) });

export function registerResultRoutes(server: FastifyInstance, deps: ServerDeps): void {
  const results = deps.resultLoopService;
  const comms = deps.communicationService;
  if (!results || !comms) return;

  async function requireBusiness(request: FastifyRequest) {
    const founderId = founderOf(request);
    const { id } = request.params as { id: string };
    const business = await deps.businessService.getBusiness(id, founderId);
    if (!business) throw new NotFoundError('BUSINESS_NOT_FOUND', 'Business not found.');
    const account = await deps.founderAccountService.getById(founderId);
    return { founderId, business, account, language: await contentLanguageFor(deps.contentLanguageStore, business.id, account?.interfaceLocale) };
  }

  // The system around the held strategy: contacts + evidence + what is due. Sender status for the composer.
  server.get('/v1/businesses/:id/results', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business, account } = await requireBusiness(request);
    const [views, evidence, due, profile] = await Promise.all([results.views(business.id), results.evidence(business.id), results.due(business.id), comms.profile(business.id)]);
    await reply.send({
      contacts: views.map(projectContact),
      evidence,
      due: due.map((d) => ({ followUpId: d.followUp.id, contactId: d.contact.id, contactName: d.contact.name, what: d.followUp.what, dueOn: d.followUp.dueOn })),
      sender: profile.sender,
      // A suggestion only: the account owner may not be the sender (Body Move: the account is not Raluca's).
      senderSuggestion: profile.sender ? null : { displayName: account?.name ?? '', role: '', business: business.name, signOff: null },
      writing: {
        samples: profile.samples.length, liked: profile.liked.length, neverSay: profile.neverSay, acceptedPhrases: profile.acceptedPhrases, rejectedInContext: profile.rejectedInContext.length,
        preferences: Object.fromEntries(Object.entries(profile.preferences).map(([k, v]) => [k, v?.value])),
        // What BB uses when it writes for her, each with where it came from (her preference / her N messages / her edits).
        rules: profile.rules.map(ruleView),
      },
    });
  });

  server.post('/v1/businesses/:id/results/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const b = (request.body ?? {}) as Record<string, unknown>;
    const type = (CONTACT_TYPES.includes(b['type'] as ContactType) ? b['type'] : 'PERSON') as ContactType;
    const c = await results.addContact(business.id, { type, name: s(b['name'], 160) ?? '', organisationName: s(b['organisationName']), role: s(b['role']), email: s(b['email']), phone: s(b['phone'], 60), website: s(b['website']) }, { kind: 'founder' });
    await reply.status(201).send({ id: c.id });
  });

  server.patch('/v1/businesses/:id/results/contacts/:cid', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { cid } = request.params as { cid: string };
    const b = (request.body ?? {}) as Record<string, unknown>;
    const pick = (k: string, max?: number) => (k in b ? { [k]: s(b[k], max) } : {});
    await results.updateContact(business.id, cid, { ...pick('name', 160), ...pick('organisationName'), ...pick('role'), ...pick('email'), ...pick('phone', 60), ...pick('website') } as never);
    await reply.send({ ok: true });
  });

  // The founder logs what happened herself (a visit, a call, a reply), optionally with its outcome and what is owed next.
  server.post('/v1/businesses/:id/results/contacts/:cid/touches', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { cid } = request.params as { cid: string };
    const b = (request.body ?? {}) as Record<string, unknown>;
    if (!TOUCH_CHANNELS.includes(b['channel'] as TouchChannel) || !TOUCH_TYPES.includes(b['type'] as TouchType)) throw new ValidationError('TOUCH_INVALID', 'Choose how and what happened.');
    const summary = s(b['summary'], 2000) ?? '';
    const ev = { kind: 'founder' as const, statement: summary };
    const touch = await results.logTouch(business.id, { contactId: cid, channel: b['channel'] as TouchChannel, type: b['type'] as TouchType, summary, occurredAt: s(b['occurredAt'], 40) ?? undefined, source: ev, createdBy: 'FOUNDER' });
    const o = (b['outcome'] ?? null) as { type?: unknown; note?: unknown } | null;
    if (o && OUTCOME_TYPES.includes(o.type as OutcomeType)) await results.recordOutcome(business.id, { contactId: cid, outcomeType: o.type as OutcomeType, note: s(o.note, 1000) ?? '', touchId: touch.id, evidence: ev, createdBy: 'FOUNDER' });
    const f = (b['followUp'] ?? null) as { what?: unknown; dueOn?: unknown } | null;
    if (f && s(f.what) && s(f.dueOn, 10)) await results.openFollowUp(business.id, { contactId: cid, what: s(f.what)!, reason: summary, dueOn: s(f.dueOn, 10)!, createdFrom: touch.id, createdBy: 'FOUNDER' });
    await reply.status(201).send({ id: touch.id });
  });

  server.post('/v1/businesses/:id/results/follow-ups/:fid/reschedule', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { fid } = request.params as { fid: string };
    const f = await results.rescheduleFollowUp(business.id, fid, s((request.body as { dueOn?: unknown } | null)?.dueOn, 10) ?? '', 'FOUNDER');
    await reply.send({ id: f.id, dueOn: f.dueOn });
  });

  server.post('/v1/businesses/:id/results/follow-ups/:fid/cancel', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { fid } = request.params as { fid: string };
    await results.cancelFollowUp(business.id, fid);
    await reply.send({ ok: true });
  });

  // Report → BB's reading (nothing is written). The founder confirms or corrects each item next.
  server.post('/v1/businesses/:id/results/report/parse', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business, language } = await requireBusiness(request);
    const text = s((request.body as { text?: unknown } | null)?.text, 4000);
    if (!text) throw new ValidationError('TEXT_REQUIRED', 'Tell me what happened.');
    const contacts = (await results.views(business.id)).map((v) => v.contact);
    let raw: unknown = null;
    try { raw = await deps.resultReportModel!.parse({ statement: text, language, contacts: contacts.map((c) => ({ id: c.id, name: c.name, organisationName: c.organisationName, role: c.role })) }); } catch { raw = null; }
    const parsed = checkParsedReport(raw, text, contacts);
    await reply.send({ ...parsed, contacts: contacts.map((c) => ({ id: c.id, name: c.name, role: c.role, organisationName: c.organisationName })) });
  });

  // Confirmed (possibly corrected) items → typed touches / outcomes / follow-ups → impact over the cumulative evidence.
  server.post('/v1/businesses/:id/results/report/confirm', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const b = (request.body ?? {}) as { text?: unknown; items?: unknown };
    const text = s(b.text, 4000);
    if (!text) throw new ValidationError('TEXT_REQUIRED', 'The original report is required.');
    const items = confirmedItems(b.items, text);
    const written = await results.applyConfirmedReport(business.id, text, items, 'FOUNDER');
    const evidence = await results.evidence(business.id);
    // Today's change is a fact, not a model opinion: is a different move first now? New follow-ups are the queue, apart.
    const today = todayFactFromReport(written.currentBefore, written.currentAfter, written.followUps);
    const { result, newVersion } = await deps.impactService.evaluate(business.id, founderId, business.name, 'outcome_report', text, language, { results: { evidence, today } });
    const projected = newVersion ? { id: newVersion.id, version: newVersion.version, status: newVersion.status, strategy: scrub(newVersion.bundle) } : null;
    recordFounderEvent(deps.db, {
      accountId: founderId, businessId: business.id, eventType: 'impact_evaluated', surface: 'outcome_report',
      metadata: { verdict: result.verdict, source: 'outcome_report', whatChanged: result.whatChanged.slice(0, 4), todayChanges: result.todayImpact.changes, todayReason: result.todayImpact.reason ?? '', newMove: result.todayImpact.newMove, strategyChanges: result.strategyImpact.changes, newVersionId: newVersion?.id ?? null },
    });
    recordFounderEvent(deps.db, { accountId: founderId, businessId: business.id, eventType: 'outcome_reported', surface: 'today', metadata: { text: text.slice(0, 1500), typed: { touches: written.touches.length, outcomes: written.outcomes.length, followUps: written.followUps.length } } });
    await reply.send({
      written: { contacts: written.contacts.length, touches: written.touches.length, outcomes: written.outcomes.length, followUps: written.followUps.length },
      verdict: { ...result, strategyImpact: { ...result.strategyImpact, newVersion: projected } },
    });
  });

  server.post('/v1/businesses/:id/results/sender', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business, founderId } = await requireBusiness(request);
    await reply.send({ sender: await comms.confirmSender(business.id, request.body, founderId) });
  });

  server.post('/v1/businesses/:id/results/writing', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business, founderId } = await requireBusiness(request);
    const b = (request.body ?? {}) as { kind?: unknown; text?: unknown; key?: unknown; recipientCategory?: unknown; channel?: unknown; purpose?: unknown };
    const kind = String(b.kind ?? '') as Exclude<WritingEntryKind, 'SENDER' | 'RELEVANCE'> | 'LIKED';
    // The account user entered it, about the confirmed sender (not assumed to be the same person); a sample may say
    // whom and by which channel it was written (its register context).
    const p = await comms.addWriting(business.id, kind, String(b.text ?? ''), typeof b.key === 'string' ? b.key : null,
      { actorId: founderId, recipientCategory: b.recipientCategory, channel: b.channel, purpose: b.purpose });
    await reply.send({ samples: p.samples.length, liked: p.liked.length, neverSay: p.neverSay, acceptedPhrases: p.acceptedPhrases,
      rules: p.rules.map(ruleView) });
  });

  server.post('/v1/businesses/:id/results/contacts/:cid/draft', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { cid } = request.params as { cid: string };
    const b = (request.body ?? {}) as { channel?: unknown; purpose?: unknown };
    const out = await comms.draft(business.id, cid, { channel: b.channel === 'WHATSAPP' ? 'WHATSAPP' : 'EMAIL', ...(typeof b.purpose === 'string' ? { purpose: b.purpose as never } : {}) });
    await reply.send(out);
  });

  // The founder corrects which of her (verified) services this message focuses on; BB writes again from her choice.
  server.post('/v1/businesses/:id/results/contacts/:cid/relevance', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { cid } = request.params as { cid: string };
    await reply.send({ relevance: await comms.correctRelevance(business.id, cid, (request.body as { parts?: unknown } | null)?.parts) });
  });

  server.post('/v1/businesses/:id/results/contacts/:cid/sent', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business, founderId } = await requireBusiness(request);
    const { cid } = request.params as { cid: string };
    const b = (request.body ?? {}) as Record<string, unknown>;
    const touch = await comms.markSent(business.id, cid, { actorId: founderId,
      messageId: s(b['messageId'], 60) ?? 'manual', subject: s(b['subject']), body: s(b['body'], 6000) ?? '', draftBody: s(b['draftBody'], 6000),
      channel: b['channel'] === 'WHATSAPP' ? 'WHATSAPP' : 'EMAIL',
    });
    await reply.status(201).send({ id: touch.id });
  });
}
