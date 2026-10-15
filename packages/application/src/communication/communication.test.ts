import { describe, it, expect } from 'vitest';
import { ResultLoopService } from '../result-loop/result-loop.service';
import { inMemoryResultLoopRepos } from '../result-loop/in-memory';
import { CommunicationService, MAX_REPAIRS, type CommunicationContextPort } from './communication.service';
import { deriveWritingRules } from './writing-rules';
import { InMemoryWritingRepository, projectWritingProfile } from './writing';
import { buildBrief, offerItems, purposeFor, relationshipContext } from './brief';
import { checkClaimGrounding, checkEvidenceDiscipline, checkJudgement, checkSendability, SENDABILITY_QUESTIONS } from './sendability';
import type { CommunicationBrief, WritingEntry, IClaimGrounder, IMessageModel, IRelevanceModel, ISendabilityJudge, MessageWriteInput, RelevanceInput, WritingProfile } from './contracts';
import { checkRelevance } from './relevance';

const B = 'bm';
const RALUCA = { displayName: 'Raluca', role: 'fondatoare', business: 'Body Move Studio', signOff: null };
const context: CommunicationContextPort = {
  strategy: async () => ({ goal: 'more medical referrals in 6–12 months', bet: 'doctors and recovery wards referring patients', referrer: 'doctors who see patients after treatment' }),
  todayMove: async () => 'Write to two doctors who treat patients after surgery',
  founderSaid: async () => ['2 medici confirmați, unul a trimis 3 paciente', 'Kinetoterapie și Pilates în două locații în Cluj'],
  constraints: async () => ['no paid ads'],
  businessOffer: async () => 'Kinetoterapie, Pilates, gimnastică prenatală și masaj, în două locații din Cluj-Napoca',
};
const allPass = { sendable: true, answers: SENDABILITY_QUESTIONS.map((question) => ({ question, pass: true, why: '' })), missingContext: [] };
const judge = (...outs: unknown[]): ISendabilityJudge & { calls: number } => {
  const j = { calls: 0, judge: async () => outs[Math.min(j.calls++, outs.length - 1)] };
  return j;
};
const writer = (...outs: unknown[]): IMessageModel & { inputs: MessageWriteInput[] } => {
  const inputs: MessageWriteInput[] = [];
  return { inputs, write: async (i) => { inputs.push(i); return outs[Math.min(inputs.length - 1, outs.length - 1)]; } };
};

const grounder = (...outs: unknown[]): IClaimGrounder & { calls: number } => {
  const g = { calls: 0, ground: async () => outs[Math.min(g.calls++, outs.length - 1)] };
  return g;
};
const grounded = { claims: [] };
/** BB's one relevance decision for the brief (the fake records each call: it must be ONE per draft). */
const relevanceModel = (out: unknown = { parts: [{ offer_part: 'Kinetoterapie', reason: 'Un medic ortoped are pacienți care au nevoie de kinetoterapie.', evidence: ['medic ortoped'], confidence: 'HIGH' }, { offer_part: 'Pilates', reason: 'Un medic ortoped trimite pacienți.', evidence: ['medic ortoped'], confidence: 'MEDIUM' }] }): IRelevanceModel & { inputs: RelevanceInput[] } => {
  const inputs: RelevanceInput[] = [];
  return { inputs, select: async (i) => { inputs.push(i); return out; } };
};

async function setup(model: IMessageModel, j: ISendabilityJudge, g: IClaimGrounder = grounder(grounded), rel: IRelevanceModel = relevanceModel()) {
  let n = 0;
  const repos = inMemoryResultLoopRepos();
  const now = () => new Date('2026-10-14T09:00:00Z');
  const resultService = new ResultLoopService({ ...repos, now, id: () => `r${++n}` });
  const writing = new InMemoryWritingRepository();
  const svc = new CommunicationService({ results: repos, resultService, writing, context, model, judge: j, grounder: g, relevance: rel, now, id: () => `w${++n}` }).withLanguage(async () => 'ro');
  const dr = await resultService.addContact(B, { type: 'PERSON', name: 'Dr. Ana Pop', role: 'medic ortoped', organisationName: 'Clinica Ortopedică Cluj', email: 'ana.pop@example.ro' }, { kind: 'founder' });
  return { svc, resultService, repos, writing, dr };
}

const GOOD = { subject: 'Pacienții după operație: vă putem ajuta?', body: 'Bună ziua, doamna doctor Pop,\n\nSunt Raluca, de la Body Move Studio. Facem kinetoterapie și Pilates în două locații în Cluj, iar un medic ne-a trimis deja 3 paciente. Ne gândeam că ar putea ajuta și pacienților dumneavoastră de ortopedie după tratament.\n\nAți fi deschisă la o discuție scurtă?\n\nRaluca' };

describe('sender identity: explicit, once, per business', () => {
  it('no confirmed sender → nothing is written; BB asks who signs', async () => {
    const m = writer(GOOD);
    const { svc, dr } = await setup(m, judge(allPass));
    const out = await svc.draft(B, dr.id);
    expect(out).toMatchObject({ status: 'needs_input', problems: [{ code: 'sender_unconfirmed', severity: 'blocking' }] });
    expect(m.inputs).toHaveLength(0);
  });
  it('confirmed once, reused; Raluca signs even though someone else owns the account', async () => {
    const { svc, dr } = await setup(writer(GOOD), judge(allPass));
    await svc.confirmSender(B, RALUCA);
    const out = await svc.draft(B, dr.id);
    expect(out.status).toBe('ready');
    if (out.status === 'ready') expect(out.brief.sender_identity).toMatchObject({ displayName: 'Raluca', role: 'fondatoare', business: 'Body Move Studio' });
    await expect(svc.confirmSender(B, { displayName: 'Raluca' })).rejects.toThrow(/required/);
  });
});

describe('the brief: grounded in real state, built before any prose', () => {
  it('carries the recipient, the touch history, why now, the bet, the founder\'s own facts and what never to say', async () => {
    const m = writer(GOOD);
    const { svc, resultService, dr } = await setup(m, judge(allPass));
    await svc.confirmSender(B, RALUCA);
    await resultService.logTouch(B, { contactId: dr.id, channel: 'VISIT', type: 'VISITED', summary: 'Am lăsat broșura la recepție', source: { kind: 'founder' }, createdBy: 'FOUNDER', occurredAt: '2026-10-10T10:00:00Z' });
    await resultService.recordOutcome(B, { contactId: dr.id, outcomeType: 'MATERIAL_REQUESTED', note: 'broșura pe email', evidence: { kind: 'founder' }, createdBy: 'FOUNDER', occurredAt: '2026-10-10T10:05:00Z' });
    await resultService.openFollowUp(B, { contactId: dr.id, what: 'Trimite broșura pe email', reason: 'a cerut broșura pe email', dueOn: '2026-10-14', createdBy: 'BB' });
    const out = await svc.draft(B, dr.id);
    // GOOD carries (correct) social proof: a brochure follow-up does not need it, so that draft never reaches her.
    expect(out.status).toBe('failed');
    if (out.status === 'failed') expect(out.reasons.map((r) => r.code)).toContain('fact_not_needed');
    const brief = m.inputs[0]!.brief;
    expect(brief.purpose).toBe('material_follow_up');
    expect(brief.recipient_identity).toMatchObject({ name: 'Dr. Ana Pop', organisation: 'Clinica Ortopedică Cluj' });
    expect(brief.recipient_role).toBe('medic ortoped');
    expect(brief.relationship_context).toMatch(/2026-10-10: you \(or your team\) visited.*broșura.*asked for material/);
    expect(brief.why_now).toMatch(/Trimite broșura pe email \(due 2026-10-14\)/);
    expect(brief.strategic_reason).toMatch(/doctors and recovery wards referring patients/);
    expect(brief.available_facts).toContain('2 medici confirmați, unul a trimis 3 paciente');
    expect(brief.supporting_context).toEqual([]); // a brochure follow-up needs no held fact (available ≠ needed)
    expect(brief.facts_use).toBe('none');
    expect(brief.what_not_to_say.join(' ')).toMatch(/no paid ads/);
    expect(brief.language).toBe('ro');
  });

  it('an unnamed contact (from a report) blocks writing until BB knows who it is', () => {
    const profile: WritingProfile = projectWritingProfile([]);
    const contact = { id: 'c', businessId: B, type: 'ORGANISATION' as const, name: 'Clinic 1', organisationName: null, role: null, email: null, phone: null, website: null, source: { kind: 'report' as const }, status: 'NEEDS_DETAILS' as const, createdAt: '', updatedAt: '' };
    const { brief, problems } = buildBrief({ profile: { ...profile, sender: RALUCA }, contact, touches: [], outcomes: [], openFollowUp: null, purpose: 'first_outreach', strategy: { goal: 'g', bet: 'b', referrer: null }, todayMove: null, founderSaid: [], businessOffer: null, constraints: [], language: 'ro', channel: 'EMAIL', relevance: null });
    expect(brief).toBeNull();
    expect(problems.map((p) => p.code)).toEqual(['recipient_unnamed', 'no_reachable_channel']);
  });

  it('purposeFor: first outreach → no-response follow-up → material follow-up, from what actually happened', () => {
    const t = (iso: string) => ({ id: 't', businessId: B, contactId: 'c', actionRef: null, channel: 'EMAIL' as const, direction: 'OUTBOUND' as const, type: 'SENT' as const, occurredAt: iso, summary: '', source: { kind: 'founder' as const }, createdBy: 'FOUNDER' as const, createdAt: iso });
    const o = (type: 'MATERIAL_REQUESTED' | 'NO_RESPONSE') => ({ id: 'o', businessId: B, contactId: 'c', touchId: null, outcomeType: type, stage: null, occurredAt: '2026-10-12T00:00:00Z', note: '', evidence: { kind: 'founder' as const }, createdBy: 'FOUNDER' as const, createdAt: '' });
    const fu = { id: 'f', businessId: B, contactId: 'c', what: 'x', reason: '', dueOn: '2026-10-14', status: 'OPEN' as const, createdFrom: null, replacesId: null, resolvedByTouchId: null, resolvedAt: null, createdBy: 'BB' as const, createdAt: '' };
    expect(purposeFor([], [], null)).toBe('first_outreach');
    expect(purposeFor([t('2026-10-01T00:00:00Z')], [], null)).toBe('no_response_follow_up');
    expect(purposeFor([t('2026-10-01T00:00:00Z')], [o('MATERIAL_REQUESTED')], fu)).toBe('material_follow_up');
    expect(relationshipContext([], [])).toMatch(/No contact yet/);
  });
});

// ── The gate: intentionally bad AI-corporate emails ──
const brief: CommunicationBrief = {
  sender_identity: RALUCA, recipient_identity: { name: 'Dr. Ana Pop', organisation: 'Clinica Ortopedică Cluj', email: null, phone: null }, recipient_role: 'medic ortoped', recipient_category: 'medical', register: 'r',
  relationship_context: 'No contact yet', why_now: 'w', strategic_reason: 's', desired_outcome: 'd', offer_or_value: null, supporting_context: ['2 medici confirmați, unul a trimis 3 paciente'], available_facts: ['2 medici confirmați, unul a trimis 3 paciente'], facts_use: 'optional',
  offer_items: [], writing_rules: [], relevant_offer_parts: [], relevance: { uncertain: true, source: 'model', correctionId: null }, what_not_to_say: [], prefer_to_avoid: [], cta: 'c', tone: 't', length: { maxWords: 90 }, language: 'en', channel: 'EMAIL', purpose: 'first_outreach',
};
const profile = (over: Partial<WritingProfile> = {}): WritingProfile => ({ ...projectWritingProfile([]), sender: RALUCA, ...over });
const codes = (subject: string | null, body: string, p = profile()) => checkSendability({ subject, body }, brief, p).map((f) => f.code);

describe('sendability gate: deterministic layer', () => {
  it('the AI-corporate classic fails on several counts', () => {
    const bad = 'I hope this email finds you well! I wanted to reach out to explore a potential partnership opportunity that could be mutually beneficial for both our organizations and leverage synergies in patient care. Our clinic achieved 95% satisfaction. Please don\'t hesitate to contact me at your earliest convenience. Would you be open to a call? Or maybe a meeting?\n\nBest regards,\n[Your Name]';
    const c = codes('Exploring a Strategic Partnership Opportunity Between Our Two Organizations', bad);
    expect(c).toEqual(expect.arrayContaining(['fake_warmth', 'corporate_phrase', 'invented_number', 'multiple_asks', 'placeholder', 'not_specific', 'unsigned', 'long_subject']));
  });

  it('the Romanian bureaucratic version fails too', () => {
    const bad = 'Stimate domnule doctor,\n\nVă rog să transmiteți acest mesaj responsabilului cu parteneriatele. Sper că acest mesaj vă găsește bine. Dorim să explorăm o posibilă colaborare reciproc avantajoasă.\n\nCu stimă,\nBody Move Studio';
    expect(codes('Propunere de colaborare', bad)).toEqual(expect.arrayContaining(['corporate_phrase', 'fake_warmth', 'not_specific', 'unsigned']));
  });

  it('a short human note from Raluca, about this doctor, with one ask, passes the deterministic layer', () => {
    expect(codes(GOOD.subject, GOOD.body.replace('doamna doctor Pop', 'doamna doctor Pop'))).toEqual([]);
  });

  it('founder writing voice: what she would never say fails; what she accepted is allowed', () => {
    expect(codes(GOOD.subject, GOOD.body, profile({ neverSay: ['Ne gândeam'] }))).toContain('never_say');
    const withStima = GOOD.body.replace('\n\nRaluca', '\n\nCu stimă,\nRaluca');
    expect(codes(GOOD.subject, withStima, profile({ acceptedPhrases: ['Cu stimă'] }))).toEqual([]);
  });

  it('a long body fails; numbers the founder gave are allowed', () => {
    expect(codes(null, `${'cuvânt '.repeat(110)} Pop.\n\nRaluca`)).toContain('too_long');
    expect(codes(GOOD.subject, GOOD.body)).toEqual([]); // "3 paciente" is the founder's number
  });
});

// Blocker 3 (acceptance 2026-10-14): Email A was rejected for "câțiva medici", Email C passed with the same inflation plus
// "funcționează bine pentru ambele părți". The same evidence discipline now applies to every message.
describe('evidence discipline: every claim as strong as the brief, for every message', () => {
  const OFFER = 'Kinetoterapie, Pilates, gimnastică prenatală și recuperare postpartum, masaj, în două locații din Cluj-Napoca (Bună Ziua și Decebal)';
  const part = (offer_part: string) => ({ offer_part, reason: 'r', evidence: [], confidence: 'HIGH' as const });
  const b: CommunicationBrief = { ...brief, recipient_role: 'secția Recuperare, Medicină Fizică și Balneologie', offer_or_value: OFFER, offer_items: offerItems(OFFER), relevant_offer_parts: [part('Kinetoterapie')] };
  const codesOf = (text: string) => checkEvidenceDiscipline(text, b).map((f) => f.code);

  it('the Email C sentence fails: a vague quantity of a counted thing + an unsupported success claim', () => {
    const c = codesOf('Am câțiva medici care trimit pacienți la noi și funcționează bine pentru ambele părți.');
    expect(c).toEqual(expect.arrayContaining(['quantifier_inflation', 'unsupported_claim']));
  });
  it('the Email A sentence fails the same way ("câțiva medici" for "2 medici")', () => {
    expect(codesOf('Câțiva medici ne trimit deja paciente.')).toContain('quantifier_inflation');
  });
  it('other languages and phrasings: several doctors / many patients / works well / successful partnership', () => {
    const en = (text: string) => checkEvidenceDiscipline(text, { ...b, supporting_context: ['2 doctors confirmed, one sent 3 patients'] }).map((f) => f.code);
    expect(en('Several doctors already send us patients.')).toContain('quantifier_inflation');
    expect(en('A few patients came from them.')).toContain('quantifier_inflation');
    expect(codesOf('It works really well.')).toContain('unsupported_claim');
    expect(codesOf('We have many patients from doctors.')).toContain('unsupported_claim');
    expect(codesOf('We have a successful partnership with two doctors.')).toContain('unsupported_claim');
  });
  it('the exact fact passes, and a vague quantity of something the brief does not count is fine', () => {
    expect(codesOf('Avem 2 medici confirmați, unul a trimis 3 paciente.')).toEqual([]);
    expect(codesOf('Doi medici ne trimit deja paciente.')).toContain('social_proof_distorted'); // one sent, not two
    expect(codesOf('Aveți câteva minute săptămâna aceasta?')).toEqual([]);
  });
  it('a success claim the brief itself makes is allowed', () => {
    const own: CommunicationBrief = { ...b, supporting_context: ['Colaborarea cu dr. X funcționează bine'] };
    expect(checkEvidenceDiscipline('Colaborarea cu dr. X funcționează bine.', own)).toEqual([]);
  });
  it('recipient relevance: naming the whole catalogue fails; one or two relevant parts pass', () => {
    expect(b.offer_items).toEqual(['Kinetoterapie', 'Pilates', 'gimnastică prenatală', 'recuperare postpartum', 'masaj']); // the place is not a service
    expect(codesOf('Facem kinetoterapie, Pilates, gimnastică prenatală, recuperare postpartum și masaj.')).toContain('offer_catalogue');
    expect(codesOf('Facem kinetoterapie pentru pacienții care au nevoie de recuperare, în două locații din Cluj-Napoca.')).toEqual([]);
  });
  it('the message keeps to the decided focus: any other offer part fails, whatever a model thinks of it', () => {
    expect(codesOf('Facem kinetoterapie și Pilates.')).toContain('irrelevant_offer');
    expect(codesOf('Facem kinetoterapie.')).toEqual([]);
    const none: CommunicationBrief = { ...b, relevant_offer_parts: [] };
    expect(checkEvidenceDiscipline('Facem kinetoterapie.', none).map((f) => f.code)).toEqual(['irrelevant_offer']); // uncertain → name none
  });
});

describe('available fact ≠ needed in this message', () => {
  it('a follow-up that uses (even correct) social proof fails; a first outreach may use it', () => {
    const followUp: CommunicationBrief = { ...brief, purpose: 'material_follow_up', facts_use: 'none', supporting_context: [] };
    expect(checkEvidenceDiscipline('Vă trimit broșura. Avem 2 medici confirmați.', followUp).map((f) => f.code)).toEqual(['fact_not_needed']);
    expect(checkEvidenceDiscipline('Vă trimit broșura. Avem 2 medici care trimit pacienți.', followUp).map((f) => f.code)).toEqual(['social_proof_distorted']);
    expect(checkEvidenceDiscipline('Vă trimit broșura cerută.', followUp)).toEqual([]);
    expect(checkEvidenceDiscipline('Avem 2 medici confirmați.', brief)).toEqual([]);
  });
});

describe('claim grounding: the model cites, the gate verifies', () => {
  const b: CommunicationBrief = { ...brief, offer_or_value: 'Kinetoterapie, Pilates', offer_items: ['Kinetoterapie', 'Pilates'] };
  const g = (claims: unknown[]) => checkClaimGrounding({ claims }, b).failures.map((f) => f.code);
  it('exact claims with verbatim support pass', () => {
    expect(g([{ claim: 'Doi medici ne trimit paciente', kind: 'quantity', support: '2 medici confirmați', verdict: 'exact' }])).toEqual([]);
  });
  it('unsupported, a citation that is not in the brief, broadened: each fails (relevance is not the grounder\'s call)', () => {
    expect(g([{ claim: 'funcționează bine pentru ambele părți', kind: 'result', support: null, verdict: 'unsupported' }])).toEqual(['unsupported_claim']);
    expect(g([{ claim: 'Avem 10 medici', kind: 'quantity', support: '10 medici parteneri', verdict: 'exact' }])).toEqual(['unsupported_claim']);
    expect(g([{ claim: 'câțiva medici', kind: 'quantity', support: '2 medici confirmați', verdict: 'broadened' }])).toEqual(['broadened_claim']);
    expect(g([{ claim: 'facem Pilates', kind: 'offer', support: 'Pilates', verdict: 'exact', relevant: false }])).toEqual([]);
  });
  it('a citation with the brief\'s field label around it is still the brief\'s text', () => {
    expect(g([{ claim: 'Sunt Raluca', kind: 'other', support: '"displayName": "Raluca"', verdict: 'exact' }])).toEqual([]);
  });
  it('fails closed: no claim list = not verified', () => {
    expect(checkClaimGrounding(null, b).failures.map((f) => f.code)).toEqual(['grounding']);
    expect(checkClaimGrounding({ claims: [] }, b).failures).toEqual([]);
  });
});

describe('specific = about this recipient OR about what already happened between them', () => {
  const hist: CommunicationBrief = { ...brief, recipient_identity: { name: 'Spitalul Clinic', organisation: null, email: null, phone: null }, recipient_role: 'secția Recuperare',
    relationship_context: '2026-10-10: you (or your team) visited (visit): "Am trecut pe la secretariat și am lăsat o broșură"' };
  it('a brochure follow-up that refers to the visit is specific; a generic note is not', () => {
    expect(checkSendability({ subject: 'Broșura', body: 'Bună ziua,\n\nAm lăsat broșura la secretariat; o găsiți atașată.\n\nRaluca' }, hist, profile()).map((x) => x.code)).not.toContain('not_specific');
    expect(checkSendability({ subject: 'Salut', body: 'Bună ziua,\n\nFacem kinetoterapie.\n\nRaluca' }, hist, profile()).map((x) => x.code)).toContain('not_specific');
  });
});

describe('sendability gate: the judge layer fails closed', () => {
  it('a malformed or partial judgement is not a pass', () => {
    expect(checkJudgement(null).sendable).toBe(false);
    expect(checkJudgement({ sendable: true, answers: [] }).sendable).toBe(false);
    expect(checkJudgement({ sendable: true, answers: SENDABILITY_QUESTIONS.map((question, i) => ({ question, pass: i !== 2, why: 'sounds like a template' })) }).sendable).toBe(false);
    expect(checkJudgement(allPass).sendable).toBe(true);
  });
});

describe('repair after a failed gate, and an honest failure', () => {
  it('a corporate first draft is repaired with the named failures, then ready', async () => {
    const bad = { subject: 'Partnership', body: 'I hope this email finds you well. I wanted to reach out about a partnership opportunity.\n\nBest,\nBody Move' };
    const m = writer(bad, GOOD);
    const { svc, dr } = await setup(m, judge(allPass));
    await svc.confirmSender(B, RALUCA);
    const out = await svc.draft(B, dr.id);
    expect(out).toMatchObject({ status: 'ready', attempts: 2 });
    expect(m.inputs[1]!.fix!.join(' ')).toMatch(/fake_warmth.*corporate_phrase|corporate_phrase.*fake_warmth/s);
  });

  it('the judge says "sounds like an AI" → repaired with its reasons', async () => {
    const no = { sendable: false, answers: SENDABILITY_QUESTIONS.map((question, i) => ({ question, pass: i !== 2, why: i === 2 ? 'reads like a template' : '' })), missingContext: [] };
    const m = writer(GOOD, GOOD);
    const j = judge(no, allPass);
    const { svc, dr } = await setup(m, j);
    await svc.confirmSender(B, RALUCA);
    expect((await svc.draft(B, dr.id)).status).toBe('ready');
    expect(m.inputs[1]!.fix![0]).toMatch(/judge: Does it sound like the sender.*template/);
  });

  it('still failing after 2 repairs → no draft is shown; why it failed + what to clarify', async () => {
    const bad = { subject: 'x', body: 'We would love to explore a potential collaboration with your clinic.\n\nRaluca' };
    const m = writer(bad);
    const { svc, dr } = await setup(m, judge({ ...allPass, missingContext: ['how Raluca knows Dr. Pop'] }));
    await svc.confirmSender(B, RALUCA);
    const out = await svc.draft(B, dr.id);
    expect(out.status).toBe('failed');
    expect(m.inputs).toHaveLength(1 + MAX_REPAIRS);
    if (out.status === 'failed') {
      expect(out).not.toHaveProperty('message');
      expect(out.reasons.map((r) => r.code)).toContain('corporate_phrase');
    }
  });
});

describe('grounding in the draft loop + the acceptance trace', () => {
  it('a grounding failure is repaired before the judge ever sees the draft', async () => {
    const m = writer(GOOD, GOOD);
    const j = judge(allPass);
    const gr = grounder({ claims: [{ claim: 'doi medici ne recomandă deja', kind: 'social_proof', support: '2 medici confirmați', verdict: 'broadened', why: 'recomandă ≠ confirmați' }] }, grounded);
    const { svc, dr } = await setup(m, j, gr);
    await svc.confirmSender(B, RALUCA);
    const out = await svc.draft(B, dr.id);
    expect(out).toMatchObject({ status: 'ready', attempts: 2 });
    expect(m.inputs[1]!.fix!.join(' ')).toMatch(/broadened_claim/);
    expect(j.calls).toBe(1);
    expect(out).not.toHaveProperty('trace'); // the API path never carries drafts that failed
  });

  it('a repair carries every earlier failure, so a fixed problem does not come back', async () => {
    const dump = { subject: 'x', body: 'Doamna doctor Pop, facem kinetoterapie, Pilates, gimnastică prenatală și masaj.\n\nRaluca' };
    const m = writer(dump, GOOD, GOOD);
    const gr = grounder({ claims: [{ claim: 'săptămâna trecută', kind: 'relationship', support: null, verdict: 'unsupported' }] }, grounded);
    const { svc, dr } = await setup(m, judge(allPass), gr);
    await svc.confirmSender(B, RALUCA);
    expect((await svc.draft(B, dr.id)).status).toBe('ready');
    expect(m.inputs[2]!.fix!.join(' ')).toMatch(/offer_catalogue.*unsupported_claim/s);
  });

  it('trace: true returns every attempt (draft + failures), also when no draft is shown', async () => {
    const bad = { subject: 'x', body: 'Câțiva medici ne trimit deja paciente, doamna doctor Pop.\n\nRaluca' };
    const { svc, dr } = await setup(writer(bad), judge(allPass));
    await svc.confirmSender(B, RALUCA);
    const out = await svc.draft(B, dr.id, { trace: true });
    expect(out.status).toBe('failed');
    if (out.status !== 'failed') return;
    expect(out.trace).toHaveLength(1 + MAX_REPAIRS);
    expect(out.trace![0]).toMatchObject({ attempt: 1, message: bad, judge: null });
    expect(out.trace![0]!.deterministic.map((f) => f.code)).toContain('quantifier_inflation');
  });

  it('the grounder failing (throws / malformed) fails closed', async () => {
    const { svc, dr } = await setup(writer(GOOD), judge(allPass), { ground: async () => { throw new Error('down'); } });
    await svc.confirmSender(B, RALUCA);
    const out = await svc.draft(B, dr.id);
    expect(out.status).toBe('failed');
    if (out.status === 'failed') expect(out.reasons.map((r) => r.code)).toEqual(['grounding']);
  });
});

// Recipient relevance (2026-10-14): decided ONCE per brief, used by the writer, every repair, the grounder, the judge, the UI.
describe('recipient relevance: one grounded decision per brief', () => {
  const input = (over: Partial<RelevanceInput> = {}): RelevanceInput => ({
    recipient: { name: 'Dr. Ana Pop', organisation: 'Clinica Ortopedică Cluj', role: 'medic ortoped' }, relationship_context: 'No contact yet',
    why_now: 'w', strategic_reason: 'medici care trimit pacienți', offer_items: ['Kinetoterapie', 'Pilates', 'gimnastică prenatală', 'masaj'],
    offer_or_value: 'Kinetoterapie, Pilates, gimnastică prenatală și masaj', supporting_context: [], priorCorrections: [], language: 'ro', ...over,
  });

  it('only verified offer parts; an inferred service ("recuperare post-operatorie") is never chosen', () => {
    const d = checkRelevance({ parts: [
      { offer_part: 'recuperare post-operatorie', reason: 'după operație', evidence: ['medic ortoped'], confidence: 'HIGH' },
      { offer_part: 'kinetoterapie', reason: 'Pacienții după tratament ortopedic au nevoie de kinetoterapie.', evidence: ['medic ortoped'], confidence: 'HIGH' },
    ] }, input());
    expect(d.parts.map((p) => p.offer_part)).toEqual(['Kinetoterapie']); // canonical item text
    expect(d).toMatchObject({ uncertain: false, source: 'model' });
  });
  it('evidence must be verbatim from the context; without it a choice is LOW and the decision uncertain', () => {
    const d = checkRelevance({ parts: [{ offer_part: 'Pilates', reason: 'poate ajuta', evidence: ['pacienți cu dureri cronice'], confidence: 'HIGH' }] }, input());
    expect(d.parts[0]).toMatchObject({ offer_part: 'Pilates', evidence: [], confidence: 'LOW' });
    expect(d.uncertain).toBe(true);
  });
  it('the reason shown to the founder is grounded: an added use case ("post-chirurgicală") is dropped, confidence lowered', () => {
    const ok = checkRelevance({ parts: [{ offer_part: 'Kinetoterapie', reason: 'Un medic ortoped trimite pacienți care au nevoie de kinetoterapie.', evidence: ['medic ortoped'], confidence: 'HIGH' }] }, input());
    expect(ok.parts[0]).toMatchObject({ confidence: 'HIGH', reason: 'Un medic ortoped trimite pacienți care au nevoie de kinetoterapie.' });
    expect(ok.parts[0]).not.toHaveProperty('droppedReason');
    const bad = checkRelevance({ parts: [{ offer_part: 'Kinetoterapie', reason: 'Kinetoterapia este continuarea recuperării post-chirurgicale sau post-traumatice.', evidence: ['medic ortoped'], confidence: 'HIGH' }] }, input());
    expect(bad.parts[0]).toMatchObject({ confidence: 'MEDIUM', reason: 'medic ortoped' });
    expect(bad.parts[0]!.ungroundedTerms).toEqual(expect.arrayContaining(['chirurgicale', 'traumatice']));
  });

  it('at most two parts, strongest first; malformed → nothing chosen, uncertain', () => {
    const many = ['Kinetoterapie', 'Pilates', 'masaj'].map((offer_part, i) => ({ offer_part, reason: 'r', evidence: ['medic ortoped'], confidence: (['LOW', 'HIGH', 'MEDIUM'] as const)[i] }));
    expect(checkRelevance({ parts: many }, input()).parts.map((p) => p.offer_part)).toEqual(['Pilates', 'masaj']);
    expect(checkRelevance(null, input())).toEqual({ parts: [], uncertain: true, source: 'model', correctionId: null });
  });

  it('decided ONCE per draft: every attempt (initial + repairs) gets the same focus', async () => {
    const dump = { subject: 'x', body: 'Doamna doctor Pop, facem kinetoterapie, Pilates, gimnastică prenatală și masaj.\n\nRaluca' };
    const m = writer(dump, dump, GOOD);
    const rel = relevanceModel();
    const { svc, dr } = await setup(m, judge(allPass), grounder(grounded), rel);
    await svc.confirmSender(B, RALUCA);
    const out = await svc.draft(B, dr.id);
    expect(out.status).toBe('ready');
    expect(rel.inputs).toHaveLength(1);
    const focus = m.inputs.map((i) => i.brief.relevant_offer_parts.map((p) => p.offer_part).join('+'));
    expect(focus).toEqual(['Kinetoterapie+Pilates', 'Kinetoterapie+Pilates', 'Kinetoterapie+Pilates']);
    if (out.status === 'ready') expect(out.brief.relevant_offer_parts[0]).toMatchObject({ offer_part: 'Kinetoterapie', confidence: 'HIGH' });
  });

  it('a message naming a service outside the focus fails deterministically and is repaired', async () => {
    const off = { subject: 'x', body: 'Doamna doctor Pop, facem kinetoterapie și masaj pentru pacienții dumneavoastră.\n\nRaluca' };
    const m = writer(off, GOOD);
    const { svc, dr } = await setup(m, judge(allPass));
    await svc.confirmSender(B, RALUCA);
    expect(await svc.draft(B, dr.id)).toMatchObject({ status: 'ready', attempts: 2 });
    expect(m.inputs[1]!.fix!.join(' ')).toMatch(/irrelevant_offer: Names masaj.*focuses on: Kinetoterapie, Pilates/);
  });

  it('the founder corrects the focus: durable, used for this contact without asking the model, evidence for similar recipients', async () => {
    const rel = relevanceModel();
    const { svc, resultService, writing, dr } = await setup(writer(GOOD), judge(allPass), grounder(grounded), rel);
    await svc.confirmSender(B, RALUCA);
    await svc.draft(B, dr.id); // BB: Kinetoterapie + Pilates
    await expect(svc.correctRelevance(B, dr.id, [{ offer_part: 'recuperare post-operatorie', reason: 'x' }])).rejects.toThrow(/at most two/); // not a verified offer part
    await expect(svc.correctRelevance(B, dr.id, [{ offer_part: 'Kinetoterapie', reason: '' }])).rejects.toThrow(/reason/);
    const d = await svc.correctRelevance(B, dr.id, [{ offer_part: 'kinetoterapie', reason: 'Îi trimite pacienți după operații de genunchi.' }]);
    expect(d).toMatchObject({ source: 'founder', uncertain: false, parts: [{ offer_part: 'Kinetoterapie', confidence: 'HIGH' }] });
    const stored = (await writing.list(B)).filter((e) => e.kind === 'RELEVANCE');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ key: dr.id, evidence: { kind: 'explicit' } });
    expect(JSON.parse(stored[0]!.text)).toMatchObject({ recipientRole: 'medic ortoped', removed: [] });

    const again = await svc.draft(B, dr.id);
    expect(rel.inputs).toHaveLength(1); // her choice, no model call
    if (again.status === 'ready') expect(again.brief).toMatchObject({ relevance: { source: 'founder' }, relevant_offer_parts: [{ offer_part: 'Kinetoterapie', reason: 'Îi trimite pacienți după operații de genunchi.' }] });

    const other = await resultService.addContact(B, { type: 'PERSON', name: 'Dr. Ion Rus', role: 'medic ortoped', email: 'i@x.ro' }, { kind: 'founder' });
    await svc.draft(B, other.id);
    expect(rel.inputs[1]!.priorCorrections).toEqual([expect.objectContaining({ contactId: dr.id, recipientRole: 'medic ortoped', parts: [{ offer_part: 'Kinetoterapie', reason: 'Îi trimite pacienți după operații de genunchi.' }] })]);
    expect((await svc.profile(B)).samples).toHaveLength(0); // a relevance correction is not writing voice / personality
  });

  it('nothing clearly relevant → the message may name no service, and BB says what would help', async () => {
    const bad = { subject: 'x', body: 'Doamna doctor Pop, facem kinetoterapie.\n\nRaluca' };
    const { svc, dr } = await setup(writer(bad), judge(allPass), grounder(grounded), relevanceModel({ parts: [] }));
    await svc.confirmSender(B, RALUCA);
    const out = await svc.draft(B, dr.id);
    expect(out.status).toBe('failed');
    if (out.status === 'failed') {
      expect(out.brief.relevance.uncertain).toBe(true);
      expect(out.clarify[0]).toMatch(/not sure which of your services/);
    }
  });
});

describe('execution write-back: "I sent it"', () => {
  it('logs a SENT touch (completing the open follow-up) and keeps what she actually sent as a writing sample, with the edit', async () => {
    const { svc, resultService, repos, writing, dr } = await setup(writer(GOOD), judge(allPass));
    await svc.confirmSender(B, RALUCA);
    const fu = await resultService.openFollowUp(B, { contactId: dr.id, what: 'Scrie-i', dueOn: '2026-10-14', createdBy: 'BB' });
    const sent = GOOD.body.replace('Ați fi deschisă la o discuție scurtă?', 'Vă pot suna joi?');
    const touch = await svc.markSent(B, dr.id, { messageId: 'm1', subject: GOOD.subject, body: sent, draftBody: GOOD.body, channel: 'EMAIL' });
    expect(touch).toMatchObject({ type: 'SENT', channel: 'EMAIL', createdBy: 'FOUNDER', source: { kind: 'message', messageId: 'm1' } });
    expect((await repos.followUps.list(B)).find((f) => f.id === fu.id)).toMatchObject({ status: 'DONE', resolvedByTouchId: touch.id });
    const samples = (await writing.list(B)).filter((e) => e.kind === 'SAMPLE');
    expect(samples[0]).toMatchObject({ text: sent, evidence: { kind: 'edit', ref: touch.id, before: GOOD.body, after: sent, recipientCategory: 'medical', channel: 'EMAIL', sender: 'raluca|body move studio' } });
    // A light edit: the final is still mostly BB's prose, so it is edit evidence, NOT her own sample.
    expect(samples[0]!.evidence.authoredShare).toBeLessThan(0.5);
    expect((await svc.profile(B)).samples).toHaveLength(0);
    // Exactly what she changed is kept as writing evidence (not a fact, not a trait).
    expect(samples[0]!.evidence.removed!.join(' ')).toMatch(/Ați fi deschisă la o discuție scurtă/);
    expect(samples[0]!.evidence.added).toEqual(['Vă pot suna joi']);
  });

  it('her samples / liked examples / preferences become traceable rules in the next brief; liked examples are not her voice', async () => {
    const m = writer(GOOD);
    const { svc, dr } = await setup(m, judge(allPass));
    await svc.confirmSender(B, RALUCA);
    await svc.addWriting(B, 'SAMPLE', 'Bună ziua,\n\nVă scriu de la Body Move. Vă pot suna joi?\n\nMulțumesc,\nRaluca', null, { recipientCategory: 'medical', channel: 'EMAIL' });
    await svc.addWriting(B, 'LIKED', 'Hi Ana, quick one: can I send you our leaflet?');
    await svc.addWriting(B, 'PREFERENCE', 'scurt', 'length');
    await svc.draft(B, dr.id);
    const input = m.inputs[0]!;
    expect(input.samples).toHaveLength(1);
    expect(input.liked).toEqual(['Hi Ana, quick one: can I send you our leaflet?']);
    const rules = Object.fromEntries(input.brief.writing_rules.map((r) => [r.key, r]));
    expect(rules['length']).toMatchObject({ source: 'explicit', maxWords: 70 });
    expect(rules['greeting']).toMatchObject({ value: 'Bună ziua,', source: 'samples' });
    expect(rules['greeting']!.evidence).toHaveLength(1);
  });

  it('her samples and accepted phrases reach the writer (her voice, never a personality guess)', async () => {
    const m = writer(GOOD);
    const { svc, dr } = await setup(m, judge(allPass));
    await svc.confirmSender(B, RALUCA);
    await svc.addWriting(B, 'SAMPLE', 'Bună, sunt Raluca de la Body Move. Vă las numărul meu dacă vreți să vorbim.');
    await svc.addWriting(B, 'ACCEPTED_PHRASE', 'Vă las numărul meu');
    await svc.addWriting(B, 'PREFERENCE', 'scurt', 'length');
    await svc.draft(B, dr.id);
    expect(m.inputs[0]!.samples[0]).toMatch(/Vă las numărul meu/);
    expect(m.inputs[0]!.acceptedPhrases).toEqual(['Vă las numărul meu']);
    expect(m.inputs[0]!.brief.length.maxWords).toBe(70);
    await expect(svc.addWriting(B, 'PREFERENCE', 'x', 'personality')).rejects.toThrow(/Unknown preference/);
  });
});

// ── BB must not learn its own prose as her voice (self-reinforcement) ──
describe('a BB draft she sends is not her writing', () => {
  const DOCTOR_EMAIL = 'Bună ziua,\n\nVă scriu pentru pacienții care termină tratamentul ortopedic: îi putem prelua pentru recuperare aproape de clinică. Vă pot suna joi?\n\nMulțumesc,\nRaluca';

  it('A: sent unchanged → accepted_draft, NOT in her own samples, no rule from it', async () => {
    const { svc, writing, dr } = await setup(writer(GOOD), judge(allPass));
    await svc.confirmSender(B, RALUCA, 'acct-claudia');
    await svc.markSent(B, dr.id, { messageId: 'm1', subject: GOOD.subject, body: GOOD.body, draftBody: GOOD.body, channel: 'EMAIL', actorId: 'acct-claudia' });
    const [e] = (await writing.list(B)).filter((x) => x.kind === 'SAMPLE');
    expect(e!.evidence).toMatchObject({ kind: 'accepted_draft', actor: { kind: 'account_user', id: 'acct-claudia' }, sender: 'raluca|body move studio', recipientCategory: 'medical', channel: 'EMAIL' });
    const p = await svc.profile(B);
    expect(p.samples).toEqual([]);
    expect(p.acceptedDrafts).toBe(1);
    expect(p.rules.filter((r) => r.source === 'samples')).toEqual([]);
  });

  it('B: materially rewritten → founder-edited evidence: before/after kept, and the final counts as her own text', async () => {
    const { svc, writing, dr } = await setup(writer(GOOD), judge(allPass));
    await svc.confirmSender(B, RALUCA);
    await svc.markSent(B, dr.id, { messageId: 'm1', subject: GOOD.subject, body: DOCTOR_EMAIL, draftBody: GOOD.body, channel: 'EMAIL' });
    const [e] = (await writing.list(B)).filter((x) => x.kind === 'SAMPLE');
    expect(e!.evidence).toMatchObject({ kind: 'edit', before: GOOD.body, after: DOCTOR_EMAIL, purpose: 'first_outreach', contactId: dr.id });
    expect(e!.evidence.authoredShare).toBeGreaterThanOrEqual(0.5);
    const p = await svc.profile(B, { recipientCategory: 'medical', channel: 'EMAIL', purpose: 'first_outreach' });
    expect(p.samples.map((x) => x.text)).toEqual([DOCTOR_EMAIL]);
    expect(p.rules.find((r) => r.key === 'greeting')).toMatchObject({ value: 'Bună ziua,', source: 'samples', evidence: [e!.id] });
  });

  it('C: repeated unchanged BB drafts cannot reinforce BB prose into her profile', async () => {
    const { svc, resultService, dr } = await setup(writer(GOOD), judge(allPass));
    await svc.confirmSender(B, RALUCA);
    for (let i = 0; i < 5; i++) {
      const c = i === 0 ? dr : await resultService.addContact(B, { type: 'PERSON', name: `Dr. Test ${i}`, role: 'medic' }, { kind: 'founder' });
      await svc.markSent(B, c.id, { messageId: `m${i}`, subject: GOOD.subject, body: GOOD.body, draftBody: GOOD.body, channel: 'EMAIL' });
    }
    const p = await svc.profile(B, { recipientCategory: 'medical', channel: 'EMAIL', purpose: 'first_outreach' });
    expect([p.samples.length, p.acceptedDrafts]).toEqual([0, 5]);
    expect(p.rules).toEqual([]);
    const m = writer(GOOD);
    const s2 = await setup(m, judge(allPass));
    await s2.svc.confirmSender(B, RALUCA);
    for (let i = 0; i < 3; i++) await s2.svc.markSent(B, s2.dr.id, { messageId: `m${i}`, subject: null, body: GOOD.body, draftBody: GOOD.body, channel: 'EMAIL' });
    await s2.svc.draft(B, s2.dr.id);
    expect(m.inputs[0]!.samples).toEqual([]); // the writer never sees its own earlier drafts as "how she writes"
  });
});

// ── External writing evidence is scoped: sender, kind of recipient, channel, purpose ──
describe('register is a property of the context, not of the founder', () => {
  const DOCTOR = 'Bună ziua,\n\nVă scriu de la Body Move. Vă pot trimite detalii despre recuperare?\n\nMulțumesc,\nRaluca';
  const CLIENT_WA = 'Salut Ioana! Ai loc joi la 18? Te aștept 🙂 Raluca';

  it('doctor + email samples shape the doctor-email rules only; a WhatsApp to an individual does not inherit "Bună ziua" or formal address', async () => {
    const m = writer(GOOD);
    const { svc, resultService, dr } = await setup(m, judge(allPass));
    await svc.confirmSender(B, RALUCA);
    await svc.addWriting(B, 'SAMPLE', DOCTOR, null, { recipientCategory: 'medical', channel: 'EMAIL' });
    await svc.addWriting(B, 'SAMPLE', DOCTOR.replace('detalii', 'broșura'), null, { recipientCategory: 'medical', channel: 'EMAIL' });
    const doctorRules = (await svc.profile(B, { recipientCategory: 'medical', channel: 'EMAIL', purpose: 'first_outreach' })).rules;
    expect(doctorRules.find((r) => r.key === 'greeting')).toMatchObject({ value: 'Bună ziua,', scope: { recipientCategory: 'medical', channel: 'EMAIL' } });
    expect(doctorRules.find((r) => r.key === 'formality')).toMatchObject({ register: 'formal' });
    const waRules = (await svc.profile(B, { recipientCategory: 'individual', channel: 'WHATSAPP', purpose: 'first_outreach' })).rules;
    expect(waRules.filter((r) => ['greeting', 'signoff', 'formality', 'punctuation', 'length', 'cta'].includes(r.key))).toEqual([]);
    // Her own WhatsApp to a client shapes the WhatsApp rules, and does not leak into doctor emails.
    await svc.addWriting(B, 'SAMPLE', CLIENT_WA, null, { recipientCategory: 'individual', channel: 'WHATSAPP' });
    expect((await svc.profile(B, { recipientCategory: 'individual', channel: 'WHATSAPP', purpose: null })).rules.find((r) => r.key === 'punctuation')).toMatchObject({ noExclamation: false });
    expect((await svc.profile(B, { recipientCategory: 'medical', channel: 'EMAIL', purpose: null })).rules.find((r) => r.key === 'punctuation')).toMatchObject({ noExclamation: true });
    // The brief for a person on WhatsApp gets the context register, and her doctor emails only as voice examples.
    const ioana = await resultService.addContact(B, { type: 'PERSON', name: 'Ioana', phone: '+40700000000' }, { kind: 'founder' });
    await svc.draft(B, ioana.id, { channel: 'WHATSAPP' });
    const input = m.inputs.at(-1)!;
    expect(input.brief.recipient_category).toBe('individual');
    expect(input.brief.register).toMatch(/individual/);
    expect(input.samplesFrom).toBe('this_context');
    void dr;
  });

  it('a sample with no known context is a voice example only: it shapes no rule', async () => {
    const m = writer(GOOD);
    const { svc, dr } = await setup(m, judge(allPass));
    await svc.confirmSender(B, RALUCA);
    await svc.addWriting(B, 'SAMPLE', DOCTOR);
    expect((await svc.profile(B)).rules).toEqual([]);
    await svc.draft(B, dr.id);
    expect(m.inputs[0]!.samples).toEqual([DOCTOR]);
    expect(m.inputs[0]!.samplesFrom).toBe('other_contexts');
    expect(m.inputs[0]!.brief.register).toMatch(/medical professional.*dumneavoastră/);
  });

  it('the cta rule comes only from her messages with the same purpose', () => {
    const e = (text: string, purpose: 'first_outreach' | 'no_response_follow_up'): WritingEntry => ({ id: `${purpose}-${text.length}`, businessId: B, kind: 'SAMPLE', key: null, text,
      evidence: { kind: 'sample', sender: 'raluca|body move studio', recipientCategory: 'medical', channel: 'EMAIL', purpose }, createdAt: '2026-10-14T09:00:00Z' });
    const entries = [e(DOCTOR, 'first_outreach'), e('Bună ziua,\n\nRevin cu broșura de care vorbeam. O las la recepție luni.\n\nRaluca', 'no_response_follow_up')];
    expect(deriveWritingRules(entries, { recipientCategory: 'medical', channel: 'EMAIL', purpose: 'first_outreach' }).find((r) => r.key === 'cta')!.value).toMatch(/question/);
    expect(deriveWritingRules(entries, { recipientCategory: 'medical', channel: 'EMAIL', purpose: 'no_response_follow_up' }).find((r) => r.key === 'cta')!.value).toMatch(/not a question/);
  });
});

// ── Identity: the account user is not assumed to be the sender ──
describe('author and sender are different', () => {
  it('evidence is attributed to the sender it was entered for; a different signer starts from nothing', async () => {
    const { svc, writing } = await setup(writer(GOOD), judge(allPass));
    await expect(svc.addWriting(B, 'NEVER_SAY', 'Cu stimă')).rejects.toThrow(/Confirm who signs/);
    await svc.confirmSender(B, RALUCA, 'acct-claudia');
    await svc.addWriting(B, 'NEVER_SAY', 'Cu stimă', null, { actorId: 'acct-claudia' });
    const [e] = (await writing.list(B)).filter((x) => x.kind === 'NEVER_SAY');
    expect(e!.evidence).toMatchObject({ actor: { kind: 'account_user', id: 'acct-claudia' }, sender: 'raluca|body move studio' });
    expect((await svc.profile(B)).neverSay).toEqual(['Cu stimă']);
    await svc.confirmSender(B, { displayName: 'Mihai', role: 'manager', business: 'Body Move Studio', signOff: null }, 'acct-claudia');
    expect((await svc.profile(B)).neverSay).toEqual([]); // Raluca's evidence never becomes Mihai's
    await svc.confirmSender(B, RALUCA, 'acct-claudia');
    expect((await svc.profile(B)).neverSay).toEqual(['Cu stimă']);
  });
});
