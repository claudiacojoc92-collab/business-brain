import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agendaUnknowns, businessEntities, governFindingsDetailed, governUnderstanding, mixesSourceVoice, sourceTrust, type GovernedUnderstanding, type PageObservation, type UnderstandingRead } from '../../bi/index';

/**
 * Understanding governance (2026-10-15) against the REAL production blind-test output (Body Move – Blind Test, public
 * website only, old prompt). The same claims are run through governance as a v2 read would carry them, and every
 * failure the operator named must be lowered in code, whatever the model wrote.
 */
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'body-move-blind-2026-10-15.json'), 'utf8')) as { understanding: GovernedUnderstanding };
const OLD = fixture.understanding;

const page = (ref: string, url: string, discoveredVia: PageObservation['discoveredVia'], text = ''): PageObservation =>
  ({ ref, url, pageType: 'page', title: null, text, lang: 'ro', provenance: 'observed', sourceKind: 'website', discoveredVia });
const OBS: PageObservation[] = [
  page('Homepage', 'https://bodymovestudio.ro/', 'entry'),
  page('Servicii - Body Move Studio', 'https://bodymovestudio.ro/servicii/', 'link'),
  page('Despre noi - Body Move Studio', 'https://bodymovestudio.ro/despre-noi/', 'link'),
  page('Clase & Personal Training - Body Move St', 'https://bodymovestudio.ro/clase/', 'link'),
  page('Page-sitemap.xml', 'https://bodymovestudio.ro/page-sitemap.xml', 'sitemap'),
  page('Product-sitemap.xml', 'https://bodymovestudio.ro/product-sitemap.xml', 'sitemap'),
];

/** The old output, as a v2 read carrying the same claims (the model claimed a constraint with every check "passed"). */
function asV2(extra: Partial<UnderstandingRead> = {}): GovernedUnderstanding {
  const pass = { pass: true, note: 'yes' };
  return {
    ...OLD,
    read: {
      model: [{ dimension: 'offer', known: [{ text: 'Pilates, kinetoterapie, masaj și programe pre/postpartum în două locații', basis: 'observed', sourceRefs: ['Servicii - Body Move Studio'] }], unknown: [] }],
      notConcluding: [], untrusted: [], websiteNotes: [],
      questions: [
        { question: 'Câți ani de experiență are studioul — contorul de pe site arată „0 +”?', dimension: 'offer', changes: [], why: 'pare nefinalizat' },
        { question: 'Ce include pagina „o-comunitate-de-oameni-motivati”?', dimension: 'offer', changes: [], why: '' },
        { question: 'Care segment îți aduce cel mai mare volum de clienți acum și pe care vrei să construiești?', dimension: 'customer', changes: ['segment', 'bet'], why: 'decide unde merge efortul' },
        { question: 'De unde vin clienții noi astăzi?', dimension: 'acquisition', changes: ['channel', 'bet', 'resources'], why: 'decide canalul' },
        { question: 'Unde mai ai locuri libere: ce clase sau ce locație?', dimension: 'capacity', changes: ['capacity', 'sequencing'], why: 'decide ce umpli întâi' },
      ],
      diagnosis: { state: 'constraint', statement: OLD.constraint!.statement, checks: { exists: pass, causal: pass, blocks: pass, alternativesWeaker: pass, evidenceSufficient: pass }, sourceRefs: OLD.constraint!.sourceRefs },
      ...extra,
    },
  };
}

describe('governance on the Body Move blind-test output', () => {
  const g = governUnderstanding(asV2(), OBS);

  it('"YOUR REAL CONSTRAINT" is not earned from a website: demoted to a hypothesis, and the legacy field is undecided', () => {
    expect(g.read!.diagnosis.state).toBe('hypothesis');
    expect(g.read!.diagnosis.demotion).toBe('no_goal');
    expect(g.constraint).toEqual({ decided: false, statement: '', why: '', sourceRefs: [] });
    expect(g.read!.notConcluding[0]).toMatchObject({ claim: OLD.constraint!.statement, reason: 'no_goal' });
  });

  it('the "0 +" counter and the /maintenance/ page are website hygiene: never a tension', () => {
    expect(g.contradictions.map((c) => c.kind)).not.toContain('commercial_path');
    expect(g.read!.websiteNotes.join(' ')).toMatch(/0 \+/);
    expect(g.offer.unclear.join(' ')).not.toMatch(/0 \+|contor/);
  });

  it('a tension resting on the sitemap ("services hidden in the sitemap") is something BB found but does not trust', () => {
    expect(g.contradictions.map((c) => c.kind)).not.toContain('priority_vs_effort');
    expect(g.read!.untrusted.some((x) => x.reason === 'sitemap')).toBe(true);
  });

  it('absence without the founder\'s goal is a website note, not a tension: "no protocol visible" never becomes "so all persuasion happens at reception"', () => {
    expect(g.contradictions.map((c) => c.kind)).not.toContain('capability_gap');
    expect(g.contradictions.map((c) => c.kind)).not.toContain('customer_proof');
    expect(g.capabilityCheck).toBeUndefined();
    expect(g.read!.websiteNotes.join(' ')).toMatch(/protocol de tratament|Niciun client real/);
    expect(JSON.stringify(g.contradictions)).not.toMatch(/la telefon sau la recepție/);
  });

  it('the "0+ years" question cannot take a slot; the slots go to questions that change real decisions', () => {
    expect(g.unknowns.join(' ')).not.toMatch(/0 \+|ani de experiență|o-comunitate/);
    expect(agendaUnknowns(g)).toEqual([
      'De unde vin clienții noi astăzi?',
      'Care segment îți aduce cel mai mare volum de clienți acum și pe care vrei să construiești?',
      'Unde mai ai locuri libere: ce clase sau ce locație?',
    ]);
    expect(g.read!.questions[0]!.changes).toEqual(['channel', 'bet', 'resources']);
  });

  it('stage evidence from the sitemap ("new services added in the sitemap, July 2025") is not stage evidence', () => {
    expect(g.stage!.evidence.join(' ')).not.toMatch(/sitemap/i);
    expect(g.stage!.secondary ?? null).toBeNull();
  });

  it('an "observed" line that adds a conclusion is inferred; a goal question never takes an agenda slot (the goal step follows)', () => {
    const g2 = governUnderstanding(asV2({
      model: [{ dimension: 'retention', known: [
        { text: 'Abonamentele pe mai multe ședințe sunt listate pentru clase.', basis: 'observed', sourceRefs: ['Clase & Personal Training - Body Move St'] },
        { text: 'Ședințele neanulate se scad din abonament, ceea ce descurajează absențele.', basis: 'observed', sourceRefs: ['Clase & Personal Training - Body Move St'] },
      ], unknown: [] }],
      questions: [
        { question: 'Ce vrei să crești în următoarele 6-12 luni?', dimension: 'intent', changes: ['bet', 'segment', 'capacity', 'sequencing', 'resources'], why: 'w' },
        { question: 'De unde vin clienții noi astăzi?', dimension: 'acquisition', changes: ['channel', 'bet'], why: 'w' },
      ],
    }), OBS);
    expect(g2.read!.model.find((d) => d.dimension === 'retention')!.known.map((k) => k.basis)).toEqual(['observed', 'inferred']);
    expect(g2.read!.questions[0]!.dimension).toBe('intent');
    expect(agendaUnknowns(g2)).toEqual(['De unde vin clienții noi astăzi?']);
  });

  it('"no prices visible" is an absence: a website note before the goal is known, a consequence-free tension after; booking moves to conversion', () => {
    const priced = { kind: 'commercial_path' as const, statementA: 'a', statementB: 'b', tension: 'Pentru Kinetoterapie nu există prețuri vizibile în sursele citite.', soWhat: 'Un client nu poate evalua costul, ceea ce adaugă un pas.', sourceRefs: ['Servicii - Body Move Studio'], evidence: [] };
    const g3 = governUnderstanding({ ...asV2({ model: [{ dimension: 'acquisition', known: [{ text: 'Programările se fac prin aplicația Evo Beauty sau prin recepție.', basis: 'observed', sourceRefs: ['Homepage'] }], unknown: [] }] }),
      contradictions: [priced] }, OBS);
    expect(g3.contradictions).toEqual([]);
    expect(g3.read!.websiteNotes).toContain(priced.tension);
    const withGoal = [...OBS, { ref: 'What you told me', url: 'founder://supplied/1', pageType: 'text', title: null, text: 'I want more physio clients', lang: 'ro', provenance: 'declared' as const, sourceKind: 'supplied' as const }];
    expect(governUnderstanding({ ...asV2(), contradictions: [priced] }, withGoal).contradictions[0]).toMatchObject({ absence: true, soWhat: '' });
    expect(g3.read!.model.find((d) => d.dimension === 'acquisition')!.known).toEqual([]);
    expect(g3.read!.model.find((d) => d.dimension === 'conversion')!.known[0]!.text).toMatch(/Evo Beauty/);
  });

  it('behaviour predictions and unsupported economics are never stored as business reality', () => {
    const PRICE_LINE = 'Pilates 1 ședință 90 lei Personal Training 1 ședință 150 lei';
    const obsP = OBS.map((o) => (o.ref === 'Clase & Personal Training - Body Move St' ? { ...o, text: PRICE_LINE } : o));
    const ref = 'Clase & Personal Training - Body Move St';
    const g4 = governUnderstanding({ ...asV2({ model: [{ dimension: 'economics', known: [
      { text: 'Prețul per ședință variază între 90 și 150 lei.', basis: 'observed', sourceRefs: [ref],
        numbers: [{ value: 90, entity: 'Pilates', qualifier: '1 ședință', ref, quote: PRICE_LINE }, { value: 150, entity: 'Personal Training', qualifier: '1 ședință', ref, quote: PRICE_LINE }] },
      { text: 'Prețul per ședință pentru Pilates este 120 lei.', basis: 'observed', sourceRefs: [ref], numbers: [{ value: 120, entity: 'Pilates', ref, quote: PRICE_LINE }] },
      { text: 'Kinetoterapia este probabil serviciul cu valoare mai mare per client.', basis: 'inferred', sourceRefs: ['Servicii - Body Move Studio'] },
    ], unknown: [] }] }), contradictions: [
      { kind: 'audience_mismatch', statementA: 'a', statementB: 'b', tension: 'Spui că servești toate vârstele. Toată comunicarea vorbește unui adult.', soWhat: 'Părinții care caută activități pentru copii nu se regăsesc și pot trece mai departe.', sourceRefs: ['Servicii - Body Move Studio'], evidence: [] },
      { kind: 'other', statementA: 'a', statementB: 'b', tension: 'Vizitatorii vor pleca fără să programeze.', soWhat: '', sourceRefs: ['Homepage'], evidence: [] },
    ] }, obsP);
    const g6 = governUnderstanding({ ...asV2(), contradictions: [{ kind: 'audience_mismatch', statementA: 'a', statementB: 'Nicio pagină nu vorbește copiilor.', tension: 'Site-ul spune că servește toate vârstele. Paginile de clase vorbesc adulților.', soWhat: 'Segmentul copii și cel de recuperare pot ajunge pe site și să nu se recunoască în limbaj.', sourceRefs: ['Servicii - Body Move Studio'], evidence: [] }],
      read: { ...asV2().read!, untrusted: [{ finding: 'Contorul „Ani de experiență 0+” pare un widget nefinalizat.', refs: ['Homepage'], why: 'nu s-a încărcat' }] } }, OBS);
    expect(g6.contradictions[0]).toMatchObject({ kind: 'audience_mismatch', absence: false, soWhat: '' }); // a positioning tension, not an absence; the predicted reaction goes
    expect(g6.read!.untrusted.map((x) => x.finding).join(' ')).not.toMatch(/0\+/);
    expect(g6.read!.websiteNotes.join(' ')).toMatch(/0\+/);
    expect(g4.contradictions).toHaveLength(1);
    expect(g4.contradictions[0]).toMatchObject({ kind: 'audience_mismatch', soWhat: '' }); // the observation stays, the predicted reaction goes
    expect(g4.read!.model.find((d) => d.dimension === 'economics')!.known.map((k) => k.text)).toEqual(['Prețul per ședință variază între 90 și 150 lei.']);
    expect(g4.read!.notConcluding.filter((n) => n.reason === 'unsupported').map((n) => n.claim)).toEqual(expect.arrayContaining(['Vizitatorii vor pleca fără să programeze.']));
  });

  it('website positioning is not a founder declaration: "you bet on…" from site copy alone is not stored; with the founder\'s words it may stand', () => {
    const bet = { ...OLD.positioning, summary: 'Pariezi pe o abordare integrată și personalizată a sănătății, nu pe fitness de masă.' };
    expect(governUnderstanding({ ...asV2(), positioning: bet }, OBS).positioning.summary).toBe('');
    const site = { ...OLD.positioning, summary: 'Site-ul se poziționează ca un studio integrat de mișcare și recuperare.' };
    expect(governUnderstanding({ ...asV2(), positioning: site }, OBS).positioning.summary).toBe(site.summary);
    const withGoal = [...OBS, { ref: 'What you told me', url: 'founder://supplied/1', pageType: 'text', title: null, text: 'We bet on recovery', lang: 'ro', provenance: 'declared' as const, sourceKind: 'supplied' as const }];
    expect(governUnderstanding({ ...asV2(), positioning: bet }, withGoal).positioning.summary).toBe(bet.summary);
  });

  it('two metrics that can diverge stay separate answers inside one question', () => {
    const g5 = governUnderstanding(asV2({ questions: [{ question: 'Care servicii conduc astăzi la: a) număr de clienți activi; b) venit lunar?', dimension: 'offer', changes: ['segment', 'bet'], why: 'w', parts: ['a) număr de clienți activi', 'b) venit lunar'] }] }), OBS);
    expect(g5.read!.questions[0]!.parts).toEqual(['număr de clienți activi', 'venit lunar']);
  });

  it('known / inferred / unknown are separate: every dimension is present, the unknown ones are empty', () => {
    expect(g.read!.model.map((d) => d.dimension)).toEqual(['offer', 'customer', 'acquisition', 'conversion', 'retention', 'capacity', 'economics', 'performance', 'intent']);
    expect(g.read!.model.find((d) => d.dimension === 'offer')!.known[0]).toMatchObject({ basis: 'observed' });
    expect(g.read!.model.find((d) => d.dimension === 'acquisition')!.known).toEqual([]);
  });
});

describe('strategic sufficiency, Aha value and source voice (2026-10-15 final pass)', () => {
  const qs: UnderstandingRead['questions'] = [
    { question: 'Câte locuri libere ai în fiecare clasă?', dimension: 'capacity' as const, changes: ['capacity', 'sequencing', 'resources', 'offer', 'bet'], why: 'w' },
    { question: 'Câți clienți reînnoiesc abonamentul?', dimension: 'retention' as const, changes: ['retention', 'offer', 'resources', 'sequencing'], why: 'w' },
    { question: 'Care servicii aduc azi: a) cei mai mulți clienți; b) cel mai mare venit?', dimension: 'offer' as const, fills: ['performance'], changes: ['offer', 'bet'], why: 'w', parts: ['clienți', 'venit'] },
    { question: 'De unde vin clienții noi acum?', dimension: 'acquisition' as const, changes: ['channel'], why: 'w' },
  ];

  it('an operating business with unknown acquisition and driver is NOT ready; those questions take the first slots whatever the model\'s decision count', () => {
    const g = governUnderstanding(asV2({ questions: qs }), OBS);
    expect(g.read!.strategyReadiness).toEqual({ state: 'not_ready', missing: ['intent', 'performance', 'acquisition'] });
    expect(agendaUnknowns(g)).toEqual([
      'Care servicii aduc azi: a) cei mai mulți clienți; b) cel mai mare venit?',
      'De unde vin clienții noi acum?',
      'Câte locuri libere ai în fiecare clasă?',
    ]);
  });

  it('once acquisition and performance are known, the ranking is information value alone; readiness waits only on the goal', () => {
    const known = (dimension: 'acquisition' | 'performance', text: string) => ({ dimension, known: [{ text, basis: 'declared' as const, sourceRefs: ['What you told me'] }], unknown: [] });
    const withFounder = [...OBS, { ref: 'What you told me', url: 'founder://supplied/1', pageType: 'text', title: null, text: 'Most clients come from recommendations; Pilates brings most revenue.', lang: 'ro', provenance: 'declared' as const, sourceKind: 'supplied' as const }];
    const g = governUnderstanding(asV2({ questions: qs, model: [...asV2().read!.model, known('acquisition', 'Clienții vin din recomandări.'), known('performance', 'Pilatesul aduce cel mai mult venit.')] }), withFounder);
    expect(g.read!.strategyReadiness).toEqual({ state: 'not_ready', missing: ['intent'] });
    expect(agendaUnknowns(g)[0]).toBe('Câte locuri libere ai în fiecare clasă?');
  });

  it('a fact is not an insight: a finding with no decision it could change is demoted to an observation', () => {
    const E = { entities: ['Pilates', 'Aerial Yoga', 'Personal Training', 'Kinetoterapie', 'Balet Adulți', 'Group Training'] };
    const ref = 'Clase & Personal Training - Body Move St';
    const { aha, demoted } = governFindingsDetailed({ status: 'produced', findings: [
      { finding: 'Aerial Yoga este cea mai scumpă clasă de grup.', sourceRefs: [ref] },
      { finding: 'Pachetele Pilates costă mult mai puțin pe ședință decât ședința individuală.', sourceRefs: [ref], matters: 'La Pilates, pachetul e structura principală de preț.', changes: ['offer', 'retention'] },
    ] }, OBS, E);
    expect(aha.findings.map((f) => f.finding)).toEqual(['Pachetele Pilates costă mult mai puțin pe ședință decât ședința individuală.']);
    expect(demoted.map((d) => d.text)).toEqual(['Aerial Yoga este cea mai scumpă clasă de grup.']);
    // "why it matters" may not speculate, claim behaviour / economics, need missing data, claim arrival, or be generic
    const why = (matters: string, changes: string[] = ['offer']) => governFindingsDetailed({ status: 'produced', findings: [{ finding: 'Personal Training are cel mai mare preț pe ședință.', sourceRefs: [ref], matters, changes: changes as never }] }, OBS, E);
    for (const m of [
      'Un discount atât de mare poate atrage clienți pe volum.',                               // modal / behaviour
      'Personal Training are cel mai mare potențial de venit per oră de specialist.',           // economics
      'La Personal Training, structura de prețuri îi erodează venitul per ședință.',             // economics
      'La Aerial Yoga, un preț mai mare sugerează fie o cerere mai mare, fie un cost mai mare.',  // speculation
      'Un client de Kinetoterapie ajunge prin cu totul alt drum față de unul de Balet Adulți.',  // arrival, unknown
      'Group Training ocupă aceeași durată a antrenorului ca Personal Training.',                // needs duration data
      'Fiecare segment are nevoi, canale și motive de cumpărare diferite.',                      // generic
    ]) {
      const r = why(m);
      expect(r.aha.findings, m).toEqual([]);
      expect(r.demoted, m).toHaveLength(1);
    }
  });

  it('a so-what that is only source text copied over is no consequence', () => {
    const obs = [...OBS.slice(0, 1), { ...OBS[1]!, text: 'Servicii pentru toate etapele vieții, de la copii și adolescenți până la adulți, viitoare mame și persoane aflate în recuperare.' }, ...OBS.slice(2)];
    const g7 = governUnderstanding({ ...asV2(), contradictions: [{ kind: 'audience_mismatch', statementA: 'a', statementB: 'b', tension: 'Paginile adresează patru segmente. Toate primesc același mesaj.',
      soWhat: 'Servicii pentru toate etapele vieții, de la copii și adolescenți până la adulți, viitoare mame și persoane aflate în recuperare.', sourceRefs: ['Servicii - Body Move Studio'], evidence: [] }] }, obs);
    expect(g7.contradictions[0]).toMatchObject({ soWhat: '' });
  });

  it('source voice: one owner per claim; "Site-ul declară că servești…" is never stored, "Site-ul spune că studioul…" is', () => {
    expect(mixesSourceVoice('Site-ul declară că servești toate etapele vieții.')).toBe(true);
    expect(mixesSourceVoice('The site says you serve every age.')).toBe(true);
    expect(mixesSourceVoice('Situl declară că servești simultan copii și adulți.')).toBe(true);
    expect(mixesSourceVoice('Site-ul spune că studioul se adresează tuturor vârstelor.')).toBe(false);
    expect(mixesSourceVoice('Mi-ai spus că vrei mai mulți clienți.')).toBe(false);
    const mixed = { kind: 'audience_mismatch' as const, statementA: 'a', statementB: 'b', tension: 'Site-ul declară că servești toate etapele vieții. Clasele vorbesc adulților.', soWhat: '', sourceRefs: ['Servicii - Body Move Studio'], evidence: [] };
    const clean = { ...mixed, tension: 'Site-ul spune că studioul servește toate etapele vieții. Paginile de clase vorbesc adulților.' };
    expect(governUnderstanding({ ...asV2(), contradictions: [mixed] }, OBS).contradictions).toEqual([]);
    expect(governUnderstanding({ ...asV2(), contradictions: [clean] }, OBS).contradictions.map((c) => c.tension)).toEqual([clean.tension]);
  });
});

describe('the diagnosis is earned in code', () => {
  const pass = { pass: true, note: 'yes' };
  const all = { exists: pass, causal: pass, blocks: pass, alternativesWeaker: pass, evidenceSufficient: pass };
  const withGoal = [...OBS, { ref: 'What you told me', url: 'founder://supplied/1', pageType: 'text', title: null, text: 'I want to grow kinetotherapy', lang: 'ro', provenance: 'declared' as const, sourceKind: 'supplied' as const }];

  it('with the founder\'s goal and every check passed on trusted sources, it may be called the constraint', () => {
    const g = governUnderstanding(asV2({ diagnosis: { state: 'constraint', statement: 'Kinetoterapia nu are un drum de programare separat.', checks: all, sourceRefs: ['Servicii - Body Move Studio'] } }), withGoal);
    expect(g.read!.diagnosis.state).toBe('constraint');
    expect(g.constraint).toMatchObject({ decided: true, statement: 'Kinetoterapia nu are un drum de programare separat.' });
  });
  it('one failing check, or only untrusted sources, lowers it', () => {
    const failing = governUnderstanding(asV2({ diagnosis: { state: 'constraint', statement: 'X blochează creșterea.', checks: { ...all, alternativesWeaker: { pass: false, note: '' } }, sourceRefs: ['Homepage'] } }), withGoal);
    expect(failing.read!.diagnosis).toMatchObject({ state: 'hypothesis', demotion: 'not_established' });
    const sitemapOnly = governUnderstanding(asV2({ diagnosis: { state: 'hypothesis', statement: 'Serviciile noi nu au clienți.', checks: {}, sourceRefs: ['Page-sitemap.xml'] } }), withGoal);
    expect(sitemapOnly.read!.diagnosis.state).toBe('not_ready');
  });
});

describe('business entities (the vocabulary for specificity and number grounding)', () => {
  it('takes offer NAMES only: never a price list or a package as an entity', () => {
    const u = { ...OLD, offer: { ...OLD.offer, explicit: ['Pilates – 1 ședință 90 lei, Abon. 12 500 lei', 'Group Training (max. 4 persoane) – 1 ședință 90 lei', 'Kinetoterapie', 'Balet & Dans Copii, Personal Training'] } };
    expect(businessEntities(u)).toEqual(['Pilates', 'Group Training', 'Kinetoterapie', 'Balet & Dans Copii', 'Personal Training']);
  });
});

describe('source trust and findings', () => {
  it('sitemap XML, maintenance and sitemap-only pages are untrusted; linked pages, founder material and Instagram are trusted', () => {
    expect(sourceTrust(OBS[4])).toMatchObject({ trusted: false, reason: 'technical' });
    expect(sourceTrust(page('Old', 'https://a.ro/old-offer/', 'sitemap'))).toMatchObject({ trusted: false, reason: 'sitemap_only' });
    expect(sourceTrust(page('M', 'https://a.ro/maintenance/', 'link'))).toMatchObject({ trusted: false, reason: 'technical' });
    expect(sourceTrust(page('Test', 'https://a.ro/test-postural/', 'link')).trusted).toBe(true); // a real offer, not a test page
    expect(sourceTrust(OBS[1]).trusted).toBe(true);
  });
  it('Aha findings follow the same discipline: no sitemap, hygiene, speculation, unit economics, behaviour, ungrounded numbers, or absence before the goal', () => {
    const { aha, audit } = governFindingsDetailed({ status: 'produced', findings: [
      { finding: 'Ai opt servicii ascunse în sitemap.', sourceRefs: ['Page-sitemap.xml'] },
      { finding: 'Contorul arată 0 + ani.', sourceRefs: ['Homepage'] },
      { finding: 'Kinetoterapia și masajul, care pot fi servicii cu valoare mai mare per client, nu au prețuri vizibile.', sourceRefs: ['Servicii - Body Move Studio'] },
      { finding: 'Balet & Dans Copii nu este menționat în niciun CTA de pe homepage.', sourceRefs: ['Homepage'] },
      { finding: 'Abonamentul de 12 ședințe Pilates costă 500 lei față de 1080 lei la preț individual.', sourceRefs: ['Clase & Personal Training - Body Move St'],
        matters: 'Pachetul Pilates e prețul principal pe care îl vede un client nou.', changes: ['offer', 'retention'] },
      { finding: 'Vinzi Kinetoterapie și Pilates în aceleași locații.', sourceRefs: ['Servicii - Body Move Studio'], implication: 'Părinții pot trece mai departe fără să afle asta.',
        matters: 'Kinetoterapie și Pilates folosesc aceleași săli.', changes: ['offer', 'capacity'] },
    ] }, OBS, { entities: ['Pilates', 'Kinetoterapie'] });
    expect(aha.findings.map((f) => f.finding)).toEqual(['Vinzi Kinetoterapie și Pilates în aceleași locații.']);
    expect(aha.findings[0]!.implication).toBe(''); // the behaviour prediction is cleared, the observed fact stays
    expect(audit.find((a) => a.finding.startsWith('Abonamentul de 12'))).toMatchObject({ verdict: 'dropped' });
    expect(audit.find((a) => a.finding.startsWith('Abonamentul de 12'))!.reason).toMatch(/number not grounded/);
  });
  it('a snapshot without a v2 read passes through unchanged', () => {
    expect(governUnderstanding(OLD, OBS)).toBe(OLD);
  });
});
