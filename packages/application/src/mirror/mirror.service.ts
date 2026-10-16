import { agendaUnknowns, claimTermsIn, type IUnderstandingSnapshotRepository, type GovernedUnderstanding } from '../bi/index';
import type { IFounderStateRepository, FounderStateItem } from '../conversation/index';
import { isHeldGoal } from '../conversation/goal-candidate';
import type { StrategyVersionRecord } from '../strategy/index';
import type {
  IMirrorModelPort,
  MirrorExchange,
  MirrorHypothesisUpdate,
  MirrorLaneItem,
  MirrorMismatch,
  MirrorRead,
  MirrorReadField,
  MirrorReadGrounding,
  MirrorReadInput,
  MirrorReadOutput,
  MirrorView,
} from './contracts';

/** The founder_state scope tag that marks a self-narrative statement (the mirror's Lane 3). */
export const FOUNDER_SELF_SCOPE = 'founder_self';

/** Narrow strategy read — the held bet contextualizes contrast (a refusal the strategy depends on, etc.). */
export interface MirrorStrategyPort {
  getCurrent(businessId: string): Promise<{ record: StrategyVersionRecord; adoptedAt: string | null } | null>;
}

export interface MirrorDeps {
  understanding: IUnderstandingSnapshotRepository;
  state: IFounderStateRepository;
  strategy: MirrorStrategyPort;
  model: IMirrorModelPort;
  log?: (e: { type: string; detail?: string }) => void;
}

const clean = (xs?: (string | null | undefined)[]): string[] => (xs ?? []).map((x) => (x ?? '').trim()).filter(Boolean);

/** Lane 1 — what BB OBSERVED, from the understanding snapshot, provenance preserved. */
function projectObserved(u: GovernedUnderstanding | null): MirrorLaneItem[] {
  if (!u) return [];
  const items: MirrorLaneItem[] = [];
  if (u.offer?.summary?.trim()) items.push({ labelKey: 'mirror.lbl.offer', statement: u.offer.summary.trim(), provenance: 'observed', sources: clean(u.offer.sourceRefs) });
  if (u.positioning?.summary?.trim()) items.push({ labelKey: 'mirror.lbl.positioning', statement: u.positioning.summary.trim(), provenance: clean(u.positioning.evidenceBacked).length ? 'observed' : 'inferred', sources: clean(u.positioning.sourceRefs) });
  const audience = clean(u.audience?.addressed);
  if (audience.length) items.push({ labelKey: 'mirror.lbl.audience', statement: audience.join(' · '), provenance: 'observed', sources: clean(u.audience?.sourceRefs) });
  const acquisition = clean(u.acquisition?.visiblePaths);
  if (acquisition.length) items.push({ labelKey: 'mirror.lbl.acquisition', statement: acquisition.join(' · '), provenance: 'observed', sources: clean(u.acquisition?.sourceRefs) });
  const themes = clean(u.messaging?.recurringThemes);
  if (themes.length) items.push({ labelKey: 'mirror.lbl.messaging', statement: themes.join(' · '), provenance: 'observed', sources: clean(u.messaging?.sourceRefs) });
  for (const x of clean(u.unknowns).slice(0, 4)) items.push({ labelKey: 'mirror.lbl.unknown', statement: x, provenance: 'unknown' });
  return items;
}

// founder_state kind → i18n key. The web renders these in the founder's language (no English from the backend).
const KIND_LABEL_KEY: Record<string, string> = {
  goal: 'mirror.lbl.kind.goal', horizon: 'mirror.lbl.kind.horizon', constraint: 'mirror.lbl.kind.constraint',
  preference: 'mirror.lbl.kind.preference', decision: 'mirror.lbl.kind.decision', intention: 'mirror.lbl.kind.intention',
  resource: 'mirror.lbl.kind.resource', challenge_permission: 'mirror.lbl.kind.challenge_permission',
  business_correction: 'mirror.lbl.kind.business_correction',
};

/** Lane 2 — what the founder told BB about the BUSINESS (declared facts, scope≠self). */
function projectBusiness(items: FounderStateItem[]): MirrorLaneItem[] {
  return items
    .filter((s) => s.scope !== FOUNDER_SELF_SCOPE)
    .map((s) => ({ labelKey: KIND_LABEL_KEY[s.kind] ?? 'mirror.lbl.kind.default', statement: s.statement.trim(), provenance: 'declared' as const }))
    .filter((i) => i.statement);
}

/** Lane 3 — what the founder told BB about THEMSELVES (self-narrative, scope='founder_self'). */
function projectSelf(items: FounderStateItem[]): MirrorLaneItem[] {
  return items
    .filter((s) => s.scope === FOUNDER_SELF_SCOPE)
    .map((s) => ({ labelKey: 'mirror.lbl.inYourWords', statement: s.statement.trim(), provenance: 'declared' as const }))
    .filter((i) => i.statement);
}

const MAX_CONTRASTS = 6;

/**
 * The site is one channel, not the business (operator, 2026-10-12: QuFi's mirror held "a signed pilot in 60 days"
 * against "no contact form, no sign-up, no enquiry path", but the buyer is a bank already in conversation). A
 * contrast against a MISSING site path is dropped when the founder's own words show a relationship-led sale.
 */
const SITE_PATH_GAP = /\b(contact form|sign[- ]?up|waitlist|wait list|enquir|inquir|booking|book a call|demo request|request a demo|pricing page|no (?:visible )?(?:way|path|route) (?:to|for)|no (?:clear )?(?:call to action|cta)|landing page)\b/i;
const RELATIONSHIP_SALE = /\b(relationship|warm|introduc|already met|in conversation|conversations? with|pipeline|referr|network of|asked (?:us )?twice|waiting (?:on|for)|named buyer|mid-tier|security team|procurement|pilot discussions?|directly)\b/i;
export const isQuestion = (x: string): boolean => /\?\s*['"”’]?\s*$/.test((x ?? '').trim()) || /^(?:which|what|who|whether|how|why|when|where|is|are|does|do)\b/i.test((x ?? '').trim());

export function siteGapIrrelevant(against: string, founderBusinessWords: readonly string[]): boolean {
  return SITE_PATH_GAP.test(against ?? '') && founderBusinessWords.some((w) => RELATIONSHIP_SALE.test(w ?? ''));
}

export class MirrorService {
  constructor(private readonly deps: MirrorDeps) {}

  /**
   * Build the mirror: three lanes projected from existing state + a grounded contrast. The contrast model
   * finds only REAL mismatches; the service then hard-guards that BOTH cited sides and the tension are present
   * (never a one-sided or fabricated contrast) and caps the count — quality over quantity.
   */
  async build(businessId: string, businessName: string, language: string, context: { exchanges?: MirrorExchange[] } = {}): Promise<MirrorView> {
    const snap = await this.deps.understanding.latest(businessId);
    const states = await this.deps.state.listActive(businessId);
    const held = await this.deps.strategy.getCurrent(businessId);

    const observed = projectObserved(snap?.understanding ?? null);
    const business = projectBusiness(states);
    const self = projectSelf(states);

    const core = held?.record.bundle.core ?? null;
    const heldStrategy = core
      ? { bet: core.coreBet.priority, notNow: (core.notNow ?? []).map((n) => n.item).filter(Boolean), reconsider: (core.reconsiderTriggers ?? []).map((r) => r.condition).filter(Boolean) }
      : null;

    // The UPDATED READ runs beside the contrast (never instead of it): its failure leaves the contrast standing.
    const readInput = updatedReadInput(snap?.understanding ?? null, states, context.exchanges ?? [], businessName, language, observed, business);
    const readOut = readInput && this.deps.model.readUpdate
      ? this.deps.model.readUpdate(readInput).catch(() => null)
      : Promise.resolve(null);

    let contrasts: MirrorMismatch[] = [];
    // A contrast needs at least the founder's own words on one side and something to hold them against.
    if ((business.length + self.length) > 0 && (observed.length + business.length + self.length) > 1) {
      const out = await this.deps.model.contrast({
        businessName, interfaceLanguage: language,
        observed: observed.map((i) => i.statement),
        business: business.map((i) => i.statement),
        self: self.map((i) => i.statement),
        heldStrategy,
      });
      contrasts = (out.mismatches ?? [])
        // Structural completeness: both sides + a tension, founder side from a real lane.
        .filter((m) => m.founderWords?.trim() && m.against?.trim() && m.tension?.trim() && (m.founderLane === 'business' || m.founderLane === 'self'))
        // Anti-fabrication: a mirror contrasts ACROSS lanes — the founder's words vs what BB observed, another lane,
        // or the held strategy. A SAME-LANE contrast (business-vs-business, self-vs-self) is the fabrication pattern:
        // the model reaches across two unrelated same-lane facts and invents a tension (e.g. "no physio at Bună Ziua"
        // vs "specialise Decebal on medical" — two business facts about different locations that do not conflict).
        // Reject those; every legitimate cross-lane tension (incl. told-vs-observed) survives.
        .filter((m) => m.founderLane !== m.againstLane)
        // A question is never evidence: an open unknown cannot be the "I saw" side of a contrast (2026-10-12).
        .filter((m) => !isQuestion(m.against))
        // The site is one channel: no 'missing site path' contrast when the founder sells through relationships.
        .filter((m) => !(m.againstLane === 'observed' && siteGapIrrelevant(`${m.against} ${m.tension}`, [...business, ...self].map((i) => i.statement))))
        .slice(0, MAX_CONTRASTS);
    }

    const governed = readInput ? governReadUpdate(await readOut, readInput) : null;
    if (governed) this.deps.log?.({ type: 'mirror_read', detail: JSON.stringify({ businessId, fields: Object.keys(governed.read ?? {}), audit: governed.audit }) });
    return {
      observed, business, self, contrasts, hasSelf: self.length > 0,
      ...(governed?.read ? { read: governed.read } : {}),
      ...(governed ? { readAudit: governed.audit } : {}),
    };
  }
}

// ── UPDATED READ (2026-10-16) ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The read input from stored state only: the structural synthesis and kept hypotheses the understanding card showed,
 * the questions it asked, the founder's answers paired to them, the held goal and the facts already in the lanes.
 * null when there is nothing to update (no structural read, or the founder answered nothing).
 */
export function updatedReadInput(
  u: GovernedUnderstanding | null, states: FounderStateItem[], exchanges: MirrorExchange[], businessName: string, language: string,
  observed: MirrorLaneItem[], business: MirrorLaneItem[],
): MirrorReadInput | null {
  const st = u?.read?.structure;
  const answered = exchanges.filter((e) => e.answer.trim() && !/^\(skip\)$/i.test(e.answer.trim()));
  if (!st || !st.synthesis.trim() || !answered.length) return null;
  const goal = states.find((x) => isHeldGoal(x))?.statement.trim() || null;
  // A skipped question leaves the hypothesis it was asked to decide (its B tier `resolves`) unresolved.
  const skipped = exchanges.filter((e) => /^\(skip\)$/i.test(e.answer.trim()));
  const unresolved = [...new Set((u?.read?.questionTiers ?? [])
    .filter((t) => t.tier === 'B' && t.resolves !== undefined && skipped.some((e) => e.asked.trim().endsWith(t.question.trim())))
    .map((t) => t.resolves!))];
  return {
    businessName, interfaceLanguage: language,
    synthesis: st.synthesis.trim(),
    hypotheses: st.hypotheses.map((h) => ({
      interpretation: h.interpretation, evidence: (h.evidence ?? []).map((e) => e.quote).filter(Boolean),
      alternative: h.alternative, unknown: h.discriminator?.unknown ?? '', question: h.discriminator?.question ?? '', reversal: h.reversal,
    })),
    questions: agendaUnknowns(u).slice(0, 3),
    exchanges,
    goal,
    observed: observed.map((i) => i.statement),
    business: business.filter((i) => !goal || i.statement !== goal).map((i) => i.statement),
    ...(unresolved.length ? { unresolved } : {}),
  };
}

/**
 * CONSERVATIVE LANGUAGE (2026-10-16): escalations beyond what the founder established. "Brings less" is a fact;
 * "stagnates / is not growing" is not. "Comes from referrals" is a fact; "exclusively / no channel at all" is not. Also
 * "the biggest potential", "in the right place", and magnitude words. A sentence using one is removed unless the
 * founder's OWN words used it. Word-start match, so a term never fires inside a longer unrelated word.
 */
const ESCALATIONS = [
  // performance direction
  'stagn', 'nu crește', 'nu creste', 'nu mai crește', 'nu mai creste', 'în scădere', 'in scadere', 'declin',
  'not growing', "isn't growing", 'is not growing', 'shrink', 'non cresce', 'in calo', 'ristagn', 'wächst nicht', 'schrumpf',
  // exclusivity from an absence of named channels
  'exclusiv', 'numai din', 'only from', 'solely', 'esclusivamente', 'solo da', 'ausschließlich', 'nur aus',
  'niciun canal', 'fără niciun', 'fara niciun', 'no channel', 'nessun canale', 'kein kanal', 'nu există nimeni', 'nu exista nimeni', 'nobody', 'nessuno', 'niemand',
  // potential / placement / magnitude
  'cel mai mare potențial', 'cel mai mare potential', 'potențialul cel mai mare', 'highest potential', 'biggest potential', 'most potential',
  'maggior potenziale', 'potenziale più alto', 'größte potenzial', 'unde trebuie', 'locul potrivit', 'right place', 'where it should be',
  'al posto giusto', 'am richtigen ort', 'cel mai mare gap', 'biggest gap', 'enorm', 'masiv', 'uriaș', 'urias', 'huge', 'massive', 'riesig',
];
const startsAt = (t: string, term: string): boolean => {
  for (let i = t.indexOf(term); i !== -1; i = t.indexOf(term, i + 1)) if (i === 0 || !/[\p{L}\p{N}]/u.test(t[i - 1]!)) return true;
  return false;
};
const escalationsIn = (text: string): string[] => { const t = text.toLowerCase(); return ESCALATIONS.filter((e) => startsAt(t, e)); };
const sentencesOf = (t: string): string[] => (t.match(/[^.!?]+(?:[.!?]+["”»)]*|$)/gu) ?? []).map((x) => x.trim()).filter(Boolean);
/** Launch length per section (sentences). "matters" is folded into "next" and not shown at launch. */
const MAX_SENTENCES: Record<MirrorReadField, number> = { now: 2, changed: 2, matters: 0, next: 2 };

const MOVED = new Set(['strengthened', 'weakened', 'reversed', 'sharpened']);
const STATUSES = new Set([...MOVED, 'unresolved']);
const FIELD_ORDER: MirrorReadField[] = ['now', 'changed', 'matters', 'next'];
const contentWords = (t: string): string[] => (t.toLowerCase().match(/\p{L}{4,}/gu) ?? []);
/** A field that only restates what the founder said (most of its words are the founder's own) is not a read. */
function restatesAnswers(text: string, answers: string): boolean {
  const own = new Set(contentWords(answers));
  const w = contentWords(text);
  return w.length > 0 && w.filter((x) => own.has(x)).length / w.length >= 0.7;
}

/**
 * Deterministic governance of the updated read. A field is kept only when it is real text (not a question, not a
 * label), grounded in at least one real founder answer, not a restatement of the answers, and uses no claim term
 * (trust, retention, unique…) the founder's own words did not license. "What changed" additionally needs a prior
 * hypothesis the answers actually moved. Without "now" there is no read (the contrast stays the fallback).
 */
export function governReadUpdate(out: MirrorReadOutput | null, input: MirrorReadInput): { read?: MirrorRead; audit: NonNullable<MirrorView['readAudit']> } | null {
  if (!out) return null;
  const dropped: { field: string; reason: string }[] = [];
  // A hypothesis whose deciding question was skipped stays unresolved, whatever the model concluded.
  const hypotheses: MirrorHypothesisUpdate[] = (out.hypotheses ?? [])
    .filter((h) => Number.isInteger(h.index) && h.index >= 0 && h.index < input.hypotheses.length && STATUSES.has(h.status))
    .map((h) => ((input.unresolved ?? []).includes(h.index) && h.status !== 'unresolved' ? { ...h, status: 'unresolved' as const, because: `deciding question skipped (model said ${h.status}): ${h.because}` } : h));
  const valid = new Set(input.exchanges.map((e, i) => (e.answer.trim() && !/^\(skip\)$/i.test(e.answer.trim()) ? i : -1)).filter((i) => i >= 0));
  const founderWords = [...input.exchanges.map((e) => e.answer), input.goal ?? '', ...input.business].join(' ');
  const licensed = new Set(claimTermsIn(founderWords));
  // Escalations are licensed only by what the founder literally said (answers, goal), never by BB's own paraphrases.
  const founderSaid = new Set(escalationsIn([...input.exchanges.map((e) => e.answer), input.goal ?? ''].join(' ')));
  const grounding: MirrorReadGrounding[] = [];
  const read: Partial<Record<MirrorReadField, string>> = {};
  for (const f of out.fields ?? []) {
    if (!FIELD_ORDER.includes(f.field) || read[f.field]) continue;
    if (!MAX_SENTENCES[f.field]) { dropped.push({ field: f.field, reason: 'not shown at launch (folded into next)' }); continue; }
    // Conservative pass: drop only the sentences that escalate beyond what the founder said, then cap the length.
    // Claim terms (trust, retention, conversion…) are claims in a reading; in "next" they are what BB would check.
    const kept = sentencesOf((f.text ?? '').trim()).filter((x) => {
      const over = escalationsIn(x).filter((e) => !founderSaid.has(e));
      if (over.length) dropped.push({ field: f.field, reason: `escalation (${over.join(', ')}): ${x}` });
      const claims = f.field === 'next' ? [] : claimTermsIn(x).filter((t) => !licensed.has(t));
      if (claims.length) dropped.push({ field: f.field, reason: `a claim the founder did not license (${claims.join(', ')}): ${x}` });
      return !over.length && !claims.length;
    });
    const text = kept.slice(0, MAX_SENTENCES[f.field]).join(' ');
    const answers = (f.answers ?? []).filter((i) => valid.has(i));
    const why = !text ? 'empty'
      : /\?\s*$/.test(text) ? 'a question'
        : /\b(hypothes|ipotez|ipotes|hypothès)\p{L}*/iu.test(text) || /\b(strengthened|weakened|reversed|unresolved|sharpened)\b/i.test(text) ? 'exposes the reasoning labels'
          : !answers.length ? 'not grounded in a founder answer'
            : restatesAnswers(text, input.exchanges.map((e) => e.answer).join(' ')) ? 'restates the answers'
              : f.field === 'changed' && !hypotheses.some((h) => MOVED.has(h.status)) ? 'no prior read actually moved'
                  : '';
    if (why) { dropped.push({ field: f.field, reason: why }); continue; }
    read[f.field] = text;
    grounding.push({ field: f.field, answers, evidence: (f.evidence ?? []).filter((x) => typeof x === 'string') });
  }
  const audit = { grounding, hypotheses, dropped };
  if (!read.now) return { audit };
  return { read: { now: read.now, ...(read.changed ? { changed: read.changed } : {}), ...(read.next ? { next: read.next } : {}) }, audit };
}
