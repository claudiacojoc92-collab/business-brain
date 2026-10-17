/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { consequenceLine, continuationWording, governProjection, inventedThreshold, myReadCoverage, projectionInput, relationshipHeadline, soften, thesisConsequence, tidyFounderCopy, unknownLine, type ThesisInput, type ThesisRecord } from '../../arc/index';

// FOUNDER PROJECTION (2026-10-17): MY READ → WHAT I THINK MATTERS → QUESTIONS as one chain over the top theses.
const input: ThesisInput = {
  businessName: 'Studio', language: 'ro', synthesis: '', hypotheses: [], unknowns: [], notConcluding: [],
  facts: [
    { ref: 'F1', text: 'Stated by the business: Abonamente de 4, 8 și 12 ședințe.' },
    { ref: 'F2', text: 'Stated by the business: Evaluare Kinetoterapeutică 200 lei, obligatorie înainte de abonamentul clinic.' },
    { ref: 'F3', text: 'Stated by the business: Gimnastică Prenatală.' },
    { ref: 'F4', text: 'Stated by the business: Recuperare Postpartum Individuală, cu evaluare postpartum.' },
    { ref: 'F5', text: 'Kinetoterapia apare la locația Decebal, nu la Bună Ziua.' },
  ],
};
const T = (id: string, o: any) => ({ id, facts: ['F1', 'F2'], decisions: ['retention'], ifTrue: 'x', weakenedBy: 'w', questionWhy: 'q', dimensions: ['retention'], priority: 1, founder: { headline: '', body: '', refs: [] }, eligibility: { pass: true, reasons: [], observationOnly: false }, ...o });
const record: ThesisRecord = {
  snapshotId: 's', businessModel: { motions: [{ name: 'Evaluare plătită apoi abonament clinic', entry: ['organic_inbound'], buying: ['assessment'], continuation: ['package'], refs: ['F2'] }], offerRoles: [], decisionPoints: [] },
  theses: [
    T('T4', { headline: 'Traseul prenatal spre postpartum este o continuitate de client', relationship: 'Gimnastica prenatală și recuperarea postpartum apar secvențial la același client.', implication: 'Continuitate posibilă.', decisions: ['retention', 'customer_journey'], unknown: 'Câte clientele postpartum au trecut prin prenatal.', question: 'Dintre clientele postpartum, câte au fost la prenatal?', facts: ['F3', 'F4'] }),
    T('T1', { headline: 'Evaluarea plătită este intrarea în traseul clinic', relationship: 'Evaluarea de 200 lei este obligatorie înainte de abonamentul clinic.', implication: 'Un punct de decizie distinct.', decisions: ['conversion', 'customer_journey'], unknown: 'Câți cumpără abonament după evaluare.', question: 'Din 10 clienți care plătesc evaluarea, câți cumpără un abonament în următoarele două săptămâni?', facts: ['F2'] }),
    T('T2', { headline: 'Cele două locații pot servi segmente diferite', relationship: 'Kinetoterapia lipsește de la Bună Ziua.', implication: 'Segmente diferite.', decisions: ['acquisition'], unknown: 'Motivul.', question: 'De ce lipsește kinetoterapia de la Bună Ziua?', facts: ['F5'] }),
  ] as any,
  top: ['T4', 'T1'],
  questions: [
    { question: 'Care servicii aduc cei mai mulți clienți activi?', why: '', tier: 'A', dimension: 'performance' },
    { question: 'Dintre clientele postpartum, câte au fost la prenatal?', why: 'w', tier: 'B', resolves: 'T4' },
    { question: 'Din 10 clienți care plătesc evaluarea, câți cumpără un abonament în următoarele două săptămâni?', why: 'w', tier: 'B', resolves: 'T1' },
  ],
  // the live stored copy (2026-10-17): MY READ about locations, matters with invented effects, a customer action as the founder's
  founder: {
    myRead: 'Abonamentele de 4, 8 și 12 ședințe sunt mecanismul de continuare vizibil. Cele două locații nu au același portofoliu, ceea ce sugerează profiluri de client diferite.',
    matters: [
      { thesisId: 'T4', headline: 'Clienții prenatali devin clienți postpartum?', body: 'Oferta ta acoperă două momente consecutive din viața aceluiași client: sarcina și perioada de după naștere. Dacă clienții trec natural de la unul la altul, ai un traseu de retenție cu cost de achiziție mic.' },
      { thesisId: 'T1', headline: 'Evaluarea filtrează sau blochează clienții?', body: 'Plătești 200 lei înainte de orice abonament clinic. Poate și opri clienți care ar fi continuat dacă intrarea era mai ușoară.' },
    ],
  },
  dropped: [],
};
const GOOD = {
  myRead: [
    { text: 'Studioul are mai multe mecanisme de continuare: abonamente de ședințe și un traseu clinic care începe cu o evaluare plătită.', refs: ['F1', 'F2', 'T1'] },
    { text: 'Gimnastica prenatală și recuperarea postpartum par să formeze un traseu posibil pentru aceeași clientă.', refs: ['F3', 'F4', 'T4'] },
  ],
  matters: [
    { thesisId: 'T4', headline: 'Prenatal și postpartum: un singur traseu?', relationship: 'Oferta acoperă sarcina și perioada de după naștere, două momente consecutive.', domains: 'Dacă trecerea dintre ele are loc, asta ar schimba cum gândești retenția, cross-sell-ul și parcursul clientei.', unknown: 'Nu știu încă dacă clientele trec de la un program la celălalt.' },
    { thesisId: 'T1', headline: 'Evaluarea: ce urmează după ea?', relationship: 'Evaluarea de 200 lei este obligatorie înainte de abonamentul clinic.', domains: 'Ce se întâmplă după evaluare ar schimba cum citești conversia și parcursul clinic.', unknown: 'Nu știu încă ce se întâmplă după evaluare: cine continuă și cine nu.' },
  ],
  questions: [
    { thesisId: 'T4', question: 'Dintre clientele de recuperare postpartum, câte au făcut și gimnastică prenatală la voi?' },
    { thesisId: 'T1', question: 'După evaluare, clienții continuă de obicei cu un abonament sau se opresc acolo?' },
  ],
};

describe('the deterministic chain lines (per content language)', () => {
  it('name the areas and say what Business Brain does not know yet', () => {
    expect(consequenceLine(['retention', 'customer_journey', 'positioning'] as any, 'ro')).toBe('Dacă legătura există în practică, asta ar schimba cum gândești retenția, parcursul clientului și poziționarea.');
    expect(consequenceLine(['conversion'] as any, 'en')).toBe('If this link exists in practice, it would change how you think about conversion.');
    expect(unknownLine('Câți clienți cumpără abonament după evaluare.', 'ro')).toBe('Nu știu încă: câți clienți cumpără abonament după evaluare.');
  });
});

describe('founder projection: one reasoning chain over the top theses', () => {
  it('the input carries only the top theses, in rank order', () => {
    expect(projectionInput(record, input).theses.map((t) => t.id)).toEqual(['T4', 'T1']);
  });
  it('a clean projection replaces MY READ, MATTERS (relationship → areas → unknown) and the thesis questions', () => {
    const r = governProjection(GOOD as any, record, input);
    expect(r.founder.myRead).toBe(`${GOOD.myRead[0]!.text} ${GOOD.myRead[1]!.text}`);
    expect(r.founder.matters.map((m) => m.thesisId)).toEqual(['T4', 'T1']);
    // T4 is a continuity thesis: its consequence is always the lifecycle line (retention, expansion, journey, positioning)
    expect(r.founder.matters[0]!.body).toBe(`${GOOD.matters[0]!.relationship} Dacă legătura există în practică, asta ar schimba cum gândești retenția, extinderea relației cu clientul, parcursul clientului și poziționarea. ${GOOD.matters[0]!.unknown}`);
    expect(r.founder.matters[1]!.body).toBe(`${GOOD.matters[1]!.relationship} ${GOOD.matters[1]!.domains} ${GOOD.matters[1]!.unknown}`);
    expect(r.questions.map((q) => q.question)).toEqual(['Care familii de servicii aduc azi cei mai mulți clienți activi și cel mai mult venit lunar?', GOOD.questions[0]!.question, GOOD.questions[1]!.question]);
  });
  it('MY READ about a lower-ranked insight (the locations) never stands: it must read through every top thesis', () => {
    const r = governProjection(null, record, input);
    expect(r.founder.myRead).toBe('');
    expect(r.dropped.some((d) => d.reason === 'does not read through every top thesis')).toBe(true);
  });
  it('invented effects, economics and behaviour are refused; the consequence names areas and stays conditional', () => {
    const bad = { ...GOOD, matters: [
      { ...GOOD.matters[0]!, domains: 'Dacă trec, ai un traseu de retenție cu cost de achiziție mic.' },          // economics
      { ...GOOD.matters[1]!, relationship: 'Evaluarea selectează clienți serioși și protejează timpul specialistului.' }, // behaviour/effect
    ] };
    const r = governProjection(bad as any, record, input);
    expect(r.dropped.filter((d) => /^projection T[14]$/.test(d.part)).map((d) => d.reason)).toEqual(['incomplete after checks: the stored copy is used', 'incomplete after checks: the stored copy is used']);
    expect(r.dropped.find((d) => d.part === 'projection T4 consequence')?.reason).toMatch(/economics nobody stated/);
    expect(r.dropped.find((d) => d.part === 'projection T1 relationship')?.reason).toMatch(/an effect nobody established/);
    // the deterministic chain takes over: governed relationship → fixed consequence over the thesis's areas → BB's unknown
    const t4 = r.founder.matters.find((m) => m.thesisId === 'T4')!;
    expect(t4.body).toBe('Oferta acoperă sarcina și perioada de după naștere, două momente consecutive. Dacă legătura există în practică, asta ar schimba cum gândești retenția, extinderea relației cu clientul, parcursul clientului și poziționarea. Nu știu încă: câte clientele postpartum au trecut prin prenatal.');
    expect(r.founder.matters.map((m) => m.body).join(' ')).not.toMatch(/Plătești|cost de achiziție|serioși/);
    const outcome = governProjection({ ...GOOD, matters: [{ ...GOOD.matters[0]!, domains: 'Retenția și cross-sell-ul s-au schimbat deja.' }, GOOD.matters[1]!] } as any, record, input);
    expect(outcome.dropped.some((d) => d.reason === 'names no decision area, or states the consequence as already true')).toBe(true);
  });
  it('a recommendation is not a relationship (above the solution)', () => {
    const r = governProjection({ ...GOOD, matters: [{ ...GOOD.matters[0]!, relationship: 'Ar trebui să le combini într-un singur pachet.' }, GOOD.matters[1]!] } as any, record, input);
    expect(r.dropped.some((d) => /a recommendation, not the relationship/.test(d.reason))).toBe(true);
  });
  it('questions never invent a sample size, a time window or a percentage', () => {
    const src = input.facts.map((f) => f.text).join(' ');
    expect(inventedThreshold('Din 10 clienți care plătesc evaluarea, câți cumpără un abonament în următoarele două săptămâni?', src)).toMatch(/number nobody stated \(10\)|threshold/);
    expect(inventedThreshold('Câți cumpără un abonament în următoarele două săptămâni?', src)).toMatch(/în următoarele două săptămâni/);
    expect(inventedThreshold('Cam 30% dintre clienți revin?', src)).toMatch(/30/);
    expect(inventedThreshold('După evaluare, clienții continuă de obicei cu un abonament sau se opresc acolo?', src)).toBe('');
    // the stored threshold question is dropped when the projection gives none
    const r = governProjection({ ...GOOD, questions: [GOOD.questions[0]!] } as any, record, input);
    expect(r.questions.some((q) => /Din 10/.test(q.question))).toBe(false);
  });
});

describe('live re-projection regressions (2026-10-17)', () => {
  it('"if it is real" is a condition; BB\'s own "I don\'t know" opening a sentence is an unknown, not a claim about customers', () => {
    const out: any = { ...GOOD, matters: [
      { ...GOOD.matters[0]!, domains: 'Dacă relația este reală, asta ar schimba parcursul clientului și arhitectura ofertei.', unknown: 'Nu știu câți dintre clienții de recuperare postpartum au trecut prin prenatal.' },
      GOOD.matters[1]!,
    ] };
    const r = governProjection(out, record, input);
    expect(r.founder.matters[0]!.body).toBe(`${GOOD.matters[0]!.relationship} Dacă legătura există în practică, asta ar schimba cum gândești retenția, extinderea relației cu clientul, parcursul clientului și poziționarea. Nu știu câți dintre clienții de recuperare postpartum au trecut prin prenatal.`);
  });
  it('"pași plătiți" (paid steps) is not the founder paying', () => {
    const out: any = { ...GOOD, matters: [GOOD.matters[0]!, { ...GOOD.matters[1]!, relationship: 'Evaluările sunt pași plătiți, obligatorii înainte de abonamentul clinic.' }] };
    expect(governProjection(out, record, input).founder.matters[1]!.body).toMatch(/^Evaluările sunt pași plătiți/);
  });
});

describe('MY READ covers every top thesis by its DISTINCTIVE terms (2026-10-17)', () => {
  const top = record.top.map((id) => record.theses.find((t) => t.id === id)!);
  it('generic words (studio, traseu, client) never count; the relationship itself must be named', () => {
    const generic = myReadCoverage(['Studioul tău are mai multe servicii și oferte pentru clienți, pe mai multe trasee.'], top);
    expect(generic.map((c) => c.sentence)).toEqual([null, null]);
    const both = myReadCoverage([
      'Gimnastica prenatală și recuperarea postpartum pot forma un singur parcurs pentru aceeași persoană.',
      'Abonamentul clinic începe cu o evaluare de 200 lei, obligatorie înainte de abonament.',
    ], top);
    expect(both.map((c) => c.sentence !== null)).toEqual([true, true]);
    expect(both[0]!.matched.length).toBeGreaterThanOrEqual(2);
  });
  it('a MY READ that names only one thesis is refused; the lifecycle stays a possibility, never stated behaviour', () => {
    const oneSided = governProjection({ ...GOOD, myRead: [{ text: 'Abonamentul clinic începe cu o evaluare de 200 lei, obligatorie înainte de abonament.', refs: ['F2'] }] } as any, record, input);
    expect(oneSided.founder.myRead).toBe('');
    const behaviour = governProjection({ ...GOOD, myRead: [
      { text: 'Clientele trec de la gimnastica prenatală la recuperarea postpartum.', refs: ['F3', 'F4'] },
      { text: 'Abonamentul clinic începe cu o evaluare de 200 lei, obligatorie înainte de abonament.', refs: ['F2'] },
    ] } as any, record, input);
    expect(behaviour.founder.myRead).toBe('');
    const possible = governProjection({ ...GOOD, myRead: [
      { text: 'Gimnastica prenatală și recuperarea postpartum pot forma un singur parcurs pentru aceeași persoană.', refs: ['F3', 'F4'] },
      { text: 'Abonamentul clinic începe cu o evaluare de 200 lei, obligatorie înainte de abonament.', refs: ['F2'] },
    ] } as any, record, input);
    expect(possible.founder.myRead).toMatch(/^Gimnastica prenatală și recuperarea postpartum pot forma/);
  });
  it('benchmark words are thresholds too', () => {
    const r = governProjection({ ...GOOD, matters: [GOOD.matters[0]!, { ...GOOD.matters[1]!, domains: 'Dacă aproape toți cei care evaluează continuă, asta ar schimba cum gândești conversia.' }] } as any, record, input);
    expect(r.dropped.some((d) => /a benchmark nobody stated \("aproape toți"\)/.test(d.reason))).toBe(true);
    expect(inventedThreshold('Majoritatea celor care plătesc evaluarea continuă?', '')).toMatch(/Majoritatea/);
  });
});

describe('offline re-governance fixes (2026-10-17)', () => {
  it('the Romanian adjective "separate" is not the English verb "separates"', () => {
    const r = governProjection({ ...GOOD, matters: [{ ...GOOD.matters[0]!, relationship: 'Studioul oferă gimnastică prenatală și recuperare postpartum ca servicii separate.' }, GOOD.matters[1]!] } as any, record, input);
    expect(r.founder.matters[0]!.body).toMatch(/^Studioul oferă gimnastică prenatală și recuperare postpartum ca servicii separate\./);
    const verb = governProjection({ ...GOOD, matters: [{ ...GOOD.matters[0]!, relationship: 'The paid step separates committed clients from the curious.' }, GOOD.matters[1]!] } as any, record, input);
    expect(verb.dropped.some((d) => /an effect nobody established \("separates"\)/.test(d.reason))).toBe(true);
  });
  it('the chain keeps the stored governed relationship (two successive stages) when the projected one is refused', () => {
    const r = governProjection({ ...GOOD, matters: [{ ...GOOD.matters[0]!, relationship: 'Clientele trec natural de la prenatal la postpartum, ceea ce înseamnă retenție.' }, GOOD.matters[1]!] } as any, record, input);
    expect(r.founder.matters[0]!.body).toMatch(/^Oferta ta acoperă două momente consecutive din viața aceluiași client: sarcina și perioada de după naștere\. Dacă legătura există în practică/);
    expect(r.founder.matters[0]!.body).not.toMatch(/trec natural/);
  });
  it('MY READ: once both theses are covered, a conditional sentence is left out and nothing goes past two sentences', () => {
    const both = 'Evaluarea de 200 lei este obligatorie înainte de abonamentul clinic, iar gimnastica prenatală și recuperarea postpartum pot forma un traseu.';
    const r = governProjection({ ...GOOD, myRead: [
      { text: both, refs: ['F2', 'F3', 'F4'] },
      { text: 'Dacă traseul este real, cele două intrări pot servi oameni diferiți.', refs: ['F2'] },
      { text: 'Abonamentele de 4, 8 și 12 ședințe pot continua relația după prima vizită.', refs: ['F1'] },
    ] } as any, record, input);
    expect(r.founder.myRead).toBe(both);
    expect(r.dropped.find((d) => d.text.startsWith('Dacă traseul este real'))?.reason).toBe('a new speculative reading, not needed to cover a top thesis');
  });
});

describe('final founder-copy polish (2026-10-17)', () => {
  it('a continuity thesis names retention, expansion, the journey and positioning, never acquisition in their place', () => {
    expect(thesisConsequence({ decisions: ['retention', 'customer_journey', 'acquisition', 'offer_design'] } as any, 'ro'))
      .toBe('Dacă legătura există în practică, asta ar schimba cum gândești retenția, extinderea relației cu clientul, parcursul clientului și poziționarea.');
    expect(thesisConsequence({ decisions: ['conversion', 'offer_design'] } as any, 'en')).toBe('If this link exists in practice, it would change how you think about conversion and offer architecture.');
  });
  it('a fork of two effects becomes the relationship headline; an open fork without effects stays', () => {
    expect(relationshipHeadline('Evaluarea de 200 lei: poartă de intrare sau obstacol?', { decisions: ['conversion'] } as any, 'ro')).toBe('Evaluarea de 200 lei schimbă parcursul de cumpărare');
    expect(relationshipHeadline('The paid assessment: filter or barrier?', { decisions: ['conversion'] } as any, 'en')).toBe('The paid assessment changes the buying path');
    expect(relationshipHeadline('Prenatal și postpartum: un traseu sau două achiziții?', { decisions: ['retention'] } as any, 'ro')).toBe('Prenatal și postpartum: un traseu sau două achiziții?');
  });
  it('after a step, ask whether people continue, not whether they buy one product (when there is more than one way to continue)', () => {
    expect(continuationWording('Dintre clienții care plătesc evaluarea, câți cumpără un abonament după?', 'ro', ['package', 'ongoing_service'])).toBe('Dintre clienții care plătesc evaluarea, câți continuă apoi cu ședințe sau un pachet?');
    expect(continuationWording('Nu știu încă: câți clienți care plătesc evaluarea cumpără apoi un abonament și câți nu revin.', 'ro', ['ongoing_service', 'package'])).toBe('Nu știu încă: câți clienți care plătesc evaluarea continuă apoi cu ședințe sau un pachet și câți nu revin.');
    expect(continuationWording('How many buy a subscription afterwards?', 'en', ['subscription'])).toBe('How many buy a subscription afterwards?'); // one way to continue: the product is the continuation
  });
  it('MY READ stops at the sentences that cover every top thesis (no mechanics after the read)', () => {
    const both = 'Evaluarea de 200 lei este obligatorie înainte de abonamentul clinic, iar gimnastica prenatală și recuperarea postpartum pot forma un traseu.';
    const r = governProjection({ ...GOOD, myRead: [{ text: both, refs: ['F2', 'F3', 'F4'] }, { text: 'Abonamentele de 4, 8 și 12 ședințe pot continua relația după prima vizită.', refs: ['F1'] }] } as any, record, input);
    expect(r.founder.myRead).toBe(both);
  });
});

describe('MY READ salvage and evidence strength (2026-10-17)', () => {
  const src = 'Kinetoterapia începe cu o evaluare plătită separată înainte de abonament.';
  it('"mandatory" and "no direct path" are softened to what the evidence states', () => {
    expect(soften('Evaluarea de 200 lei este un pas plătit separat, obligatoriu înainte de orice abonament clinic, și nu există o cale directă spre aceste servicii fără ea.', src))
      .toBe('Evaluarea de 200 lei este un pas plătit separat înainte de abonament clinic.');
    expect(soften('Evaluarea este obligatorie înainte de abonament.', 'Evaluarea este obligatorie înainte de abonament.')).toBe(''); // the evidence says it
  });
  it('a long MY READ sentence is shortened, not dropped, while it keeps covering both theses', () => {
    const long = 'Evaluarea de 200 lei pune un prim pas distinct înainte de abonamentul clinic, atât în kinetoterapie cât și în recuperarea postpartum individuală la ambele locații, iar gimnastica prenatală și recuperarea postpartum pot forma un singur traseu continuu pentru aceeași persoană.';
    const r = governProjection({ ...GOOD, myRead: [{ text: long, refs: ['F2', 'F3', 'F4'] }] } as any, record, input);
    expect(r.founder.myRead).toBe('Evaluarea de 200 lei pune un prim pas distinct înainte de abonamentul clinic, iar gimnastica prenatală și recuperarea postpartum pot forma un traseu continuu pentru aceeași persoană.');
    expect(r.dropped.some((d) => d.reason.startsWith('shortened to fit'))).toBe(true);
  });
  it('a business with two different buying motions opens MY READ with the business-level line', () => {
    const two = { ...record, businessModel: { ...record.businessModel, motions: [...record.businessModel.motions, { name: 'Clase', entry: ['self_serve'], buying: ['booking'], continuation: ['package'], refs: ['F1'] }] } };
    const r = governProjection(GOOD as any, two as any, input);
    expect(r.founder.myRead.startsWith('Afacerea ta are mai mult de un traseu comercial sub același brand. ')).toBe(true);
  });
});

describe('final copy tidy (2026-10-17)', () => {
  it('no unnecessary exclusivity; a count instead of a percentage; the plain driver question', () => {
    expect(tidyFounderCopy('Prenatal și postpartum pot forma un singur traseu continuu pentru același client.', 'ro')).toBe('Prenatal și postpartum pot forma un traseu continuu pentru același client.');
    expect(tidyFounderCopy('Nu știu încă: ce procent din clienții de recuperare postpartum au trecut prin prenatal.', 'ro')).toBe('Nu știu încă: câți dintre clienții de recuperare postpartum au trecut prin prenatal.');
    expect(tidyFounderCopy("I don't know yet: what percentage of clients came back.", 'en')).toBe("I don't know yet: how many of clients came back.");
    const r = governProjection(GOOD as any, record, input);
    expect(r.questions[0]!.question).toBe('Care familii de servicii aduc azi cei mai mulți clienți activi și cel mai mult venit lunar?');
  });
});
