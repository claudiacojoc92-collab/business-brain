import { describe, it, expect } from 'vitest';
import { checkWritingRules, deriveWritingRules, draftEdits, removedWording } from './writing-rules';
import { checkSendability } from './sendability';
import { buildBrief } from './brief';
import type { Contact } from '../result-loop/contracts';
import { projectWritingProfile } from './writing';
import type { CommunicationBrief, WritingEntry } from './contracts';

let n = 0;
const SK = 'raluca|body move studio';
// Every entry is about the confirmed sender (Raluca); a sample defaults to the context "doctor, by email".
const entry = (kind: WritingEntry['kind'], text: string, over: Partial<WritingEntry> = {}): WritingEntry => ({
  id: `w${++n}`, businessId: 'bm', kind, key: null, text, createdAt: `2026-10-14T09:00:${String(n).padStart(2, '0')}Z`, ...over,
  evidence: { kind: kind === 'SAMPLE' ? 'sample' : 'explicit', sender: SK, ...(kind === 'SAMPLE' ? { recipientCategory: 'medical' as const, channel: 'EMAIL' as const } : {}), ...(over.evidence ?? {}) },
});
const SENDER = entry('SENDER', JSON.stringify({ displayName: 'Raluca', role: 'fondatoare', business: 'Body Move Studio', signOff: null }));

// Three real-looking messages in one consistent voice: "Bună ziua," · formal · short · no dashes · no "!" · "Mulțumesc,\nRaluca".
const S1 = entry('SAMPLE', 'Bună ziua,\n\nVă scriu de la Body Move. Facem kinetoterapie în Cluj. Vă pot trimite detalii?\n\nMulțumesc,\nRaluca');
const S2 = entry('SAMPLE', 'Bună ziua,\n\nAm lăsat broșura la recepție. Dacă aveți pacienți care au nevoie, mă puteți suna.\n\nMulțumesc,\nRaluca');
const S3 = entry('SAMPLE', 'Bună ziua,\n\nRevin la mesajul meu. Vă pot suna joi?\n\nMulțumesc,\nRaluca');

describe('writing rules come only from evidence, and each names its entries', () => {
  it('derives length, greeting, sign-off, register, CTA and punctuation from her real messages', () => {
    const rules = deriveWritingRules([S1, S2, S3]);
    const r = Object.fromEntries(rules.map((x) => [x.key, x]));
    expect(r['greeting']).toMatchObject({ value: 'Bună ziua,', source: 'samples', evidence: [S1.id, S2.id, S3.id] });
    expect(r['signoff']).toMatchObject({ value: 'Mulțumesc,\nRaluca', source: 'samples' });
    expect(r['formality']).toMatchObject({ register: 'formal', source: 'samples' });
    expect(r['punctuation']).toMatchObject({ noExclamation: true, noDashes: true });
    expect(r['cta']!.value).toMatch(/question/);
    expect(r['length']!.maxWords).toBeLessThan(40);
  });

  it('an explicit preference overrides what the samples suggest', () => {
    const pref = entry('PREFERENCE', 'Salut,', { key: 'greeting' });
    const r = deriveWritingRules([S1, S2, S3, pref]).find((x) => x.key === 'greeting')!;
    expect(r).toMatchObject({ value: 'Salut,', source: 'explicit', evidence: [pref.id] });
  });

  it('outreach she liked is NOT her voice: it never shapes the rules', () => {
    const liked = entry('SAMPLE', 'Hey!!! — quick one — would love to chat!', { evidence: { kind: 'liked' } });
    expect(deriveWritingRules([S1, S2, S3, liked]).find((x) => x.key === 'punctuation')).toMatchObject({ noExclamation: true, noDashes: true });
    const p = projectWritingProfile([SENDER, S1, liked]);
    expect(p.samples.map((s) => s.id)).toEqual([S1.id]);
    expect(p.liked.map((s) => s.id)).toEqual([liked.id]);
  });

  it('no evidence → no rules (generic defaults apply, nothing is invented)', () => {
    expect(deriveWritingRules([])).toEqual([]);
  });
});

describe('her edits of a BB draft become writing evidence', () => {
  const draft = 'Bună ziua,\n\nMă gândeam că ar putea fi util să discutăm despre o posibilă colaborare. Ați fi deschis la o discuție scurtă?\n\nRaluca';
  const final = 'Bună ziua,\n\nVă pot suna joi pentru cinci minute?\n\nRaluca';
  it('exact changes: what she removed and what she added', () => {
    const d = draftEdits(draft, final);
    expect(d.removed.join(' | ')).toMatch(/Mă gândeam că ar putea fi util/);
    expect(d.added.join(' | ')).toMatch(/Vă pot suna joi pentru cinci minute/);
  });
  it('removed wording (2–8 words, no numbers, not re-added) is kept as contextual evidence, traceable to the edit', () => {
    const d = { removed: ['Mă gândeam că ar putea fi util', 'o', 'în 3 zile'], added: [] };
    expect(removedWording(d)).toEqual(['Mă gândeam că ar putea fi util']);
    const e = entry('SAMPLE', final, { evidence: { kind: 'edit', before: draft, after: final, removed: ['Mă gândeam că'], added: [], purpose: 'first_outreach', contactId: 'c1' } });
    const rules = deriveWritingRules([e]);
    expect(rules.find((x) => x.key === 'never_say')).toBeUndefined();
    expect(rules.find((x) => x.key === 'changed_once')).toMatchObject({ source: 'edit', evidence: [e.id], phrases: ['Mă gândeam că'], purpose: 'first_outreach' });
    expect(projectWritingProfile([SENDER, e]).rejectedInContext).toEqual([
      { phrase: 'Mă gândeam că', entryId: e.id, purpose: 'first_outreach', contactId: 'c1', recipientCategory: 'medical', before: draft, after: final, at: e.createdAt },
    ]);
  });
});

// ── Three levels of wording evidence: explicit never-say (hard) / one edit (context) / repeated edits (soft preference) ──
describe('an edit is never a hard never-say', () => {
  const DRAFT = 'Bună ziua,\n\nVă scriu de la Body Move. Dacă are sens, vă pot suna joi?\n\nMulțumesc,\nRaluca';
  const edit = (removed: string[], contactId: string, purpose: 'first_outreach' | 'no_response_follow_up' = 'first_outreach'): WritingEntry =>
    entry('SAMPLE', 'Bună ziua,\n\nVă pot suna joi?\n\nRaluca', { evidence: { kind: 'edit', before: DRAFT, after: 'Bună ziua,\n\nVă pot suna joi?\n\nRaluca', removed, added: [], purpose, contactId } });
  const briefFor = (entries: WritingEntry[], purpose: 'first_outreach' | 'no_response_follow_up') => buildBrief({
    profile: projectWritingProfile([SENDER, ...entries]), contact: { id: 'cX', name: 'Dr. Ana Pop', status: 'ACTIVE', organisationName: null, role: 'medic', email: 'a@x.ro', phone: null } as unknown as Contact,
    touches: [], outcomes: [], openFollowUp: null, purpose, strategy: { goal: 'g', bet: 'b', referrer: 'doctors' }, todayMove: null, founderSaid: [],
    businessOffer: null, constraints: [], language: 'ro', channel: 'EMAIL', relevance: null,
  }).brief!;

  const neverSayHits = (entries: WritingEntry[]): string[] => {
    const p = projectWritingProfile([SENDER, ...entries]);
    return checkSendability({ subject: 'Body Move', body: DRAFT.replace('Body Move.', 'Body Move, pentru dr. Ana Pop.') }, briefFor(entries, 'first_outreach'), p)
      .filter((f) => f.code === 'never_say').map((f) => f.detail);
  };

  it('A: one edit removes "dacă are sens" → a future draft using it is NOT blocked; it is soft context for a similar message only', () => {
    const e = edit(['Dacă are sens'], 'c1');
    expect(neverSayHits([e])).toEqual([]);
    const b = briefFor([e], 'first_outreach');
    expect(b.what_not_to_say.join(' ')).not.toMatch(/are sens/i);
    expect(b.writing_rules.some((r) => r.key === 'changed_once')).toBe(false);
    expect(b.prefer_to_avoid.join(' ')).toMatch(/"Dacă are sens": removed once, from a first outreach message/);
    expect(briefFor([e], 'no_response_follow_up').prefer_to_avoid).toEqual([]);
  });

  it('B: she explicitly adds "dacă are sens" to never-say → a future draft IS blocked', () => {
    expect(neverSayHits([entry('NEVER_SAY', 'dacă are sens')])).toEqual(['The founder never says "dacă are sens".']);
    const r = deriveWritingRules([edit(['Dacă are sens'], 'c1'), entry('NEVER_SAY', 'dacă are sens')]);
    expect(r.find((x) => x.key === 'never_say')).toMatchObject({ source: 'explicit', phrases: ['dacă are sens'] });
    expect(r.some((x) => x.key === 'changed_once')).toBe(false); // the explicit rule supersedes the soft evidence
  });

  it('C: several independent edits remove similar wording → a traceable soft preference, never a never-say', () => {
    const es = [edit(['Dacă are sens'], 'c1'), edit(['dacă vi se pare că are sens'], 'c2', 'no_response_follow_up'), edit(['dacă are sens pentru dumneavoastră'], 'c3')];
    const r = deriveWritingRules(es);
    expect(r.find((x) => x.key === 'never_say')).toBeUndefined();
    const pref = r.find((x) => x.key === 'usually_avoids')!;
    expect(pref).toMatchObject({ source: 'edits', evidence: es.map((e) => e.id), against: [] });
    expect(pref.value).toMatch(/usually avoids .*removed in 3 of your edits, to 3 people/);
    expect(neverSayHits(es)).toEqual([]);
    expect(briefFor(es, 'requested_follow_up' as 'first_outreach').prefer_to_avoid).toEqual([pref.value]); // a preference: every purpose
    // reversible: an explicit accepted phrase takes it out
    expect(deriveWritingRules([...es, entry('ACCEPTED_PHRASE', 'dacă are sens')]).some((x) => x.key === 'usually_avoids')).toBe(false);
  });

  it('D: her real message uses wording one earlier edit removed → not forbidden, not even soft for the writer', () => {
    const e = edit(['Dacă are sens'], 'c1');
    const own = entry('SAMPLE', 'Bună ziua,\n\nDacă are sens, vă pot trimite broșura.\n\nMulțumesc,\nRaluca');
    expect(neverSayHits([e, own])).toEqual([]);
    const once = deriveWritingRules([e, own]).find((x) => x.key === 'changed_once')!;
    expect(once.against).toEqual([own.id]);
    expect(once.value).toMatch(/you do use it in 1 of your own message/);
    expect(briefFor([e, own], 'first_outreach').prefer_to_avoid).toEqual([]);
  });
});

describe('a draft is checked against her rules deterministically', () => {
  const brief = (rules: ReturnType<typeof deriveWritingRules>): CommunicationBrief => ({ language: 'ro', writing_rules: rules } as unknown as CommunicationBrief);
  const rules = deriveWritingRules([S1, S2, S3]);
  it('greeting, sign-off, register, dashes: each failure cites her messages', () => {
    const bad = 'Salut,\n\nFacem kinetoterapie – poți să le spui pacienților?\n\nRaluca';
    const f = checkWritingRules({ subject: null, body: bad }, brief(rules)).map((x) => x.detail).join(' | ');
    expect(f).toMatch(/opens with "Bună ziua,"/);
    expect(f).toMatch(/signs off with "Mulțumesc, \/ Raluca"/);
    expect(f).toMatch(/formal second person/);
    expect(f).toMatch(/never uses dashes \(her 3 messages\)/);
    const good = 'Bună ziua,\n\nFacem kinetoterapie în Cluj. Vă pot suna joi?\n\nMulțumesc,\nRaluca';
    expect(checkWritingRules({ subject: null, body: good }, brief(rules))).toEqual([]);
  });
});
