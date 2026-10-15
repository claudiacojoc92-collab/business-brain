/**
 * Result Loop V1 Postgres integration (V085 `result` schema). Env-gated: runs ONLY when BB_IT_DATABASE_URL points at a
 * throwaway database where V085 has been applied. Each run uses a fresh business id, so it never collides.
 *
 *   BB_IT_DATABASE_URL=postgresql://… npm run test:integration:businessbrain
 */
import { describe, it, expect, afterAll } from 'vitest';
import { sql } from 'kysely';
import { checkParsedReport, CommunicationService, ResultLoopService, SENDABILITY_QUESTIONS } from '@bb/application';
import { createKyselyClient } from '../../../database/client';
import { clearResultLoopForBusiness, PgContactRepository, PgFollowUpRepository, PgOutcomeRepository, PgTouchRepository, PgWritingRepository } from '../../../database/repositories/pg-result-loop.repository';

const url = process.env['BB_IT_DATABASE_URL'] ?? '';
const db = createKyselyClient(url);
afterAll(async () => { await db.destroy(); });

const repos = { contacts: new PgContactRepository(db), touches: new PgTouchRepository(db), outcomes: new PgOutcomeRepository(db), followUps: new PgFollowUpRepository(db) };
const svc = new ResultLoopService({ ...repos, now: () => new Date('2026-10-14T09:00:00Z') });
const REPORT = 'The representative visited five clinics. Two were not interested. Two asked for the brochure by email. One doctor wants a follow-up.';
const RAW = { items: [
  ...[1, 2].map(() => ({ contact: { placeholder: true, type: 'ORGANISATION' }, touch: { channel: 'VISIT', type: 'VISITED' }, outcome: { type: 'NOT_INTERESTED', note: '' }, quote: 'Two were not interested' })),
  ...[1, 2].map(() => ({ contact: { placeholder: true, type: 'ORGANISATION' }, touch: { channel: 'VISIT', type: 'VISITED' }, outcome: { type: 'MATERIAL_REQUESTED', note: 'brochure by email' }, followUp: { what: 'Email the brochure' }, quote: 'Two asked for the brochure by email' })),
  { contact: { placeholder: false, name: 'Dr. Mihai Rus', role: 'neurolog', type: 'PERSON' }, touch: { channel: 'VISIT', type: 'VISITED' }, outcome: { type: 'FOLLOW_UP_REQUESTED', note: '' }, followUp: { what: 'Follow up with the doctor', dueInDays: 7 }, quote: 'One doctor wants a follow-up' },
] };

describe('Result Loop V1 — Postgres stores (V085)', () => {
  const B = `it-${Date.now()}`;

  it('a confirmed report round-trips: typed rows, jsonb evidence, derived status, date-typed due dates', async () => {
    const w = await svc.applyConfirmedReport(B, REPORT, checkParsedReport(RAW, REPORT, []).items);
    expect([w.contacts.length, w.touches.length, w.outcomes.length, w.followUps.length]).toEqual([5, 5, 5, 3]);
    expect((await repos.outcomes.list(B)).every((o) => o.evidence.statement === REPORT)).toBe(true);
    const ev = await svc.evidence(B);
    expect(ev).toMatchObject({ contacted: 5, outcomes: { NOT_INTERESTED: 2, MATERIAL_REQUESTED: 2, FOLLOW_UP_REQUESTED: 1 } });
    const rus = (await repos.contacts.list(B)).find((c) => c.name === 'Dr. Mihai Rus')!;
    expect(rus.status).toBe('IN_CONVERSATION');
    expect((await repos.followUps.list(B, { status: 'OPEN', contactId: rus.id }))[0]!.dueOn).toBe('2026-10-21');
  });

  it('follow-ups resolve once; a reschedule keeps the original row and links the new one', async () => {
    const rus = (await repos.contacts.list(B)).find((c) => c.name === 'Dr. Mihai Rus')!;
    const t = await svc.logTouch(B, { contactId: rus.id, channel: 'EMAIL', type: 'SENT', summary: 'Wrote to him', source: { kind: 'message' }, createdBy: 'FOUNDER' });
    const done = (await repos.followUps.list(B, { contactId: rus.id }))[0]!;
    expect(done).toMatchObject({ status: 'DONE', resolvedByTouchId: t.id });
    expect(await repos.followUps.resolve(B, done.id, 'CANCELLED', new Date().toISOString(), null)).toBe(false);
    const next = await svc.openFollowUp(B, { contactId: rus.id, what: 'Call', dueOn: '2026-10-25', createdBy: 'BB' });
    const moved = await svc.rescheduleFollowUp(B, next.id, '2026-10-30', 'FOUNDER');
    expect(moved.replacesId).toBe(next.id);
    expect((await repos.followUps.list(B, { contactId: rus.id })).find((f) => f.id === next.id)).toMatchObject({ status: 'RESCHEDULED', dueOn: '2026-10-25' });
  });

  it('the database refuses UPDATE on touches, outcomes and writing entries (append-only)', async () => {
    const t = (await repos.touches.list(B))[0]!;
    await expect(sql`UPDATE result.touch SET summary = 'edited' WHERE id = ${t.id}`.execute(db)).rejects.toThrow(/append-only/);
    const o = (await repos.outcomes.list(B))[0]!;
    await expect(sql`UPDATE result.outcome SET note = 'edited' WHERE id = ${o.id}`.execute(db)).rejects.toThrow(/append-only/);
  });

  it('the sender and the writing evidence persist and project', async () => {
    const comms = new CommunicationService({
      results: repos, resultService: svc, writing: new PgWritingRepository(db),
      context: { strategy: async () => null, todayMove: async () => null, founderSaid: async () => [], constraints: async () => [], businessOffer: async () => null },
      model: { write: async () => ({}) }, judge: { judge: async () => ({}) }, grounder: { ground: async () => ({}) }, relevance: { select: async () => ({}) },
    });
    await comms.confirmSender(B, { displayName: 'Raluca', role: 'fondatoare', business: 'Body Move Studio' });
    await comms.addWriting(B, 'NEVER_SAY', 'Cu stimă');
    const p = await comms.profile(B);
    expect(p.sender?.displayName).toBe('Raluca');
    expect(p.neverSay).toEqual(['Cu stimă']);
    await expect(sql`UPDATE result.writing_entry SET text = 'x' WHERE business_id = ${B}`.execute(db)).rejects.toThrow(/append-only/);
  });

  it('a founder relevance correction persists (RELEVANCE kind) and drives the next draft for that contact; it is not voice or business truth', async () => {
    const RB = `${B}-rel`;
    const writing = new PgWritingRepository(db);
    const relevanceCalls: unknown[] = [];
    const writes: { focus: string[] }[] = [];
    const comms = new CommunicationService({
      results: repos, resultService: svc, writing,
      context: { strategy: async () => ({ goal: 'g', bet: 'medici care trimit pacienți', referrer: 'medici' }), todayMove: async () => null, founderSaid: async () => [], constraints: async () => [], businessOffer: async () => 'Kinetoterapie, Pilates, masaj' },
      model: { write: async (i) => { writes.push({ focus: i.brief.relevant_offer_parts.map((p) => p.offer_part) }); return { subject: 'Kinetoterapie', body: 'Bună ziua, doamna doctor Pop,\n\nFacem kinetoterapie în Cluj.\n\nRaluca' }; } },
      judge: { judge: async () => ({ sendable: true, answers: SENDABILITY_QUESTIONS.map((question) => ({ question, pass: true, why: '' })), missingContext: [] }) },
      grounder: { ground: async () => ({ claims: [] }) },
      relevance: { select: async (i) => { relevanceCalls.push(i); return { parts: [{ offer_part: 'Pilates', reason: 'medic ortoped', evidence: ['medic ortoped'], confidence: 'MEDIUM' }] }; } },
    });
    await comms.confirmSender(RB, { displayName: 'Raluca', role: 'fondatoare', business: 'Body Move Studio' });
    const dr = await svc.addContact(RB, { type: 'PERSON', name: 'Dr. Ana Pop', role: 'medic ortoped', email: 'a@x.ro' }, { kind: 'founder' });
    await comms.draft(RB, dr.id);
    expect(writes.pop()!.focus).toEqual(['Pilates']); // BB's first choice
    await comms.correctRelevance(RB, dr.id, [{ offer_part: 'Kinetoterapie', reason: 'Trimite pacienți după operații.' }]);

    const rows = (await sql<{ kind: string; key: string; text: string }>`SELECT kind, key, text FROM result.writing_entry WHERE business_id = ${RB} AND kind = 'RELEVANCE'`.execute(db)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: dr.id });
    expect(JSON.parse(rows[0]!.text)).toMatchObject({ recipientRole: 'medic ortoped', parts: [{ offer_part: 'Kinetoterapie' }] });

    const out = await comms.draft(RB, dr.id);
    expect(relevanceCalls).toHaveLength(1);              // her choice now; no model call for this contact
    expect(writes.pop()!.focus).toEqual(['Kinetoterapie']);
    expect(out.status !== 'needs_input' && out.brief.relevance.source).toBe('founder');
    const p = await comms.profile(RB);                   // not voice: no sample, no phrase, no preference
    expect([p.samples.length, p.acceptedPhrases.length, p.neverSay.length, Object.keys(p.preferences).length]).toEqual([0, 0, 0, 0]);
    expect(p.relevanceCorrections).toHaveLength(1);
    // Not business truth: the result loop's contact / outcome state is untouched by the correction.
    expect(await repos.outcomes.list(RB)).toHaveLength(0);
    expect((await repos.contacts.get(RB, dr.id))!.status).toBe('TARGET');
  });

  it('BUS-78: a per-business reset clears ONE business\'s result.* (contacts, touches, outcomes, follow-ups, writing) and nothing else', async () => {
    const A = `${B}-resetA`, Z = `${B}-resetZ`;
    const writing = new PgWritingRepository(db);
    for (const biz of [A, Z]) {
      await svc.applyConfirmedReport(biz, REPORT, checkParsedReport(RAW, REPORT, []).items);
      await writing.append({ id: `${biz}-w1`, businessId: biz, kind: 'SAMPLE', key: null, text: 'Bună ziua', evidence: { kind: 'sample' }, createdAt: '2026-10-14T09:00:00Z' });
      await writing.append({ id: `${biz}-w2`, businessId: biz, kind: 'RELEVANCE', key: 'c1', text: '{"parts":[]}', evidence: { kind: 'explicit' }, createdAt: '2026-10-14T09:00:00Z' });
    }
    const count = async (biz: string) => Object.fromEntries(await Promise.all(['contact', 'touch', 'outcome', 'follow_up', 'writing_entry'].map(async (t) =>
      [t, Number((await sql<{ n: string }>`SELECT count(*)::text AS n FROM ${sql.table(`result.${t}`)} WHERE business_id = ${biz}`.execute(db)).rows[0]!.n)])));
    const before = await count(Z);
    expect(await count(A)).toEqual({ contact: 5, touch: 5, outcome: 5, follow_up: 3, writing_entry: 2 });

    const deleted = await clearResultLoopForBusiness(db, A);
    expect(deleted).toEqual({ follow_up: 3, outcome: 5, touch: 5, contact: 5, writing_entry: 2 });
    expect(await count(A)).toEqual({ contact: 0, touch: 0, outcome: 0, follow_up: 0, writing_entry: 0 });
    expect(await count(Z)).toEqual(before);                               // the other business is untouched
    expect(await clearResultLoopForBusiness(db, A)).toEqual({ follow_up: 0, outcome: 0, touch: 0, contact: 0, writing_entry: 0 }); // idempotent
    await expect(clearResultLoopForBusiness(db, ' ')).rejects.toThrow(/required/);
    // After a reset the business starts clean: a new report writes fresh rows without conflicts.
    const w = await svc.applyConfirmedReport(A, REPORT, checkParsedReport(RAW, REPORT, []).items);
    expect(w.contacts).toHaveLength(5);
  });
});
