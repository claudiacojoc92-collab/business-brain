import type { AhaResult, DiagnosisCheck, EvidenceBasis, GovernedUnderstanding, ModelClaim, ModelDimension, PageObservation, StrategicDecision, UnderstandingRead, UntrustedReason } from './contracts';
import { DIAGNOSIS_CHECKS, MODEL_DIMENSIONS, STRATEGIC_DECISIONS } from './contracts';
import { isHousekeeping, sameInsight } from './insight-text';
import { isWebsiteHygiene, trustByRef } from './source-trust';
import { groundNumbers, numbersIn } from './numeric-grounding';
import { anchorClaimEvidence } from './evidence-anchor';
import { makesUnlicensedClaim } from './validation';

/**
 * UNDERSTANDING GOVERNANCE (2026-10-15). The model proposes a business-model read; code decides what is allowed to stand,
 * BEFORE the understanding is stored (strategy, Aha 2, the mirror and the conversation all read what is stored):
 *
 *  1. Source trust: a claim that rests only on technical pages (sitemap, maintenance, shop mechanics) or on pages found
 *     only in a sitemap is "something I found but don't trust yet", never a business fact or a tension.
 *  2. Website hygiene (counters, indexing, broken pages) is never a tension or a question.
 *  3. Absence is an observation about the sources, not about the business: "I could not see X" keeps no consequence
 *     ("so all persuasion happens at reception" is unsupported), and its basis is what was observed.
 *  4. A diagnosis is EARNED: it is called the constraint only when every check passes (the condition exists, it is
 *     causally tied to the founder's goal, it blocks progress, competing explanations are weaker, the evidence is
 *     enough) — and without the founder's goal, nothing can be causally tied to it. Otherwise it is a hypothesis.
 *  5. Questions are ranked by the strategic decisions their answer could change; a question that changes none, or is
 *     about the website's hygiene, never takes one of the few slots.
 *
 * Deterministic. A snapshot without a v2 `read` (older prompt) passes through unchanged.
 */

const ABSENCE = /(?<!\p{L})(no (page|post|source|client|customer|testimonial|example|case|result|price|protocol|visible)|none of|never (shows?|mentions?|appears?)|not (visible|shown|mentioned|published)|does(n't| not) (show|mention)|there (is|are) no|ha(s|ve) no|nothing (on|in)|missing|nicio|niciun(ul|a)?|nu (există|exista|apare|apar|arată|se vede|se văd|menționează|au|are)|absen[țt]a|lips[ăa]|lipse[șs]te|lipsesc|nessun[oa]?|non (c'è|ci sono|mostra|appare|compare)|kein(e|en)?|zeigt (nicht|kein)|gibt es kein)(?!\p{L})/iu;
/**
 * A prediction of how visitors, parents or customers will BEHAVE ("parents will move on", "visitors leave", "people get
 * confused", "customers hesitate", "it can stop the decision"). No website shows behaviour: without behavioural evidence
 * such a claim is never stored as business reality (EN / RO / IT / DE).
 */
const BEHAVIOUR = /(?<!\p{L})((vizitator\p{L}*|p[ăa]rin[țt]i\p{L}*|clien[țt]i\p{L}*|client(ul)? poten[țt]ial|oamenii|cineva|segment\p{L}*|visitors?|users?|people|customers?|clients?|parents|buyers?|visitatori|utenti|clienti|genitori|besucher|nutzer|kunden|eltern)[^.!?]{0,90}(plea?c\p{L}*|renun[țt]\p{L}*|ezit\p{L}*|abandon\p{L}*|trec\p{L}* mai departe|se reg[ăa]s\p{L}*|se recunoa\p{L}*|recogni[sz]e themselves|see themselves|nu (în)?[țt]eleg\p{L}*|confuz\p{L}*|nu au încredere|nu (pot|poate) (evalua|judeca|compara)|se r[ăa]zg[âa]nd\p{L}*|leave|bounce|skip|hesitate|abandon|get confused|be confused|won'?t trust|don'?t trust|go elsewhere|move on|drop off|convert|lasciano|abbandon\p{L}*|esitano|verlassen|springen ab|z[öo]gern)|(poate|pot) opri decizia|opre[șs]te decizia|stop the decision|pierzi clien\p{L}*|lose (the )?(sale|client|customer)s?|(poate|pot|ar putea)? ?atrag\p{L}* (mai mul[țt]i )?clien\p{L}*|(can|could|may|will) attract (more )?(clients|customers)|attracts? (more )?(clients|customers))(?!\p{L})/iu;
/** How customers ARRIVE ("clients come through…"): a fact the founder can declare, never a website-only reason an Aha matters. */
const ARRIVAL = /(?<!\p{L})(canal\p{L}* de achizi[țt]ie|acquisition channels?|ajung\p{L}* (prin|pe|din)|vin (prin|din)|arrives? (via|through|from)|come (via|through)|find (you|us|the studio) (via|through))(?!\p{L})/iu;
/**
 * Why an Aha matters must be stated, not guessed: any modal ("may", "can", "could", "poate", "ar putea", "semnalează")
 * turns it into speculation. Used ONLY on `matters` (in ordinary claims "the client can book online" is a fact).
 */
const MODAL = /(?<!\p{L})(poate|pot|ar putea|semnal\p{L}*|may|might|could|can|signals?|potrebbe|pu[òo]|kann|k[öo]nnte)(?!\p{L})/iu;
/**
 * A "why it matters" that needs data BB does not have: session duration, trainer time, utilisation, occupancy, demand
 * (EN / RO / IT / DE). Without that evidence the implication is premature: the fact stays an observation.
 */
const NEEDS_UNKNOWN = /(?<!\p{L})(acela[șs]i timp|aceea[șs]i durat\p{L}*|timp\p{L}* (al |de )?(antrenor|instructor|specialist)\p{L}*|per or[ăa]|pe or[ăa]|durat[ăa]\p{L}*|ocupar\p{L}*|cerer\p{L}*|utiliz\p{L}*|same (trainer )?time|per hour|trainer[- ]?(time|hours?)|duration|occupancy|utili[sz]ation|demand|stesso tempo|all'ora|occupazione|domanda|gleiche zeit|pro stunde|auslastung|nachfrage)(?!\p{L})/iu;

/** The business's own named things (offers, packages, locations) from what the synthesis read: the vocabulary that
 *  makes a "why it matters" specific to THIS business, and that numeric grounding uses to spot a borrowed number. */
export function businessEntities(u: GovernedUnderstanding | null | undefined): string[] {
  // The NAME of each listed offer: what comes before a dash / colon / parenthesis (the rest is often its price list),
  // split on commas for a list of names. A name never contains a digit (that is a price or a package, not an entity).
  const offers = clean(u?.offer?.explicit)
    .map((x) => x.split(/\s[—–-]\s|:|\(/)[0] ?? '')
    .flatMap((x) => x.split(/[,;·•]/))
    .map((x) => x.trim())
    .filter((x) => x.length >= 3 && x.split(/\s+/).length <= 6 && !/\d/.test(x));
  return [...new Set(offers)];
}

/** Unit-economics claims a website cannot support (value per client, profitability, margin, revenue leader). */
const ECONOMICS = /(?<!\p{L})(poten[țt]ial\p{L}* de venit|venit\p{L}* (per|pe) (or[ăa]|ședin[țt][ăa]|sedinta|specialist|client)|erod\p{L}*|revenue (potential|per (hour|session|client))|earning potential|erod(e|es|ing) (the )?revenue|costuri\p{L}*|acoper\p{L}* cost\p{L}*|the costs|its costs|operating costs|cover(s|ing)? (the )?costs|sustenabil\p{L}*|sustainable|break[- ]even|valoare (mai )?mare (per|pe) client|valoare mai mare|mai profitabil\p{L}*|profitabil\p{L}*|marj[ăa]\p{L}*|rentabil\p{L}*|venit(uri)? mai mar\p{L}*|aduc\p{L}* mai mul[țt]i bani|higher[- ]value|more profitable|profitab\p{L}*|margins?|lifetime value|LTV|CAC|revenue driver|most revenue|pi[ùu] redditiz\p{L}*|margine|rentabler|marge)(?!\p{L})/iu;
/** Speculation dressed as a finding ("could be", "might", "probably"). */
const SPECULATION = /(?<!\p{L})(ar putea|ar fi|pot fi|poate fi|probabil|could|might|may be|would likely|likely|probably|potrebbe|könnte|wahrscheinlich)(?!\p{L})/iu;
/** A strategic choice attributed to the founder ("you bet on", "you chose", "your strategy"). Only the founder can declare it. */
const FOUNDER_CHOICE = /(?<!\p{L})(pariezi|mizezi|ai ales|ai decis|strategia ta|alegerea ta|you bet|you'?re betting|you are betting|you chose|you have chosen|you decided|your strategy|scommetti|hai scelto|hai deciso|la tua strategia|du setzt auf|du hast (dich )?(entschieden|gew[äa]hlt)|deine strategie)(?!\p{L})/iu;

/**
 * MIXED SOURCE VOICE: one sentence that attributes a claim to the website AND speaks as the founder ("The site declares
 * that you serve…"). Website evidence is owned by the site ("The site says the studio…"), founder statements by the
 * founder ("You told me…"), BB's reading by BB ("From what I read, it seems…"); never two owners in one claim.
 */
const SITE_OWNER = /(?<!\p{L})(site-?ul|siteul|situl|pe site|pe sit|pagin(ile|a) (citit\p{L}*|site-ului)|the (web)?site|on the site|il sito|sul sito|die website|auf der website)(?!\p{L})/iu;
const FOUNDER_VOICE = /(?<!\p{L})(serve[șs]ti|oferi|ofere[șs]ti|e[șs]ti|vinzi|adresezi|lucrezi|ai|t[ăa]u|ta|tale|t[ăa]i|you|your|you're|yours|offri|sei|tuo|tua|du|dein\p{L}*|bietest)(?!\p{L})/iu;
export function mixesSourceVoice(text: string): boolean {
  return (text ?? '').split(/(?<=[.!?])\s+/).some((sentence) => SITE_OWNER.test(sentence) && FOUNDER_VOICE.test(sentence));
}

/** Booking or buying mechanics are conversion, not acquisition (how NEW customers first find the business). */
const BOOKING = /(?<!\p{L})(programar\p{L}*|programeaz\p{L}*|rezerv\p{L}*|recep[țt]i\p{L}*|book(ing|s)?|appointment|checkout|cart|co[șs]|aplica[țt]i\p{L}*|app|prenot\p{L}*|buch(ung|en))(?!\p{L})/iu;
const SITEMAP = /sitemap/i;
/** A conclusion added to an observation ("…, which suggests…"): the claim is then inferred, not observed (EN/RO/IT/DE). */
const INFERENCE = /(?<!\p{L})(which (means|suggests|implies|indicates|shows|discourages|encourages)|suggests?|implies|indicates?|probably|likely|ceea ce|sugereaz[ăa]|indic[ăa]|implic[ăa]|probabil|descurajeaz[ăa]|încurajeaz[ăa]|il che|suggerisce|probabilmente|was bedeutet|deutet|wahrscheinlich)(?!\p{L})/iu;

const clean = (xs: unknown): string[] => (Array.isArray(xs) ? xs : []).map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
const BASES: readonly EvidenceBasis[] = ['observed', 'declared', 'inferred', 'contradicted'];

export function governUnderstanding(u: GovernedUnderstanding, observations: readonly PageObservation[]): GovernedUnderstanding {
  if (!u?.read) return u;
  const trust = trustByRef(observations);
  const hasDeclared = observations.some((o) => o.provenance === 'declared');
  const untrusted: UnderstandingRead['untrusted'][number][] = [];
  const notConcludingExtra: UnderstandingRead['notConcluding'][number][] = [];
  const entities = businessEntities(u);
  const websiteNotes: string[] = [...clean(u.read.websiteNotes)];
  const trustedRefs = (refs: string[]): string[] => refs.filter((r) => trust(r).trusted);
  // Code-written reasons are codes (the card words them in the business's language); `why` stays for the model's own.
  const reasonOf = (refs: string[]): UntrustedReason => refs.map((r) => trust(r).reason).find(Boolean) ?? 'unread';

  // 1–3. Tensions.
  const contradictions: GovernedUnderstanding['contradictions'] = [];
  for (const c of u.contradictions ?? []) {
    const text = [c.tension, c.statementA, c.statementB, c.soWhat].filter(Boolean).join(' ');
    const refs = [...clean(c.sourceRefs), ...(c.evidence ?? []).map((e) => e.ref)];
    if (SITEMAP.test(text)) { untrusted.push({ finding: c.tension || c.statementB, refs, why: '', reason: 'sitemap' }); continue; }
    if (isWebsiteHygiene(text)) { websiteNotes.push(c.tension || c.statementB); continue; }
    if (!trustedRefs(refs).length) { untrusted.push({ finding: c.tension || c.statementB, refs, why: '', reason: reasonOf(refs) }); continue; }
    const absence = Boolean(c.absence) || ABSENCE.test(c.tension ?? '');
    // A tension that IS a behaviour prediction or an unsupported economics claim is not business reality.
    if (BEHAVIOUR.test(c.tension ?? '') || ECONOMICS.test(c.tension ?? '')) { notConcludingExtra.push({ claim: c.tension, why: '', reason: 'unsupported' }); continue; }
    // An absence becomes a strategic tension only when it connects to what the founder is trying to do. Without the
    // founder's goal, "X is not visible" stays a website note: no invented consequence, no strategic weight.
    if (absence && !hasDeclared) { websiteNotes.push(c.tension || c.statementB); continue; }
    // A tension whose own sentence mixes the website's voice with the founder's is not stored as written.
    if (mixesSourceVoice(c.tension ?? '')) { notConcludingExtra.push({ claim: c.tension, why: '', reason: 'unsupported' }); continue; }
    // A number in a tension must be in the source sentences quoted for it.
    const quoted = numbersIn((c.evidence ?? []).filter((e) => trust(e.ref).trusted).map((e) => e.quote).join(' '));
    if (numbersIn(c.tension ?? '').some((n) => !quoted.includes(n))) { notConcludingExtra.push({ claim: c.tension, why: '', reason: 'unsupported' }); continue; }
    // A "consequence" that is just source text copied over is no consequence.
    const soWhatOk = !BEHAVIOUR.test(c.soWhat ?? '') && !ECONOMICS.test(c.soWhat ?? '') && !SPECULATION.test(c.soWhat ?? '') && !mixesSourceVoice(c.soWhat ?? '')
      && !isLiftedText(c.soWhat ?? '', observations);
    contradictions.push({
      ...c,
      sourceRefs: trustedRefs(clean(c.sourceRefs)),
      evidence: (c.evidence ?? []).filter((e) => trust(e.ref).trusted),
      basis: BASES.includes(c.basis as EvidenceBasis) ? c.basis : 'observed',
      absence,
      // The consequence of something not being visible is not a fact about the business; nor is a predicted behaviour.
      ...(absence || !soWhatOk ? { soWhat: '' } : {}),
    });
  }

  // The capability check is an absence by definition: it keeps the observation, never a consequence.
  const cc = u.capabilityCheck;
  const capabilityCheck = !cc ? undefined
    : !hasDeclared || isWebsiteHygiene(`${cc.insight} ${cc.soWhat}`) || !trustedRefs(clean(cc.sourceRefs)).length ? undefined
      : { ...cc, soWhat: cc.shown === false ? '' : cc.soWhat, evidence: (cc.evidence ?? []).filter((e) => trust(e.ref).trusted) };

  // How the site presents the business is not a choice the founder declared: "you bet on X" from website copy alone goes.
  const positioning = {
    ...u.positioning,
    summary: !hasDeclared && FOUNDER_CHOICE.test(u.positioning?.summary ?? '') ? '' : (u.positioning?.summary ?? ''),
    implied: clean(u.positioning?.implied).filter((x) => !BEHAVIOUR.test(x) && !ECONOMICS.test(x) && (hasDeclared || !FOUNDER_CHOICE.test(x))),
  };
  // Website detail is not an open business question.
  const offer = { ...u.offer, unclear: clean(u.offer?.unclear).filter((x) => { if (isWebsiteHygiene(x)) { websiteNotes.push(x); return false; } return true; }) };
  const audience = { ...u.audience, unknown: clean(u.audience?.unknown).filter((x) => !isWebsiteHygiene(x)) };

  // Stage evidence from the sitemap or hygiene is not evidence of the business's stage.
  const stage = u.stage ? governStage(u.stage, trustedRefs) : u.stage;

  // The business model: each known claim rests on a trusted source; "declared" needs the founder to have said it.
  // A booking-mechanics line the model filed under acquisition belongs to conversion.
  const proposedModel = (u.read.model ?? []).map((d) => ({ ...d, known: [...(d?.known ?? [])] }));
  const acq = proposedModel.find((d) => d.dimension === 'acquisition');
  if (acq) {
    const moved = acq.known.filter((k) => BOOKING.test(k?.text ?? ''));
    if (moved.length) {
      acq.known = acq.known.filter((k) => !moved.includes(k));
      const conv = proposedModel.find((d) => d.dimension === 'conversion');
      if (conv) conv.known.push(...moved); else proposedModel.push({ dimension: 'conversion', known: moved, unknown: [] });
    }
  }
  const model = MODEL_DIMENSIONS.map((dimension) => {
    const d = proposedModel.find((x) => x?.dimension === dimension);
    const known: ModelClaim[] = [];
    for (const k of d?.known ?? []) {
      const text = (k?.text ?? '').trim();
      if (!text) continue;
      const refs = clean(k.sourceRefs);
      if (SITEMAP.test(text)) { untrusted.push({ finding: text, refs, why: '', reason: 'sitemap' }); continue; }
      if (isWebsiteHygiene(text)) { websiteNotes.push(text); continue; }
      // No behaviour prediction, unsupported unit economics or website-only founder choice is a known fact.
      if (BEHAVIOUR.test(text) || ECONOMICS.test(text) || mixesSourceVoice(text) || (!hasDeclared && FOUNDER_CHOICE.test(text))) { notConcludingExtra.push({ claim: text, why: '', reason: 'unsupported' }); continue; }
      // Every number shown must be grounded: tied to its entity and package in a quote, or an explicit calculation.
      if (numbersIn(text).length && !groundNumbers([text], k.numbers, k.calculations, observations, entities, (r) => trust(r).trusted).ok) {
        notConcludingExtra.push({ claim: text, why: '', reason: 'unsupported' }); continue;
      }
      // "declared" needs the founder to have said it; an "observed" line that adds a conclusion is an inference.
      const proposed: EvidenceBasis = BASES.includes(k.basis) ? k.basis : 'inferred';
      const basis: EvidenceBasis = (proposed === 'declared' && !hasDeclared) || (proposed === 'observed' && (INFERENCE.test(text) || SPECULATION.test(text))) ? 'inferred' : proposed;
      if (basis !== 'inferred' && !trustedRefs(refs).length) { untrusted.push({ finding: text, refs, why: '', reason: reasonOf(refs) }); continue; }
      known.push({ text, basis, sourceRefs: trustedRefs(refs) });
    }
    return { dimension, known, unknown: clean(d?.unknown).filter((x) => !isWebsiteHygiene(x)) };
  });

  // 4. The diagnosis, earned.
  const diagnosis = earnDiagnosis(u.read.diagnosis, { hasDeclared, trustedRefs });

  // 5. Questions, ranked by what their answer could change.
  const shownTensions = contradictions.map((c) => c.tension).filter(Boolean);
  const unknownDims = new Set(model.filter((d) => d.known.length === 0).map((d) => d.dimension));
  const candidates = (u.read.questions ?? [])
    .map((q, i) => ({
      question: (q?.question ?? '').trim(),
      dimension: (MODEL_DIMENSIONS.includes(q?.dimension) ? q.dimension : 'intent') as ModelDimension,
      changes: [...new Set((q?.changes ?? []).filter((x) => STRATEGIC_DECISIONS.includes(x)))] as StrategicDecision[],
      why: (q?.why ?? '').trim(),
      // Metrics that can diverge (clients vs revenue) stay separate answers, even inside one question.
      parts: clean(q?.parts).map((x) => x.replace(/^\(?[a-d1-4][).:]\s*/i, '').trim()).filter(Boolean).slice(0, 4),
      fills: [...new Set((Array.isArray(q?.fills) ? q.fills : []).filter((d): d is ModelDimension => MODEL_DIMENSIONS.includes(d)))],
      order: i,
    }))
    .filter((q) => {
      if (!q.question) return false;
      if (isWebsiteHygiene(q.question)) { websiteNotes.push(q.question); return false; }
      return q.changes.length > 0 && !isHousekeeping(q.question) && !shownTensions.some((t) => sameInsight(q.question, t, 0.4));
    });
  // More strategic decisions it could change first; then a question about a dimension BB knows nothing about; then the
  // model's own order.
  const score = (q: { changes: StrategicDecision[]; dimension: ModelDimension }): number => q.changes.length * 2 + (unknownDims.has(q.dimension) ? 1 : 0);
  const ranked: typeof candidates = [];
  for (const q of [...candidates].sort((a, b) => score(b) - score(a) || a.order - b.order)) {
    if (ranked.some((r) => sameInsight(r.question, q.question, 0.6))) continue;
    ranked.push(q);
  }
  const questions = ranked.map(({ question, dimension, changes, why, parts, fills }) => ({ question, dimension, changes, why, ...(parts.length >= 2 ? { parts } : {}), ...(fills.length ? { fills } : {}) }));

  // STRATEGIC SUFFICIENCY: for an operating business, the variables that could reverse the next strategic decision —
  // the current driver (performance) and how new customers arrive (acquisition) — must be learned before a bet is
  // chosen. Each one still unknown reserves the best-ranked question that would fill it, so a lower-value question can
  // never crowd it out. The founder's goal (intent) is also critical; it has its own step after the conversation.
  const operating = model.some((d) => (d.dimension === 'offer' || d.dimension === 'capacity') && d.known.some((k) => k.basis !== 'inferred'));
  const missing = strategyCriticalUnknowns(model, operating);
  const covers = (q: { dimension: ModelDimension; fills?: ModelDimension[] }, d: ModelDimension): boolean => q.dimension === d || (q.fills ?? []).includes(d);
  const reserved: typeof questions = [];
  for (const d of missing) {
    if (d === 'intent') continue; // the goal step asks it
    const q = questions.find((x) => covers(x, d) && !reserved.includes(x));
    if (q) reserved.push(q);
  }
  const agenda = [...reserved, ...questions.filter((q) => !reserved.includes(q) && q.dimension !== 'intent')];
  const strategyReadiness: NonNullable<UnderstandingRead['strategyReadiness']> = { state: missing.length ? 'not_ready' : 'ready_enough_for_strategy', missing };

  const notConcluding: UnderstandingRead['notConcluding'][number][] = (u.read.notConcluding ?? [])
    .map((n) => ({ claim: (n?.claim ?? '').trim(), why: (n?.why ?? '').trim() }))
    .filter((n) => n.claim && !isWebsiteHygiene(n.claim));
  if (diagnosis.demotion && diagnosis.statement) notConcluding.unshift({ claim: diagnosis.statement, why: '', reason: diagnosis.demotion });
  notConcluding.push(...notConcludingExtra.filter((n) => n.claim));

  for (const x of u.read.untrusted ?? []) {
    const finding = (x?.finding ?? '').trim();
    if (finding && isWebsiteHygiene(finding)) { websiteNotes.push(finding); continue; }
    if (finding) untrusted.push({ finding, refs: clean(x.refs), why: (x.why ?? '').trim(), ...((x.why ?? '').trim() ? {} : { reason: reasonOf(clean(x.refs)) }) });
  }

  const read: UnderstandingRead = {
    model, notConcluding, questions, diagnosis, strategyReadiness,
    ...(u.read.observations?.length ? { observations: u.read.observations } : {}),
    untrusted: dedupeBy(untrusted, (x) => x.finding),
    websiteNotes: [...new Set(websiteNotes)],
  };
  return {
    ...u,
    offer, audience, positioning, contradictions, stage, read,
    ...(capabilityCheck ? { capabilityCheck } : { capabilityCheck: undefined }),
    // The stored "unknowns" ARE the ranked questions (what the conversation asks, what the strategy treats as open).
    // The founder's goal has its own step after the conversation (the goal confirm), so a goal question never takes
    // one of the few agenda slots; it stays in read.questions.
    // Strategy-critical unknowns lead (reserved above); then the rest by information value.
    unknowns: agenda.map((q) => q.question).slice(0, 5),
    // The legacy constraint field follows the earned diagnosis: decided only when it really is the constraint.
    constraint: diagnosis.state === 'constraint'
      ? { decided: true, statement: diagnosis.statement, why: diagnosis.checks.causal?.note ?? '', sourceRefs: diagnosis.sourceRefs }
      : { decided: false, statement: '', why: '', sourceRefs: [] },
  };
}

/**
 * The dimensions still unknown that could reverse the next strategic decision. For an operating business: what it
 * wants (intent), what currently drives it (performance) and how new customers arrive (acquisition). Exported so the
 * strategy step can re-check sufficiency against what the founder has since said.
 */
export function strategyCriticalUnknowns(model: UnderstandingRead['model'], operating: boolean): ModelDimension[] {
  const critical: ModelDimension[] = operating ? ['intent', 'performance', 'acquisition'] : ['intent'];
  return critical.filter((d) => !(model.find((x) => x.dimension === d)?.known.length));
}

const squash = (x: string): string => x.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Text copied from a source (at least six words, verbatim up to punctuation). */
function isLiftedText(text: string, observations: readonly PageObservation[]): boolean {
  const t = squash(text);
  return t.split(' ').length >= 6 && observations.some((o) => squash(o.text).includes(t));
}

function governStage(s: NonNullable<GovernedUnderstanding['stage']>, trustedRefs: (r: string[]) => string[]): NonNullable<GovernedUnderstanding['stage']> {
  const evidence = clean(s.evidence).filter((e) => !SITEMAP.test(e) && !isWebsiteHygiene(e));
  const refs = trustedRefs(clean(s.sourceRefs));
  const sec = s.secondary;
  const secOk = sec && !SITEMAP.test(`${sec.area} ${clean(sec.evidence).join(' ')}`) && !isWebsiteHygiene(`${sec.area} ${clean(sec.evidence).join(' ')}`);
  if (!refs.length || evidence.length < 2) return { stage: 'undetermined', evidence, sourceRefs: refs, secondary: null };
  return { ...s, evidence, sourceRefs: refs, secondary: secOk ? sec : null };
}

/**
 * The diagnosis the model proposed, lowered in code to what the evidence earns. A constraint needs every check passed
 * with a note, a trusted source, a licensed statement, AND the founder's goal (the "causal" check is about the goal:
 * from the website alone nothing can be causally tied to a goal nobody has stated).
 */
export function earnDiagnosis(
  raw: UnderstandingRead['diagnosis'] | undefined,
  ctx: { hasDeclared: boolean; trustedRefs: (r: string[]) => string[] },
): UnderstandingRead['diagnosis'] {
  const statement = (raw?.statement ?? '').trim();
  const checks: UnderstandingRead['diagnosis']['checks'] = {};
  for (const k of DIAGNOSIS_CHECKS) {
    const c = raw?.checks?.[k];
    if (c) checks[k] = { pass: c.pass === true && Boolean((c.note ?? '').trim()), note: (c.note ?? '').trim() };
  }
  const refs = ctx.trustedRefs(clean(raw?.sourceRefs));
  if (!statement || isWebsiteHygiene(statement) || isHousekeeping(statement) || makesUnlicensedClaim(statement)) {
    return { state: 'not_ready', statement: '', checks, sourceRefs: [], ...(statement ? { demotedBecause: 'it is about the website, or makes a claim the sources cannot support' } : {}) };
  }
  if (!refs.length) return { state: 'not_ready', statement, checks, sourceRefs: [], demotedBecause: 'nothing BB trusts in the sources supports it yet' };
  const proposed = raw?.state === 'constraint' ? 'constraint' : 'hypothesis';
  if (proposed === 'hypothesis') return { state: 'hypothesis', statement, checks, sourceRefs: refs };
  const failing = DIAGNOSIS_CHECKS.filter((k) => !checks[k]?.pass);
  if (!ctx.hasDeclared) {
    return { state: 'hypothesis', statement, checks: { ...checks, causal: { pass: false, note: checks.causal?.note ?? '' } }, sourceRefs: refs,
      demotedBecause: 'the founder\'s goal is not known yet, so nothing can be called the constraint on it', demotion: 'no_goal' };
  }
  if (failing.length) return { state: 'hypothesis', statement, checks, sourceRefs: refs, demotedBecause: `not established yet: ${failing.join(', ')}`, demotion: 'not_established' };
  return { state: 'constraint', statement, checks, sourceRefs: refs };
}

/**
 * Aha findings under the SAME discipline as the understanding (they feed strategy later): nothing resting only on
 * untrusted sources, no website hygiene, no behaviour prediction, no unsupported unit economics, no speculation, no
 * website-only founder choice, and no absence elevated to an insight before the founder's goal is known. An implication
 * that predicts behaviour, speculates or claims economics is cleared; the finding stays only if it holds on its own.
 */
export function governFindings(aha: AhaResult, observations: readonly PageObservation[], opts: AhaGovernanceOptions = {}): AhaResult {
  return governFindingsDetailed(aha, observations, opts).aha;
}

export interface AhaGovernanceOptions {
  /** v2 syntheses must name why a finding matters and the decision it could change (older outputs could not). */
  readonly requireDecision?: boolean;
  /** The business's named entities (offers, packages, locations): specificity + numeric grounding. */
  readonly entities?: string[];
}
/** One Aha candidate's verdict, for the audit trail: kept as an insight, demoted to an observation, or dropped. */
export interface AhaAuditEntry {
  readonly finding: string;
  readonly matters: string;
  readonly changes: string[];
  readonly verdict: 'kept' | 'demoted' | 'dropped';
  readonly reason: string;
  readonly grounding: { readonly numbers: { value: number; entity: string; qualifier: string | null; ref: string }[]; readonly calculations: { operation: string; operands: number[]; result: number; ok: boolean }[] };
}

/**
 * The same, plus what was DEMOTED or DROPPED and why. A fact is not an insight:
 *  - DROPPED (not stored at all): resting on untrusted sources, website hygiene, behaviour / economics / speculation /
 *    founder-choice / mixed voice in the finding, an absence before the founder's goal, or a number that is not grounded
 *    (tied to its entity and package in a quote, or an explicit calculation);
 *  - DEMOTED to an observation (true, but not an insight): no decision it could change, no reason it matters, a reason
 *    that speculates, needs data BB does not have (duration, utilisation, demand), claims how customers arrive, or is
 *    generic (it names nothing specific to this business).
 * No quota: zero findings is better than filler.
 */
export function governFindingsDetailed(aha: AhaResult, observations: readonly PageObservation[], opts: AhaGovernanceOptions = {}): { aha: AhaResult; demoted: { text: string; sourceRefs: string[]; reason: string }[]; audit: AhaAuditEntry[] } {
  // The decision requirement applies to v2 syntheses (the prompt asks for "matters" + "changes"); an older output that
  // could not carry them keeps the epistemic rules only.
  const requireDecision = opts.requireDecision ?? true;
  const entities = opts.entities ?? [];
  const trust = trustByRef(observations);
  const hasDeclared = observations.some((o) => o.provenance === 'declared');
  const unsupported = (t: string): boolean => BEHAVIOUR.test(t) || ECONOMICS.test(t) || SPECULATION.test(t) || mixesSourceVoice(t) || (!hasDeclared && FOUNDER_CHOICE.test(t));
  const demoted: { text: string; sourceRefs: string[]; reason: string }[] = [];
  const audit: AhaAuditEntry[] = [];
  const kept: AhaResult['findings'][number][] = [];
  for (const raw of aha?.findings ?? []) {
    const finding = (raw.finding ?? '').trim();
    const matters = (raw.matters ?? '').trim();
    const changes = (raw.changes ?? []).filter((x) => STRATEGIC_DECISIONS.includes(x));
    const refs = clean(raw.sourceRefs);
    const g = groundNumbers([finding, matters], raw.numbers, raw.calculations, observations, entities, (r) => trust(r).trusted);
    const entry = (verdict: AhaAuditEntry['verdict'], reason: string): void => {
      audit.push({ finding, matters, changes, verdict, reason, grounding: { numbers: g.grounded, calculations: g.calculations } });
      if (verdict === 'demoted') demoted.push({ text: finding, sourceRefs: refs, reason });
    };
    // Dropped: not credible as stored text.
    if (!finding) continue;
    if (SITEMAP.test(finding) || isWebsiteHygiene(finding)) { entry('dropped', 'website hygiene or sitemap'); continue; }
    if (!refs.some((r) => trust(r).trusted)) { entry('dropped', 'no trusted source'); continue; }
    if (unsupported(finding)) { entry('dropped', 'the finding predicts behaviour, claims economics, speculates or mixes voices'); continue; }
    if (ABSENCE.test(finding) && !hasDeclared) { entry('dropped', 'an absence, before the founder\'s goal is known'); continue; }
    if (requireDecision && !g.ok) { entry('dropped', `number not grounded: ${g.problems.join('; ')}`); continue; }
    if (requireDecision && raw.evidence?.length && !anchorClaimEvidence(raw.evidence, observations).length && !g.grounded.length) { entry('dropped', 'its evidence is not on the cited page'); continue; }
    // Implication: cleared when it speculates, claims economics or shows an ungrounded number.
    const impl = (raw.implication ?? '').trim();
    const implOk = !impl || (!unsupported(impl) && !INFERENCE.test(impl) && (!requireDecision || groundNumbers([impl], raw.numbers, raw.calculations, observations, entities, (r) => trust(r).trusted).ok));
    const f = implOk ? raw : { ...raw, implication: '' };
    if (!requireDecision) { kept.push(f); entry('kept', 'older synthesis: epistemic rules only'); continue; }
    // Demoted: true, but not an insight.
    if (!changes.length || !matters) { entry('demoted', 'it names no decision it could change, or no reason it matters'); continue; }
    if (unsupported(matters) || INFERENCE.test(matters) || MODAL.test(matters)) { entry('demoted', 'why it matters speculates or claims behaviour / economics'); continue; }
    if (NEEDS_UNKNOWN.test(matters)) { entry('demoted', 'why it matters needs data BB does not have (duration, utilisation, demand)'); continue; }
    if (!hasDeclared && ARRIVAL.test(matters)) { entry('demoted', 'why it matters claims how customers arrive, which is unknown'); continue; }
    const specific = entities.some((e) => fold(matters).includes(fold(e))) || numbersIn(matters).length > 0;
    if (!specific) { entry('demoted', 'why it matters is generic: it names nothing specific to this business'); continue; }
    kept.push(f);
    entry('kept', 'grounded, specific, and it names the decision it could change');
  }
  return { aha: { ...aha, findings: kept }, demoted, audit };
}

const fold = (x: string): string => (x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function dedupeBy<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => { const k = key(x).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

export type { DiagnosisCheck };
