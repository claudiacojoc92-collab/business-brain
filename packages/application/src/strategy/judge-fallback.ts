import { stemOverlap } from '../bi/index';
import type { StrategyBundle, StrategyJudgeVerdict } from './contracts';
import { CAPACITY, VALIDATING, validateStrategy, type StrategyContextForGate } from './validation';

/**
 * NON-ITERATIVE CLOSE OF THE JUDGED LAYER (2026-10-17). The model judge may still reject a strategy after its allowed
 * repairs. Two deterministic rules decide what happens then, without another model call:
 *  - a capacity the bet depends on and the evidence does not establish becomes a check BEFORE the bet (never assumed);
 *  - a judge failure that points only at secondary parts (a channel after the first, a decision, optional explanatory
 *    copy) drops those parts instead of failing the strategy. The diagnosis and the core bet are never dropped: a
 *    failure that touches them, or that cannot be traced to a part, still fails closed.
 */

const sentencesIn = (text: string): string[] => (text.match(/[^.!?]+[.!?]*/gu) ?? []).map((x) => x.trim()).filter(Boolean);
const stemCount = (t: string): number => stemOverlap(t, t);

/** Evidence lines that state something (an "Unknown:" or a "Tension:" line names a gap, not a fact). */
function establishedEvidence(ctx: StrategyContextForGate): string {
  return [...ctx.business.map((b) => b.text).filter((t) => !/^(Unknown|Tension):/u.test(t)), ...ctx.founder.map((f) => f.statement)].join(' ');
}

const SUBJECT = /(?:^|(?:dac[ăa]|if|se|wenn)\s+)(.+?)\s+(?:nu\s+|not\s+|doesn't\s+|does not\s+|don't\s+|do not\s+|non\s+|nicht\s+)?(are|au|has|have|ha|hanno|hat|haben)\s+(?:\p{L}+\s+){0,2}?(?:capacit|capacity|locuri|sloturi|slots|disponibil|posti|kapazit)/iu;
const ARTICLE_NOUN = /^(\p{L}+(?:ul|ului|a|le|ii|ele)|the|a|an|il|la|lo|i|gli|le|un|una|uno|der|die|das|ein|eine)$/iu;
/**
 * Who delivers, and the verb the evidence used for them ("Kinetoterapeuții de la X au capacitate…" → "kinetoterapeuții
 * de la X", "au"). Reusing that verb keeps the check grammatical for any subject (2026-10-17: "are kinetoterapeuții").
 * A negated "doesn't have" becomes "has" (the check asks how many slots there are). Generic, never business-specific.
 */
const AFFIRMATIVE: Record<string, string> = { "doesn't": 'has', 'does not': 'has' };
function deliverer(sentence: string): { who: string; verb: string } | null {
  const m = sentence.match(SUBJECT);
  const who = (m?.[1] ?? '').trim().replace(/^(?:dac[ăa]|if|se|wenn)\s+/iu, ''); // a trigger starts with "if"
  if (!who || !m?.[2] || who.split(/\s+/u).length > 8 || CAPACITY.test(who)) return null;
  const first = who.split(/\s+/u)[0]!;
  const neg = sentence.match(/\s(doesn't|does not)\s/iu)?.[1]?.toLowerCase();
  const verb = neg ? AFFIRMATIVE[neg]! : m[2].toLowerCase();
  return { who: ARTICLE_NOUN.test(first) ? who.charAt(0).toLowerCase() + who.slice(1) : who, verb };
}
const PREREQUISITE: Record<string, { named: (who: string, verb: string) => string; generic: string }> = {
  ro: { named: (who, verb) => `Înainte să aduci cerere nouă, verifici câte locuri libere pe săptămână ${verb} ${who}.`, generic: 'Înainte să aduci cerere nouă, verifici câtă capacitate liberă pe săptămână ai pentru acest serviciu.' },
  en: { named: (who, verb) => `Before you bring in new demand, check how many free slots per week ${who} ${verb}.`, generic: 'Before you bring in new demand, check how much free capacity per week you have for this service.' },
  it: { named: (who, verb) => `Prima di portare nuova domanda, verifica quanti posti liberi a settimana ${verb} ${who}.`, generic: 'Prima di portare nuova domanda, verifica quanta capacità libera a settimana hai per questo servizio.' },
  de: { named: (who, verb) => `Bevor du neue Nachfrage bringst, prüfe, wie viele freie Termine pro Woche ${who} ${verb}.`, generic: 'Bevor du neue Nachfrage bringst, prüfe, wie viel freie Kapazität pro Woche du für dieses Angebot hast.' },
};
/** The verb belongs to the sentence's language; one from another language (an English assumption in a Romanian
 *  strategy) cannot be reused, so the generic line is used instead. */
const VERBS: Record<string, Set<string>> = { ro: new Set(['are', 'au']), en: new Set(['has', 'have']), it: new Set(['ha', 'hanno']), de: new Set(['hat', 'haben']) };
/** A sentence of the bet's resource reasoning that already makes capacity a check. */
const hasCapacityCheck = (b: StrategyBundle): boolean => sentencesIn(b.core.coreBet?.resourceFit ?? '').some((s) => CAPACITY.test(s) && VALIDATING.test(s));

/**
 * CAPACITY PRECONDITION: the bet depends on delivery capacity (an assumption, trigger or bet field names it) and the
 * evidence does not establish it ⇒ "verify available delivery capacity before increasing demand" goes first in the
 * bet's resource reasoning. Idempotent.
 */
export function addCapacityPrerequisite(bundle: StrategyBundle, ctx: StrategyContextForGate, language: string): { bundle: StrategyBundle; added: string | null } {
  if (hasCapacityCheck(bundle) || CAPACITY.test(establishedEvidence(ctx))) return { bundle, added: null };
  const c = bundle.core;
  const bet = c.coreBet;
  const named = [...(c.assumptions ?? []).map((a) => a.statement), ...(c.reconsiderTriggers ?? []).map((t) => t.condition), bet?.resourceFit ?? '', bet?.founderFit ?? '', bet?.priority ?? '']
    .flatMap(sentencesIn).find((s) => CAPACITY.test(s));
  if (!named) return { bundle, added: null };
  const lang = PREREQUISITE[language.slice(0, 2)] ? language.slice(0, 2) : 'en';
  const t = PREREQUISITE[lang]!;
  const d = deliverer(named);
  const added = d && VERBS[lang]!.has(d.verb) ? t.named(d.who, d.verb) : t.generic;
  // Shown on its own ("Before you start") and kept first in the bet's resource reasoning, where the judge and the plan read it.
  return { bundle: { ...bundle, core: { ...c, prerequisites: [...(c.prerequisites ?? []), added], coreBet: { ...bet, resourceFit: [added, bet.resourceFit ?? ''].filter(Boolean).join(' ') } } }, added };
}

/**
 * NOT NOW, BECAUSE SOMETHING IS VALIDATED FIRST: "not X yet, because Y must be validated first" engages the opposite.
 * The reason has to say both the sequence (yet / first / before / until) and what is being validated.
 */
const SEQUENCE = /(?<!\p{L})([îi]nc[ăa]|mai [îi]nt[âa]i|[îi]nt[âa]i|[îi]nainte|p[âa]n[ăa] (?:nu|c[âa]nd|la)|yet|first|before|until|ancora|prima|finch[ée]|noch nicht|zuerst|bevor)(?!\p{L})/iu;
export const engagesBySequence = (reason: string): boolean => SEQUENCE.test(reason) && VALIDATING.test(reason);

type Ref = { kind: 'channel'; index: number } | { kind: 'decision'; key: string; present: boolean } | { kind: 'copy'; field: string; sentence: string } | { kind: 'central'; field: string };
/** Quoted fragments in a judge reason ('…', "…", “…”, ‘…’, «…»). */
const quotesIn = (reason: string): string[] => [...reason.matchAll(/['"“‘«]([^'"”’»]{3,200})['"”’»]/gu)].map((m) => m[1]!.trim());
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)+$/u;
/** A fragment matches a text when most of its stems are there (the judge paraphrases). */
const matches = (fragment: string, text: string): boolean => { const n = stemCount(fragment); return n >= 2 && stemOverlap(fragment, text) / n >= 0.6; };

function refsOf(reason: string, b: StrategyBundle): Ref[] {
  const refs: Ref[] = [];
  const decisions = b.decisions ?? [];
  for (const d of decisions) if (reason.includes(d.key)) refs.push({ kind: 'decision', key: d.key, present: true });
  const c = b.core;
  const central: [string, string][] = [['diagnosis', c.diagnosis ?? ''], ['coreBet', [c.coreBet?.priority, c.coreBet?.deprioritized].join(' ')], ['offerDirection', c.offerDirection ?? ''], ['positioningDirection', c.positioningDirection ?? '']];
  const channels = b.branch?.channelPriorities ?? [];
  for (const q of quotesIn(reason)) {
    if (KEY.test(q)) { if (!decisions.some((d) => d.key === q)) refs.push({ kind: 'decision', key: q, present: false }); continue; }
    const hit = central.find(([, text]) => matches(q, text));
    if (hit) { refs.push({ kind: 'central', field: hit[0] }); continue; }
    const i = channels.findIndex((x) => matches(q, [x.channel, x.whyGoal, x.whyAudience, x.whyResource, x.overAlternative].join(' ')));
    if (i > 0) { refs.push({ kind: 'channel', index: i }); continue; }
    if (i === 0) {
      const ch = channels[0]!;
      const field = (['whyAudience', 'whyResource', 'overAlternative'] as const).find((f) => matches(q, ch[f] ?? ''));
      const sentence = field ? sentencesIn(ch[field] ?? '').find((s) => matches(q, s)) : undefined;
      refs.push(field && sentence ? { kind: 'copy', field: `channel[0].${field}`, sentence } : { kind: 'central', field: 'channel[0]' });
    }
  }
  return refs;
}

export interface JudgeFallbackResult {
  readonly bundle: StrategyBundle;
  /** Each failed dimension and how it was settled, for the gate results and the log. */
  readonly resolved: { dimension: string; how: string }[];
  readonly unresolved: StrategyJudgeVerdict[];
}

/** Settle the judge failures left after the allowed repairs, or report the ones that must still fail closed. */
export function resolveJudgeFailures(bundle: StrategyBundle, failed: readonly StrategyJudgeVerdict[], ctx: StrategyContextForGate): JudgeFallbackResult {
  let b = bundle;
  const resolved: { dimension: string; how: string }[] = [];
  const unresolved: StrategyJudgeVerdict[] = [];
  const dropChannels = new Set<number>();
  const dropDecisions = new Set<string>();
  const dropCopy: { field: string; sentence: string }[] = [];
  for (const v of failed) {
    if (v.dimension === 'resourceFit' && CAPACITY.test(v.reason) && hasCapacityCheck(b)) { resolved.push({ dimension: v.dimension, how: 'capacity is checked before the bet' }); continue; }
    const refs = refsOf(v.reason, b);
    if (!refs.length || refs.some((r) => r.kind === 'central')) { unresolved.push(v); continue; }
    const how: string[] = [];
    for (const r of refs) {
      if (r.kind === 'channel') { dropChannels.add(r.index); how.push(`dropped secondary channel "${b.branch!.channelPriorities[r.index]!.channel}"`); }
      else if (r.kind === 'copy') { dropCopy.push(r); how.push(`omitted ${r.field}: "${r.sentence}"`); }
      else if (r.kind === 'central') continue; // unreachable: a central ref fails closed above
      else if (!r.present) how.push(`decision "${r.key}" is not in the strategy`);
      else {
        const d = (b.decisions ?? []).find((x) => x.key === r.key)!;
        if (v.dimension === 'oppositeIsAlsoAdvice' && engagesBySequence(d.rationale)) how.push(`decision "${r.key}" defers the opposite until a validation (engages it)`);
        else { dropDecisions.add(r.key); how.push(`dropped secondary decision "${r.key}"`); }
      }
    }
    resolved.push({ dimension: v.dimension, how: how.join('; ') });
  }
  if (dropChannels.size || dropDecisions.size || dropCopy.length) {
    const channels = (b.branch?.channelPriorities ?? []).filter((_, i) => !dropChannels.has(i)).map((x, i) => {
      if (i !== 0) return x;
      const out = { ...x };
      for (const d of dropCopy) {
        const f = d.field.replace('channel[0].', '') as 'whyAudience' | 'whyResource' | 'overAlternative';
        out[f] = sentencesIn(out[f] ?? '').filter((s) => s !== d.sentence).join(' ');
      }
      return out;
    });
    b = { ...b, branch: b.branch ? { ...b.branch, channelPriorities: channels } : b.branch, decisions: (b.decisions ?? []).filter((d) => !dropDecisions.has(d.key)) } as StrategyBundle;
  }
  // The dropped parts must leave a strategy that still passes every deterministic gate; otherwise nothing is settled.
  if (!validateStrategy(b, ctx).pass) return { bundle, resolved: [], unresolved: [...failed] };
  return { bundle: b, resolved, unresolved };
}
