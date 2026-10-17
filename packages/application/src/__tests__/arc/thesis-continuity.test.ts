/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { strategyRead, type ThesisRecord } from '../../arc/index';
import { MirrorService, updatedReadInput } from '../../mirror/index';
import { validateStrategy } from '../../strategy/validation';
import { ConversationService } from '../../conversation/conversation.service';

// CARRY-FORWARD (2026-10-16): question ↔ thesis, answer ↔ thesis, mirror movement by thesis id, strategy traces to theses.
const T = (id: string, o: any = {}) => ({ id, headline: `H ${id}`, facts: ['F1', 'F2'], relationship: `relationship ${id}`, implication: `implication ${id}`, decisions: ['acquisition'], ifTrue: 'x', weakenedBy: `weak ${id}`, unknown: `unknown ${id}`, question: `Question ${id}?`, questionWhy: 'w', dimensions: ['acquisition', 'conversion'], priority: 1, founder: { headline: '', body: '', refs: [] }, eligibility: { pass: true, reasons: [], observationOnly: false }, rank: 1, ...o });
const RECORD: ThesisRecord = {
  snapshotId: 'snap1', businessModel: { motions: [], offerRoles: [], decisionPoints: [] },
  theses: [T('T1'), T('T2'), T('T3', { rank: 3 })], top: ['T1', 'T2'],
  questions: [{ question: 'Which plans bring the most revenue?', why: 'w', tier: 'A', dimension: 'performance' }, { question: 'Question T1?', why: 'w', tier: 'B', resolves: 'T1' }, { question: 'Question T2?', why: 'w', tier: 'C', resolves: 'T2' }],
  founder: { myRead: 'r', matters: [] }, dropped: [],
};
const U: any = { offer: { summary: 'o' }, unknowns: [], read: { structure: { synthesis: 'S.', hypotheses: [{ interpretation: 'old hypothesis', alternative: '', reversal: '', discriminator: { unknown: '', question: '' }, evidence: [] }] } } };
const EX = [
  { asked: 'Which plans bring the most revenue?', answer: 'Team plans.' },
  { asked: 'Noted.\n\nQuestion T1?', answer: 'Mostly through demos.' },
  { asked: 'Question T2?', answer: '(skip)' },
];

describe('conversation: the agenda is the thesis questions for the current snapshot', () => {
  it('opens on the first thesis-selected question, not the stored unknowns', async () => {
    const turns: any[] = []; let session: any = null;
    const svc = new ConversationService({
      conversations: { getByBusiness: async () => session, create: async (x: any) => (session = { ...x, status: 'active' }), listTurns: async () => turns, appendTurn: async (t: any) => { turns.push(t); return t; }, setStatus: async () => undefined, setLanguage: async () => undefined } as any,
      needs: { seed: async () => undefined, listOpen: async () => [], markAnswered: async () => undefined } as any,
      state: { append: async () => undefined, listActive: async () => [] } as any, observations: { observe: async () => null } as any,
      model: { step: async () => ({ interpretation: '', nextQuestion: null, readyForAha2: false, declarations: [], businessCorrections: [], observationCandidates: [], answeredNeedKeys: [], newNeeds: [], opener: { lead: 'l', bullets: [], notSure: '', invitation: 'model question' } }) } as any,
      understanding: { latest: async () => ({ id: 'snap1', understanding: { ...U, unknowns: ['stored question?'] } }) } as any,
      aha1: { latest: async () => null } as any, sources: { listForBusiness: async () => [] } as any,
      agendaFor: async (_b: string, sid: string) => (sid === 'snap1' ? RECORD.questions.map((q) => q.question) : null),
    });
    await svc.startOrResume('B', 'F', 'N', 'en');
    expect(JSON.parse(turns[0].content).__arcOpener.invitation).toBe('Which plans bring the most revenue?');
  });
});

describe('mirror: the readings it moves are the top theses, by id', () => {
  it('feeds the top theses with their own questions; the skipped thesis question keeps that thesis unresolved', () => {
    const i = updatedReadInput(U, [], EX, 'N', 'en', [], [], RECORD)!;
    expect(i.thesisIds).toEqual(['T1', 'T2']);
    expect(i.hypotheses.map((h) => h.question)).toEqual(['Question T1?', 'Question T2?']);
    expect(i.hypotheses[0]!.interpretation).toBe('relationship T1 implication T1');
    expect(i.unresolved).toEqual([1]);
    expect(i.questions).toEqual(RECORD.questions.map((q) => q.question));
  });

  it('returns each movement by thesis id (skipped → unresolved, whatever the model said)', async () => {
    const svc = new MirrorService({
      understanding: { latest: async () => ({ understanding: U }) } as any, state: { listActive: async () => [] } as any, strategy: { getCurrent: async () => null } as any,
      model: { contrast: async () => ({ mismatches: [] }), readUpdate: async () => ({ hypotheses: [{ index: 0, status: 'sharpened', because: 'demos' }, { index: 1, status: 'strengthened', because: 'guess' }], fields: [{ field: 'now', text: 'Large teams come in through demos.', answers: [1], evidence: ['H0'] }] }) },
    });
    const v = await svc.build('B', 'N', 'en', { exchanges: EX, theses: RECORD });
    expect(v.moves).toEqual([{ thesisId: 'T1', status: 'sharpened', because: 'demos' }, { thesisId: 'T2', status: 'unresolved', because: expect.stringContaining('deciding question skipped') }]);
  });
});

describe('strategy: the theses arrive with status and their answers; the core bet must trace to them', () => {
  it('strategyRead carries the top theses, their latest status and the founder answers given through their questions', () => {
    const r = strategyRead(U, EX, null, RECORD, [{ thesisId: 'T1', status: 'sharpened', because: 'demos' }])!;
    expect(r.theses!.map((t) => [t.id, t.status, t.answers])).toEqual([['T1', 'sharpened', ['Mostly through demos.']], ['T2', 'open', []]]);
  });

  const bundle = (reliesOn?: any[]): any => ({
    core: { goal: 'g', horizon: 'h', diagnosis: 'Nu știm încă dacă evaluarea plătită este obligatorie; programul de recuperare depinde de ce urmează după evaluare.', coreBet: { priority: 'Validezi întâi dacă evaluarea plătită este obligatorie și ce urmează după evaluare', deprioritized: 'd', whyOverAlternative: 'w', relationToGoal: '', relationToBottleneck: '', founderFit: '', resourceFit: '' },
      offerDirection: '', positioningDirection: '', audiencePrimaryForGoal: '', audienceRoles: [], founderConstraints: [], resourceEnvelope: [], assumptions: [{ statement: 's' }], tradeOffs: [], notNow: [{ item: 'i', reason: 'r' }], reconsiderTriggers: [{ condition: 'c' }], ...(reliesOn ? { reliesOn } : {}) },
    branch: { market: 'm', language: 'l', ctaDirection: 'c', channelPriorities: [] }, decisions: [],
  });
  const TEXT = 'Evaluarea plătită separat precede programul de recuperare; rămâne de aflat dacă este obligatorie și ce urmează după evaluare.';
  const ctx = (theses?: any[]): any => ({ business: [], founder: [{ ref: 'F1', kind: 'goal', statement: 'g' }], observation: [], ...(theses ? { theses: theses.map((t: any) => ({ text: TEXT, ...t })) } : {}) });
  const gate = (b: any, c: any, name: string) => validateStrategy(b, c).gateResults.find((g) => g.gate === name);

  it('passes when the core bet relies on an active thesis or founder evidence; fails without a trace, on a reversed thesis, or an unknown id', () => {
    const th = [{ id: 'T1', status: 'sharpened' }, { id: 'T2', status: 'reversed' }];
    expect(gate(bundle([{ component: 'coreBet', theses: ['T1'], founderRefs: [], relationshipUsed: 'evaluarea plătită obligatorie și ce urmează după evaluare' }]), ctx(th), 'thesis_trace')!.pass).toBe(true);
    expect(gate(bundle([{ component: 'coreBet', theses: [], founderRefs: ['F1'], relationshipUsed: 'evaluarea plătită obligatorie și ce urmează după evaluare' }]), ctx(th), 'thesis_trace')!.pass).toBe(true);
    expect(gate(bundle(), ctx(th), 'thesis_trace')!.pass).toBe(false);
    expect(gate(bundle([{ component: 'coreBet', theses: ['T2'], founderRefs: [], relationshipUsed: 'evaluarea plătită obligatorie și ce urmează după evaluare' }]), ctx(th), 'thesis_not_reversed')!.pass).toBe(false);
    expect(gate(bundle([{ component: 'coreBet', theses: ['T9'], founderRefs: [], relationshipUsed: 'evaluarea plătită obligatorie și ce urmează după evaluare' }]), ctx(th), 'thesis_known')!.pass).toBe(false);
    expect(gate(bundle(), ctx(), 'thesis_trace')).toBeUndefined(); // no theses given → no thesis gate (older flows unchanged)
  });

  it('strategy cannot silently abandon Understanding: a given, non-reversed thesis must be cited', () => {
    const th = [{ id: 'T1', status: 'unresolved' }];
    expect(gate(bundle([{ component: 'coreBet', theses: [], founderRefs: ['F1'], relationshipUsed: 'evaluarea plătită obligatorie și ce urmează după evaluare' }]), ctx(th), 'thesis_used')!.pass).toBe(false);
    expect(gate(bundle([{ component: 'coreBet', theses: [], founderRefs: ['F1'], relationshipUsed: 'evaluarea plătită obligatorie și ce urmează după evaluare' }, { component: 'diagnosis', theses: ['T1'], founderRefs: [], relationshipUsed: 'evaluarea plătită obligatorie și ce urmează după evaluare', use: 'validate' }]), ctx(th), 'thesis_used')!.pass).toBe(true);
    expect(gate(bundle([{ component: 'coreBet', theses: [], founderRefs: ['F1'], relationshipUsed: 'evaluarea plătită obligatorie și ce urmează după evaluare' }]), ctx([{ id: 'T1', status: 'reversed' }]), 'thesis_used')!.pass).toBe(true); // nothing citable
  });

  it('SEMANTIC RELEVANCE: a thesis cited by a choice that does not use it fails; a founder-evidence strategy states its deferral instead', () => {
    const th = [{ id: 'T1', status: 'unresolved' }];
    const off = (extra: any = {}) => { const b = bundle([{ component: 'coreBet', theses: ['T1'], founderRefs: ['F1'], use: 'validate', relationshipUsed: 'medici care trimit pacienți' }]); return { ...b, core: { ...b.core, coreBet: { ...b.core.coreBet, priority: 'Testezi dacă un medic trimite pacienți care revin' }, ...extra } }; };
    expect(gate(off(), ctx(th), 'thesis_relevance')!.pass).toBe(false);            // nearby in topic is not relying on it
    expect(gate(bundle([{ component: 'coreBet', theses: ['T1'], founderRefs: [], use: 'validate', relationshipUsed: 'dacă evaluarea plătită este obligatorie și ce urmează după evaluare' }]), ctx(th), 'thesis_relevance')!.pass).toBe(true);
    expect(gate(bundle([{ component: 'coreBet', theses: ['T1'], founderRefs: [], use: 'validate' }]), ctx(th), 'thesis_relevance')!.pass).toBe(false); // no relationshipUsed: a bare id is not a trace
    const founderOnly = (deferral?: string) => { const b = bundle([{ component: 'coreBet', theses: [], founderRefs: ['F1'] }]); return { ...b, core: { ...b.core, ...(deferral ? { thesisDeferral: deferral } : {}) } }; };
    expect(gate(founderOnly(), ctx(th), 'thesis_used')!.pass).toBe(false);
    expect(gate(founderOnly('First we validate the founder goal of medical referrals; the evaluation thesis stays open until then.'), ctx(th), 'thesis_used')!.pass).toBe(true);
  });

  it('STATUS CONTROLS USE: an unresolved / open thesis can only be validated; a weakened one cannot carry the core bet', () => {
    const th = [{ id: 'T1', status: 'unresolved' }, { id: 'T2', status: 'open' }, { id: 'T3', status: 'weakened' }, { id: 'T4', status: 'strengthened' }];
    const use = (component: string, id: string, u?: 'commit' | 'validate') => gate(bundle([{ component: 'coreBet', theses: ['T4'], founderRefs: [], relationshipUsed: 'evaluarea plătită obligatorie și ce urmează după evaluare' }, { component, theses: [id], founderRefs: [], ...(u ? { use: u } : {}) }]), ctx(th), 'thesis_status_use')!;
    expect(use('diagnosis', 'T1').pass).toBe(false);                 // committed by default → stated as established
    expect(use('diagnosis', 'T1').detail).toContain('may only VALIDATE or TEST');
    expect(use('diagnosis', 'T1', 'validate').pass).toBe(true);      // an investigation of it is fine
    expect(use('offerDirection', 'T2').pass).toBe(false);            // never asked = unresolved
    expect(use('coreBet', 'T3').pass).toBe(false);                   // weakened cannot carry the bet
    expect(use('notNow', 'T3').pass).toBe(true);                     // …but may inform a secondary choice
    expect(use('diagnosis', 'T4').pass).toBe(true);                  // strengthened may be committed to
  });

  it('no unsupported superlative or potential in the diagnosis or the core bet, unless the evidence makes the comparison', () => {
    const b = (diagnosis: string) => { const x = bundle([{ component: 'coreBet', theses: [], founderRefs: ['F1'], relationshipUsed: 'evaluarea plătită obligatorie și ce urmează după evaluare' }]); return { ...x, core: { ...x.core, diagnosis } }; };
    expect(gate(b('Recovery is the central bottleneck of the whole studio and everything depends on it.'), ctx([]), 'no_unsupported_superlative')!.pass).toBe(false);
    expect(gate(b('Kinetoterapia are cel mai mare potențial neexploatat din tot studioul, deci acolo merită investit.'), ctx([]), 'no_unsupported_superlative')!.pass).toBe(false);
    expect(gate(b('We do not yet know which line carries the business; the first month finds out by tracking every new client.'), ctx([]), 'no_unsupported_superlative')!.pass).toBe(true);
    expect(gate(b('Kinetoterapia este serviciul cu cel mai mult spațiu de creștere la Decebal, așa că pornim de acolo.'), ctx([]), 'no_unsupported_superlative')!.pass).toBe(false);
  });
});

// FINAL HARDENING (2026-10-16): founder evidence cannot create behaviour or causality; the mirror names open theses;
// interpretive strength never exceeds the evidence.
import { unsupportedBehaviourOrCause, overstated, inventedFact, omitUnsupportedSecondary, thirdPersonFinding } from '../../strategy/validation';
import { governReadUpdate } from '../../mirror/index';
import { escalationsIn } from '../../bi/index';

describe('strategy: founder evidence at its own strength', () => {
  const said = ['Decebal aduce venit mare din group training și masaj, mai puțin din kinetoterapie', 'activarea b2b medical si creșterea nr de clienți'];
  it('a cause or an actor\'s behaviour / awareness the founder did not state is refused; the founder fact itself passes', () => {
    expect(unsupportedBehaviourOrCause('Clienții de kinetoterapie nu caută singuri un studio. Merg unde îi trimite medicul.', said)).toBe('Clienții de kinetoterapie nu caută singuri un studio.');
    expect(unsupportedBehaviourOrCause('Medicii au pacienți, dar nu știu că exiști.', said)).toBeTruthy();
    expect(unsupportedBehaviourOrCause('Lipsa unui flux de trimiteri explică venitul mic.', said)).toBeTruthy();
    expect(unsupportedBehaviourOrCause('Kinetoterapia aduce mai puțin venit la Decebal decât group training și masaj.', said)).toBe('');
  });
  it('the same cause or behaviour framed as something to validate passes', () => {
    expect(unsupportedBehaviourOrCause('Testezi dacă medicii trimit pacienți care revin.', said)).toBe('');
    expect(unsupportedBehaviourOrCause('Nu știm încă de ce kinetoterapia aduce mai puțin.', said)).toBe('');
  });
});

describe('mirror: the open top theses are named, not dropped and not replaced', () => {
  it('anchored, both theses skipped, no anchored next → a deterministic line naming them', () => {
    const input: any = { businessName: 'N', interfaceLanguage: 'ro', synthesis: 'S', hypotheses: [{ interpretation: 'a' }, { interpretation: 'b' }], questions: [], goal: null, observed: [], business: [],
      exchanges: [{ asked: 'q1', answer: 'Decebal aduce mai puțin din kinetoterapie.' }, { asked: 'q2', answer: '(skip)' }, { asked: 'q3', answer: '(skip)' }],
      anchored: true, unresolved: [0, 1], headlines: ['Evaluarea: filtru sau barieră?', 'Gravida de azi poate fi clienta postpartum de mâine'] };
    const g = governReadUpdate({ hypotheses: [], fields: [{ field: 'now', text: 'Decebal aduce mai puțin din kinetoterapie decât din alte servicii.', answers: [0], evidence: ['F1'] }, { field: 'next', text: 'Aș privi masajul ca punct de intrare.', answers: [0], evidence: ['O1'] }] }, input)!;
    expect(g.read!.next).toBe('Rămân deschise: Evaluarea: filtru sau barieră; Gravida de azi poate fi clienta postpartum de mâine. Nu le folosesc ca bază pentru strategie până nu am răspunsul tău.');
    // even a model "next" that cites a thesis and shares words with it is replaced when every thesis is still open
    const drift = governReadUpdate({ hypotheses: [], fields: [{ field: 'now', text: 'Decebal aduce mai puțin din kinetoterapie decât din alte servicii.', answers: [0], evidence: ['F1'] }, { field: 'next', text: 'Aș privi masajul ca intrare pentru recuperare și filtru medical.', answers: [0], evidence: ['H0'] }] },
      { ...input, hypotheses: [{ interpretation: 'Evaluarea poate fi un filtru de intrare în recuperare.', question: 'q', unknown: 'u' }, { interpretation: 'b', question: 'q', unknown: 'u' }] })!;
    expect(drift.read!.next).toMatch(/^Rămân deschise:/);
  });
});

describe('interpretive strength', () => {
  it('certainty words are whole words and licensed only by the evidence', () => {
    expect(escalationsIn('Acest pas schimbă complet logica de conversie.')).toContain('complet$');
    expect(escalationsIn('Asta îmi completează imaginea.')).toEqual([]);
    expect(escalationsIn('A registry captures a high-intent moment.')).toContain('high-intent');
    expect(escalationsIn('Masajul este un motor de venit real.')).toContain('real$');
    expect(escalationsIn('În realitate, masajul vinde.')).toEqual([]);
  });
});

describe('strength and behaviour on every founder-facing strategy field', () => {
  it('a role assigned to an actor is behaviour unless framed as a test', () => {
    expect(unsupportedBehaviourOrCause('Medicii sunt referreri naturali pentru recuperare.', [])).toMatch(/Medicii/);
    expect(unsupportedBehaviourOrCause('Testezi dacă medicii pot trimite pacienți spre recuperare.', [])).toBe('');
  });
  it('an unlicensed superlative or comparison fails; a test or a founder echo passes', () => {
    expect(overstated('Masajul este cel mai clar traseu spre recuperare.', 'Masaj și kinetoterapie în două locații.', [])).toMatch(/cel mai/);
    expect(overstated('Grupurile sunt mai profitabile decât masajul.', 'Masaj și grupuri.', [])).toMatch(/decât/);
    expect(overstated('Verifici dacă masajul e cel mai clar traseu.', 'Masaj.', [])).toBe('');
    expect(overstated('Kinetoterapia aduce mai puțin decât masajul în Decebal.', 'Masaj.', ['Kinetoterapia aduce mai puțin decât masajul în Decebal.'])).toBe('');
    expect(overstated('Masajul are programări în ambele locații.', 'Masaj.', [])).toBe('');
  });
});

describe('replay of the saved Body Move output (2026-10-16) through the final checks', () => {
  const said = ['Bună Ziua aduce venit mare din pilates, balet adulți și masaj', 'Decebal aduce venit mare din group training și masaj, mai puțin din kinetoterapie', 'activarea b2b medical si creșterea nr de clienți pe toate serviciile'];
  const context = ['Studio de mișcare cu două locații: Bună Ziua și Decebal. Pilates, balet, masaj, kinetoterapie, group training.', ...said].join(' ');
  it('an absolute about a channel is a ranking ("niciun alt canal")', () => {
    expect(overstated('O conversație directă îți dă un răspuns real pe care niciun alt canal nu ți-l poate da acum.', context, said)).toBeTruthy();
    // an absolute is never licensed by test framing (2026-10-17): "the only way to test" still ranks every alternative out
    expect(overstated('Singurul mod de a testa dacă medicii trimit este să vorbești cu ei.', context, said)).toMatch(/singurul/);
    expect(overstated('Singurul canal care aduce pacienți este medicul.', context, said)).toMatch(/singurul/);
  });
  it('"poate" alone is not a hypothesis marker', () => {
    expect(overstated('Masajul este cel mai clar traseu și poate merge.', context, said)).toMatch(/cel mai/);
  });
  it('an ungrounded contrast is a comparison ("încredere pe care o reclamă nu îl are")', () => {
    expect(overstated('Recomandările nu costă și vin cu un nivel de încredere pe care o reclamă nu îl are.', context, said)).toBeTruthy();
  });
  it('an invented capacity fact fails; the founder facts pass', () => {
    expect(inventedFact('Decebal are capacitate pe kinetoterapie.', context, said)).toMatch(/capacity/);
    expect(inventedFact('Testezi dacă Decebal are capacitate pe kinetoterapie.', context, said)).toBe('');
    expect(inventedFact('Decebal aduce venit mare din group training și masaj.', context, said)).toBe('');
  });
  it('the whole saved bet "why" and channel copy now fail the gates', () => {
    const b: any = { core: { goal: 'g', horizon: 'h', diagnosis: 'Primul lucru de verificat este dacă medicii trimit.', coreBet: { priority: 'Testezi dacă medicii trimit pacienți.', deprioritized: 'Același mesaj pentru toți.', whyOverAlternative: 'Nu știi dacă funcționează până nu îl testezi.', relationToGoal: 'Testul este primul pas.', founderFit: 'Fondatorul a numit activarea medicală.', resourceFit: 'Decebal are capacitate pe kinetoterapie. Testul folosește ce există.', relationToBottleneck: '' }, offerDirection: 'Nu schimbi oferta acum.', positioningDirection: 'Studio cu kinetoterapeut.', audiencePrimaryForGoal: '', audienceRoles: [], founderConstraints: [], resourceEnvelope: [], assumptions: [], tradeOffs: [], notNow: [], reconsiderTriggers: [] },
      branch: { channelPriorities: [{ channel: 'Medici', whyGoal: 'Activare medicală.', whyAudience: 'O conversație directă îți dă un răspuns real pe care niciun alt canal nu ți-l poate da acum.', whyResource: 'Nu cere buget.', overAlternative: 'Recomandările vin cu un nivel de încredere pe care o reclamă nu îl are.', assumption: 'Medicii sunt deschiși.' }] }, decisions: [] };
    const v = validateStrategy(b, { business: [{ ref: 'B1', text: context }], founder: said.map((x, i) => ({ ref: `F${i + 1}`, kind: 'resource', statement: x })), observation: [] } as any);
    const failed = v.failures.map((f) => `${f.gate}:${f.component}`);
    expect(failed).toContain('no_invented_fact:coreBet');
    expect(failed).toContain('no_unsupported_strength:channelPriorities');
    expect(v.failures.filter((f) => f.gate === 'no_unsupported_strength').map((f) => f.detail).join(' ')).toMatch(/niciun alt/);
  });
  it('the saved mirror NOW keeps the facts and loses the dominance / absence interpretation', () => {
    const input: any = { businessName: 'N', interfaceLanguage: 'ro', synthesis: 'S', hypotheses: [{ interpretation: 'a' }, { interpretation: 'b' }], questions: [], goal: said[2], observed: [], business: [],
      exchanges: [{ asked: 'q1', answer: 'fiecare locație aduce venit mare din diferite servicii, buna ziua din pilates balet pt adulți si masaj iar Decebal din group training si masaj, mai puțin din kinetoterapie' }, { asked: 'q2', answer: '(skip)' }, { asked: 'q3', answer: '(skip)' }],
      anchored: true, unresolved: [0, 1], headlines: ['Evaluarea: filtru sau barieră', 'Gravida de azi poate fi clienta postpartum de mâine'] };
    const g = governReadUpdate({ hypotheses: [], fields: [{ field: 'now', text: 'Cele două locații au motoare de venit diferite: Bună Ziua rulează pe pilates, balet adulți și masaj, iar Decebal pe group training și masaj, cu kinetoterapia contribuind mai puțin la venitul locației Decebal. Kinetoterapia rămâne prezentă ca serviciu la Decebal, dar nu este un motor de venit principal în niciuna dintre locații.', answers: [0], evidence: ['F1'] }] }, input)!;
    expect(g.read!.now).not.toMatch(/motor|niciuna|principal/);
    expect(g.read!.now).toMatch(/^Bună Ziua rulează pe pilates/);
    expect(g.read!.now).toMatch(/Kinetoterapia rămâne prezentă ca serviciu la Decebal\.$/);
    expect(g.read!.next).toMatch(/^Rămân deschise:/);
  });
});

describe('replay of the 2026-10-16 21:08 Body Move strategy through the final checks', () => {
  const said = ['Bună Ziua aduce venit mare din pilates, balet adulți și masaj', 'Decebal aduce venit mare din group training și masaj, mai puțin din kinetoterapie', 'activarea b2b medical si creșterea nr de clienți pe toate serviciile'];
  const context = ['Studio de mișcare cu două locații: Bună Ziua și Decebal. Pilates, balet, masaj, kinetoterapie, group training.', ...said].join(' ');
  it('an absolute inside a sentence that also names a test still fails', () => {
    expect(overstated('Kinetoterapia de la Decebal este serviciul pe care îl testezi cu medicii, pentru că este singurul serviciu de recuperare medicală pe care îl ai acum și care se potrivește direct cu obiectivul b2b.', context, said)).toMatch(/singurul/);
    expect(overstated('Obiectivul este activarea b2b medical. Singurul mod de a testa dacă medicii trimit este să mergi la ei direct.', context, said)).toMatch(/singurul/);
  });
  it('sharing topic words with the founder no longer licenses a ranking or a mental state', () => {
    const s = 'Clienții actuali de la Bună Ziua, care vin deja la pilates, balet adulți sau masaj, sunt cei mai potriviți să recomande altor femei din Cluj cu interese similare de mișcare și wellness.';
    expect(overstated(s, context, said)).toMatch(/cei mai/);
    expect(unsupportedBehaviourOrCause(s, said)).toBeTruthy();
    expect(unsupportedBehaviourOrCause('Ei știu exact ce primesc și pot vorbi concret despre experiență.', said)).toBeTruthy();
  });
  it('a claim followed by a test is still a claim (test framing is local to its clause)', () => {
    expect(unsupportedBehaviourOrCause('Medicii sunt un drum direct spre pacienții care au nevoie de recuperare, iar testul acesta îți spune rapid dacă această cale există înainte să investești timp în altceva.', said, true)).toMatch(/^Medicii sunt/);
    expect(unsupportedBehaviourOrCause('Testezi dacă medicii din Cluj trimit pacienți la kinetoterapie la Decebal, și construiești un sistem simplu prin care să o facă constant.', said)).toBe('');
  });
  it('trust people already hold is a mental-state claim', () => {
    expect(unsupportedBehaviourOrCause('Față de publicitate plătită, recomandările vin cu încredere deja construită și cost zero.', said, true)).toBeTruthy();
    expect(unsupportedBehaviourOrCause('Testezi dacă recomandările vin cu încredere deja construită.', said, true)).toBe('');
  });
  it('the founder facts themselves still pass', () => {
    for (const s of ['Bună Ziua aduce venit mare din pilates, balet adulți și masaj.', 'Decebal aduce venit mare din group training și masaj, mai puțin din kinetoterapie.']) {
      expect(overstated(s, context, said)).toBe('');
      expect(inventedFact(s, context, said)).toBe('');
      expect(unsupportedBehaviourOrCause(s, said)).toBe('');
    }
  });
});

describe('final pass: mental states, readable repair feedback, secondary-copy fallback', () => {
  const said = ['Bună Ziua aduce venit mare din pilates, balet adulți și masaj', 'Decebal aduce venit mare din group training și masaj, mai puțin din kinetoterapie', 'activarea b2b medical si creșterea nr de clienți pe toate serviciile'];
  const context = ['Studio de mișcare cu două locații: Bună Ziua și Decebal. Pilates, balet, masaj, kinetoterapie, group training.', ...said].join(' ');
  it('what an actor wants, knows, trusts or does is behaviour, whatever the verb', () => {
    expect(unsupportedBehaviourOrCause('Medicii nu caută studiouri pe Instagram.', said, true)).toBeTruthy();
    expect(unsupportedBehaviourOrCause('Un medic vrea să știe că pacientul e pe mâini bune.', said, true)).toBeTruthy();
    expect(unsupportedBehaviourOrCause('Recomandările vin de la oameni care au deja încredere.', said, true)).toBeTruthy();
    expect(unsupportedBehaviourOrCause('Patients expect a follow-up call.', [], true)).toBeTruthy();
    // allowed: a test of the plan, an actor that is not the subject, the founder's own goal
    expect(unsupportedBehaviourOrCause('Testăm dacă medicii pot deveni o sursă de trimiteri.', said)).toBe('');
    expect(unsupportedBehaviourOrCause('Față de medici, te prezinți ca studio cu kinetoterapeut.', said)).toBe('');
    expect(unsupportedBehaviourOrCause('Activarea medicală este obiectivul pe care l-ai numit.', said)).toBe('');
  });
  const bundle = (whyOver: string, whyAudience: string): any => ({ core: { goal: 'g', horizon: 'h', diagnosis: 'Primul lucru de verificat este dacă medicii trimit.', coreBet: { priority: 'Testezi dacă medicii trimit pacienți la kinetoterapie.', deprioritized: 'Același mesaj pentru toți.', whyOverAlternative: whyOver, relationToGoal: 'Testul este primul pas spre activarea medicală.', founderFit: 'Ai numit activarea medicală.', resourceFit: 'Nu cere buget.', relationToBottleneck: '' }, offerDirection: 'Nu schimbi oferta acum.', positioningDirection: 'Studio cu kinetoterapeut.', audiencePrimaryForGoal: '', audienceRoles: [], founderConstraints: [], resourceEnvelope: [], assumptions: [], tradeOffs: [], notNow: [{ item: 'Reclame', reason: 'Întâi testul.' }], reconsiderTriggers: [] },
    branch: { channelPriorities: [{ channel: 'Medici', whyGoal: 'Servește activarea medicală.', whyAudience, whyResource: 'Nu cere buget.', overAlternative: 'Alternativele așteaptă testul.', assumption: 'Medicii sunt deschiși.' }] }, decisions: [] });
  const ctx: any = { business: [{ ref: 'B1', text: context }], founder: said.map((x, i) => ({ ref: `F${i + 1}`, kind: 'resource', statement: x })), observation: [] };
  it('the repair gets the exact sentence, a plain reason and the allowed correction, never an internal marker', () => {
    const v = validateStrategy(bundle('Afli dacă medicii trimit. Există un drum real acolo.', 'Medicii nu caută studiouri pe Instagram.'), ctx);
    const details = v.failures.map((f) => f.detail).join('\n');
    expect(details).toContain('OFFENDING: "Există un drum real acolo."');
    expect(details).toMatch(/REASON: "real" adds certainty/);
    expect(details).toContain('REPAIR:');
    expect(details).not.toMatch(/\$/);
    expect(details).toContain('OFFENDING: "Medicii nu caută studiouri pe Instagram."');
  });
  it('one bad secondary sentence is omitted, the strategy then passes; the central choice is never rewritten', () => {
    const b = bundle('Afli dacă medicii trimit. Există un drum real acolo.', 'Medicii nu caută studiouri pe Instagram.');
    const s = omitUnsupportedSecondary(b, ctx, 'ro');
    expect(s.omitted).toEqual(['coreBet.whyOverAlternative: Există un drum real acolo.', 'channel[0].whyAudience: Medicii nu caută studiouri pe Instagram.']);
    expect(s.bundle.core.coreBet.whyOverAlternative).toBe('Afli dacă medicii trimit.');
    expect(s.bundle.core.coreBet.priority).toBe(b.core.coreBet.priority);
    expect(validateStrategy(s.bundle, ctx).failures.filter((f) => /^no_(unsupported|invented)/.test(f.gate))).toEqual([]);
    // a required field left empty gets a minimal neutral line
    expect(omitUnsupportedSecondary(bundle('Există un drum real acolo.', ''), ctx, 'ro').bundle.core.coreBet.whyOverAlternative).toMatch(/^Pornește de la obiectivul tău/);
    // a bad diagnosis stays blocking
    const bad = bundle('Afli dacă medicii trimit.', '');
    bad.core.diagnosis = 'Medicii nu știu de tine.';
    expect(validateStrategy(omitUnsupportedSecondary(bad, ctx, 'ro').bundle, ctx).failures.map((f) => `${f.gate}:${f.component}`)).toContain('no_unsupported_behaviour:diagnosis');
  });
});

describe('replay of the 2026-10-17 Body Move strategy through the final checks', () => {
  const said = ['Bună Ziua aduce venit mare din pilates, balet adulți și masaj', 'Decebal aduce venit mare din group training și masaj, mai puțin din kinetoterapie', 'activarea b2b medical si creșterea nr de clienți pe toate serviciile'];
  const context = ['Studio de mișcare cu două locații: Bună Ziua și Decebal. Pilates, balet, masaj, kinetoterapie, group training. Echipa completă a locației Decebal nu este listată.', ...said].join(' ');
  it('a ranked method is an absolute even inside a test clause', () => {
    expect(overstated('Activarea medicală este obiectivul explicit. Contactul direct este cel mai rapid mod de a testa dacă medicii trimit pacienți.', context, said)).toMatch(/cel mai rapid mod/);
    expect(overstated('Calling them is the fastest way to test whether doctors refer.', context, said)).toMatch(/fastest way/);
    expect(overstated('Contactul direct testează dacă medicii trimit pacienți.', context, said)).toBe('');
  });
  it('a team, space or label the founder never stated is an invented resource', () => {
    expect(inventedFact('Tu ai deja echipa și spațiul. Nu ai nevoie de resurse noi ca să faci primele contacte cu medicii.', context, said)).toMatch(/resource/);
    expect(inventedFact('Către clienții de clase, ești studioul cu echipă multidisciplinară și două locații în Cluj.', context, said)).toMatch(/multidisciplinar/);
    expect(inventedFact('Verifici cine din echipă are timp pentru primele contacte.', context, said)).toBe('');
    expect(inventedFact('Ai echipa la Decebal.', context, [...said, 'am o echipă de 4 kinetoterapeuți la Decebal'])).toBe('');
  });
  it('"completă" needs the same phrase in the evidence, not the word anywhere', () => {
    expect(overstated('Nu lansezi servicii noi acum. Ai deja o ofertă completă în ambele locații și prioritatea este să umpli ce există, nu să adaugi.', context, said)).toMatch(/completă/);
    expect(overstated('Echipa completă a locației Decebal nu este listată.', context, said)).toBe('');
  });
  it('a quantity the plan aims at, or an unknown, is not a behaviour claim; what people know or need still is', () => {
    expect(unsupportedBehaviourOrCause('Obiectivul declarat este activarea medicală și mai mulți clienți pe toate serviciile.', said, true)).toBe('');
    expect(unsupportedBehaviourOrCause('Fără să știi de unde vin clienții noi, conținutul consumă timp fără să îți spună nimic util.', said, true)).toBe('');
    expect(unsupportedBehaviourOrCause('Față de clienții de clase și masaj, rămâi studioul de mișcare și wellbeing pe care îl știu deja.', said)).toBeTruthy();
    expect(unsupportedBehaviourOrCause('Medicii au nevoie să audă despre protocol, evaluare și recuperare.', said, true)).toBeTruthy();
  });
  it('a channel that is not a test gets a fallback that does not mention a test', () => {
    const b: any = { core: { goal: 'g', horizon: 'h', diagnosis: 'd', coreBet: { priority: 'p', deprioritized: 'x', whyOverAlternative: 'w', relationToGoal: '', founderFit: '', resourceFit: '', relationToBottleneck: '' }, offerDirection: '', positioningDirection: '', audiencePrimaryForGoal: '', audienceRoles: [], founderConstraints: [], resourceEnvelope: [], assumptions: [], tradeOffs: [], notNow: [], reconsiderTriggers: [] },
      branch: { channelPriorities: [{ channel: 'Recomandări de la clienții actuali', whyGoal: 'Crești numărul de clienți.', whyAudience: '', whyResource: 'Clienții actuali știu deja ce oferi.', overAlternative: 'Față de conținut pe social media, recomandarea directă aduce un client care vine deja cu încredere.', assumption: 'a' }] }, decisions: [] };
    const out = omitUnsupportedSecondary(b, { business: [{ ref: 'B1', text: context }], founder: said.map((x, i) => ({ ref: `F${i + 1}`, kind: 'resource', statement: x })), observation: [] } as any, 'ro');
    const ch = out.bundle.branch!.channelPriorities[0]!;
    expect(ch.overAlternative).not.toMatch(/test/i);
    expect(ch.whyResource).not.toMatch(/test/i);
  });
});

describe('replay of the 2026-10-17 prod strategy (launch-stability pass)', () => {
  const said = ['Bună Ziua aduce venit mare din pilates, balet adulți și masaj', 'Decebal aduce venit mare din group training și masaj, mai puțin din kinetoterapie', 'activarea b2b medical si creșterea nr de clienți pe toate serviciile'];
  const context = ['Studio de mișcare cu două locații: Bună Ziua și Decebal. Pilates, balet, masaj, kinetoterapie, group training.', ...said].join(' ');
  it('whether ads run or work is a fact the evidence must hold', () => {
    expect(inventedFact('Clasele și masajul merg deja bine fără reclame.', context, said)).toMatch(/advertising/);
    expect(inventedFact('Testezi dacă reclamele funcționează pentru kinetoterapie.', context, said)).toBe('');
    expect(inventedFact('Clasele merg deja bine fără reclame.', `${context} Nu facem reclame plătite.`, said)).toBe('');
    expect(inventedFact('Lasă reclamele pentru kinetoterapie deoparte deocamdată.', context, said)).toBe(''); // a recommendation, not a claim
  });
  it('"what an ad cannot do" is an unsupported comparison', () => {
    expect(overstated('Pentru kinetoterapie, testezi dacă o conversație directă cu un medic construiește un flux de trimiteri, ceea ce o reclamă pe Instagram nu poate face în același mod.', context, said)).toMatch(/compares/);
    expect(overstated('Contactul direct cu medicii este primul lucru de testat.', context, said)).toBe('');
  });
  it('founder-facing copy speaks to the founder, never about them', () => {
    expect(thirdPersonFinding('Fondatoarea vrea activare medicală B2B, iar kinetoterapia este serviciul legat de obiectiv.')?.reason).toMatch(/third person/);
    expect(thirdPersonFinding('The founder named medical activation.')).toBeTruthy();
    expect(thirdPersonFinding('Ai numit activarea medicală ca obiectiv.')).toBeNull();
  });
});
