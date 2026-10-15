/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { registerResultRoutes } from '../../routes/result.routes';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';
import {
  CommunicationService, ImpactService, InMemoryWritingRepository, ResultLoopService, SENDABILITY_QUESTIONS, inMemoryResultLoopRepos,
  type IResultReportModel, type ImpactSignal,
} from '@bb/application';
import type { Logger } from '@bb/infrastructure';

const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new DummyDriver(), createIntrospector: (k) => new PostgresIntrospector(k), createQueryCompiler: () => new PostgresQueryCompiler() } });
const REPORT = 'The representative visited five clinics. Two were not interested. Two asked for the brochure by email. One doctor wants a follow-up.';
const reportModel: IResultReportModel = {
  parse: async () => ({ items: [
    ...[1, 2].map(() => ({ contact: { placeholder: true, type: 'ORGANISATION' }, touch: { channel: 'VISIT', type: 'VISITED' }, outcome: { type: 'NOT_INTERESTED', note: '' }, quote: 'Two were not interested' })),
    ...[1, 2].map(() => ({ contact: { placeholder: true, type: 'ORGANISATION' }, touch: { channel: 'VISIT', type: 'VISITED' }, outcome: { type: 'MATERIAL_REQUESTED', note: 'brochure by email' }, followUp: { what: 'Email the brochure' }, quote: 'Two asked for the brochure by email' })),
    { contact: { placeholder: true, type: 'PERSON', role: 'doctor' }, touch: { channel: 'VISIT', type: 'VISITED' }, outcome: { type: 'FOLLOW_UP_REQUESTED', note: '' }, followUp: { what: 'Follow up with the doctor', dueInDays: 7 }, quote: 'One doctor wants a follow-up' },
  ] }),
};

function build() {
  const repos = inMemoryResultLoopRepos();
  const now = () => new Date('2026-10-14T09:00:00Z');
  const resultLoopService = new ResultLoopService({ ...repos, now });
  const founderState: any[] = [];
  const signal: ImpactSignal = { changeKind: 'none', matchedReconsider: null, contradictsAssumption: false, assumptionImpacts: [], whatChanged: ['Five clinics visited.'], whatDidNotChange: ['The referral bet.'], todayNextMove: 'x', todayReason: '', founderStateKind: 'constraint', conflictsWithCurrentMove: false, evidenceSufficiency: 'too_early' };
  const impactService = new ImpactService({
    understanding: { latest: async () => null } as any,
    state: { listActive: async () => [], append: async (i: any) => { founderState.push(i); return i; } } as any,
    strategy: { getCurrent: async () => ({ record: { bundle: { core: { goal: 'more medical referrals', coreBet: { priority: 'doctor referrals', deprioritized: 'ads' }, diagnosis: 'd', assumptions: [{ statement: 'doctors refer when they know us' }], reconsiderTriggers: [], notNow: [], audienceRoles: [] } } }, adoptedAt: 't' }) as any, recordFounderInput: async () => { throw new Error('no'); }, regenerate: async () => { throw new Error('no'); } },
    model: { assess: async () => signal },
  });
  const communicationService = new CommunicationService({
    results: repos, resultService: resultLoopService, writing: new InMemoryWritingRepository(), now,
    context: { strategy: async () => ({ goal: 'more medical referrals', bet: 'doctor referrals', referrer: 'doctors' }), todayMove: async () => null, founderSaid: async () => [], constraints: async () => [], businessOffer: async () => 'kinetoterapie' },
    model: { write: async () => ({ subject: 'Broșura cerută', body: 'Bună ziua, doamna doctor Pop,\n\nVă trimit broșura pe care ați cerut-o.\n\nRaluca' }) },
    judge: { judge: async () => ({ sendable: true, answers: SENDABILITY_QUESTIONS.map((question) => ({ question, pass: true, why: '' })), missingContext: [] }) },
    grounder: { ground: async () => ({ claims: [] }) },
    relevance: { select: async () => ({ parts: [{ offer_part: 'kinetoterapie', reason: 'recuperare după tratament', evidence: ['kinetoterapie'], confidence: 'HIGH' }] }) },
  });
  const deps = {
    db, resultLoopService, communicationService, impactService, resultReportModel: reportModel,
    businessService: { getBusiness: async (id: string, f: string) => (f === 'founder-1' ? { id, name: 'Body Move Studio' } : null) },
    founderAccountService: { getById: async () => ({ name: 'Claudia', interfaceLocale: 'en' }) },
  } as any;
  const server = Fastify();
  registerErrorHandler(server, { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as Logger);
  server.addHook('preHandler', async (req) => { (req as any).user = { sub: (req.headers['x-as'] as string) ?? 'founder-1', role: 'founder' }; });
  registerResultRoutes(server, deps);
  return { server, repos, founderState };
}
const R = '/v1/businesses/bm/results';

describe('result routes (Result Loop V1)', () => {
  it('another founder cannot read or write this business', async () => {
    const { server } = build();
    expect((await server.inject({ method: 'GET', url: R, headers: { 'x-as': 'intruder' } })).statusCode).toBe(404);
    expect((await server.inject({ method: 'POST', url: `${R}/contacts`, headers: { 'x-as': 'intruder' }, payload: { name: 'x' } })).statusCode).toBe(404);
  });

  it('a contact is added and projected; the account name is only a sender SUGGESTION until confirmed', async () => {
    const { server } = build();
    expect((await server.inject({ method: 'POST', url: `${R}/contacts`, payload: { type: 'PERSON', name: 'Dr. Ana Pop', role: 'ortoped' } })).statusCode).toBe(201);
    const g = (await server.inject({ method: 'GET', url: R })).json<any>();
    expect(g.contacts[0]).toMatchObject({ name: 'Dr. Ana Pop', role: 'ortoped', status: 'TARGET', needsDetails: false, lastTouch: null });
    expect(g.sender).toBeNull();
    expect(g.senderSuggestion).toMatchObject({ displayName: 'Claudia', business: 'Body Move Studio' });
  });

  it('report → parse (nothing written) → founder corrects one item → confirm → typed state + verdict; no founder_state', async () => {
    const { server, repos, founderState } = build();
    const parsed = (await server.inject({ method: 'POST', url: `${R}/report/parse`, payload: { text: REPORT } })).json<any>();
    expect(parsed.items).toHaveLength(5);
    expect(await repos.contacts.list('bm')).toHaveLength(0);
    const items = parsed.items.map((it: any, i: number) => (i === 4 ? { ...it, contact: { ...it.contact, name: 'Dr. Mihai Rus', role: 'neurolog', placeholder: false }, edited: true } : it));
    const c = (await server.inject({ method: 'POST', url: `${R}/report/confirm`, payload: { text: REPORT, items } })).json<any>();
    expect(c.written).toEqual({ contacts: 5, touches: 5, outcomes: 5, followUps: 3 });
    expect(c.verdict.verdict).toBe('TUNE');                         // follow-ups opened: execution changes, strategy holds
    // Nothing was due before and the new follow-ups are for later: Today's move is the same; the queue grew (separately).
    expect(c.verdict.todayImpact).toMatchObject({ changes: false, newMove: null, followUpsAdded: { count: 3 } });
    expect(c.verdict.evidence.statements[1]).toMatch(/2 not interested/);
    expect(founderState).toHaveLength(0);                            // the outcome is never a constraint / correction
    const outcomes = await repos.outcomes.list('bm');
    expect(outcomes[4]!.evidence).toMatchObject({ statement: REPORT, quote: 'One doctor wants a follow-up', editedByFounder: true });
  });

  it('sender confirmed once → draft (brief + gated message) → "I sent it" writes back a SENT touch', async () => {
    const { server, repos } = build();
    const id = (await server.inject({ method: 'POST', url: `${R}/contacts`, payload: { type: 'PERSON', name: 'Dr. Ana Pop', email: 'a@x.ro' } })).json<any>().id;
    expect((await server.inject({ method: 'POST', url: `${R}/contacts/${id}/draft`, payload: {} })).json<any>().status).toBe('needs_input');
    await server.inject({ method: 'POST', url: `${R}/sender`, payload: { displayName: 'Raluca', role: 'fondatoare', business: 'Body Move Studio' } });
    const d = (await server.inject({ method: 'POST', url: `${R}/contacts/${id}/draft`, payload: {} })).json<any>();
    expect(d.status).toBe('ready');
    expect(d.brief.sender_identity.displayName).toBe('Raluca');
    const s = await server.inject({ method: 'POST', url: `${R}/contacts/${id}/sent`, payload: { messageId: d.messageId, subject: d.message.subject, body: d.message.body, draftBody: d.message.body, channel: 'EMAIL' } });
    expect(s.statusCode).toBe(201);
    expect((await repos.touches.list('bm', id))[0]).toMatchObject({ type: 'SENT', createdBy: 'FOUNDER' });
    expect((await server.inject({ method: 'GET', url: R })).json<any>().contacts[0].status).toBe('CONTACTED');
  });

  it('a follow-up can be rescheduled (history kept) or cancelled; a touch can be logged with its outcome', async () => {
    const { server, repos } = build();
    const id = (await server.inject({ method: 'POST', url: `${R}/contacts`, payload: { name: 'Clinica X', type: 'ORGANISATION' } })).json<any>().id;
    await server.inject({ method: 'POST', url: `${R}/contacts/${id}/touches`, payload: { channel: 'PHONE', type: 'SENT', summary: 'Called reception', outcome: { type: 'FOLLOW_UP_REQUESTED' }, followUp: { what: 'Call back Thursday', dueOn: '2026-10-16' } } });
    const fu = (await repos.followUps.list('bm'))[0]!;
    const r = (await server.inject({ method: 'POST', url: `${R}/follow-ups/${fu.id}/reschedule`, payload: { dueOn: '2026-10-20' } })).json<any>();
    expect(r.dueOn).toBe('2026-10-20');
    expect((await repos.followUps.list('bm')).map((f) => f.status)).toEqual(['RESCHEDULED', 'OPEN']);
    expect((await server.inject({ method: 'POST', url: `${R}/follow-ups/${r.id}/cancel` })).statusCode).toBe(200);
    expect((await server.inject({ method: 'POST', url: `${R}/contacts/${id}/touches`, payload: { channel: 'FAX', type: 'SENT' } })).statusCode).toBe(400);
  });
});
