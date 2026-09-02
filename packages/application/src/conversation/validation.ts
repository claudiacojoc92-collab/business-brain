import { makesUnlicensedClaim } from '../bi/validation';
import type { Aha2Finding, Aha2Output } from './contracts';

/**
 * Psychology / hidden-motive guard for Aha 2. BB describes observable decisions and stated intent —
 * it never diagnoses fear, insecurity, motive, personality, or attachment. EN/RO/IT stems.
 */
const PSYCHOLOGY_TERMS = [
  'fear', 'afraid', 'scared', 'anxiet', 'insecur', 'trauma', 'self-doubt', 'subconscious', 'deep down',
  'attachment style', 'personality type', 'impostor', 'psycholog', 'need for control', 'control issues',
  'ego ', 'hidden motiv', 'underlying motiv', 'really wants', 'secretly',
  'frică', 'frica', 'teamă', 'teama', 'nesigur', 'personalitate', 'în adâncul', 'in adancul', 'psicolog',
  'paura', 'ansia', 'insicur', 'personalità', 'personalita', 'in fondo', 'motivo nascosto',
];

function makesPsychologyClaim(text: string): boolean {
  const t = text.toLowerCase();
  return PSYCHOLOGY_TERMS.some((p) => t.includes(p));
}

/**
 * Aha2 / Strategy boundary. Aha 2 MAY CONSTRAIN strategy ("the strategy cannot assume X",
 * "there is a tension between A and B", "this narrows the problem to…") but MAY NOT CHOOSE it —
 * no channel/tactic/acquisition-method/strategic-bet/content-mix/campaign/execution selection, and
 * no optimization language ("highest leverage", "focus on one channel", "best strategy"). Choosing
 * strategy belongs to Slice 3. EN/RO/IT selection markers.
 */
const STRATEGY_SELECTION_TERMS = [
  // optimization / superlative selection
  'highest leverage', 'highest-leverage', 'high-leverage', 'most leverage', 'most effective',
  'best strategy', 'best channel', 'best approach', 'optimal channel', 'optimal strategy',
  'single channel', 'one channel', 'one acquisition channel', 'a single acquisition',
  // prescriptive channel/tactic selection
  'focus on', 'concentrate on', 'double down', 'lean into', 'switch to', 'pivot to',
  'prioriti', // prioritize / prioritise
  // direct advice imperatives
  'you should', 'you need to', 'i recommend', 'i suggest', 'my recommendation',
  'the strategy should be', 'the acquisition model should be', 'the strategy is to',
  // RO
  'ar trebui să', 'ar trebui sa', 'trebuie să te concentrezi', 'concentrează-te', 'concentreaza-te',
  'cel mai bun canal', 'cea mai bună strategie', 'cea mai buna strategie', 'un singur canal',
  'îți recomand', 'iti recomand', 'recomand să', 'recomand sa',
  // IT
  'dovresti', 'devi concentrar', 'concentrarti su', 'concentrati su', 'il canale migliore',
  'la strategia migliore', 'un solo canale', 'dai priorità', 'dare priorità', 'ti consiglio',
];

export function selectsStrategy(text: string): boolean {
  const t = text.toLowerCase();
  return STRATEGY_SELECTION_TERMS.some((p) => t.includes(p));
}

/**
 * Outcome-prediction guard. Website + founder-state evidence supports whether a conversion PATH or
 * next action exists — it does NOT license predicting actual lead/client/sales outcomes. Bans
 * "will generate leads", "cannot fill the pipeline", "produce clients", etc. (Restating the
 * founder's own goal — e.g. "you want retainer clients" — is fine and not matched here.)
 */
const OUTCOME_PREDICTION_TERMS = [
  'generate leads', 'generates leads', 'will generate', 'bring in leads', 'bring in clients',
  'bring you clients', 'produce clients', 'produces clients', 'win clients', 'win new clients',
  'fill the pipeline', 'fill a pipeline', 'fill a retainer pipeline', 'filling the pipeline',
  'drive sales', 'increase revenue', 'boost revenue', 'convert visitors', 'get customers',
  // RO
  'va genera', 'generează clienți', 'genereaza clienti', 'va aduce clienți', 'va aduce clienti',
  'va produce', 'umple pipeline',
  // IT
  'genererà', 'generera', 'genera clienti', 'porterà clienti', 'portera clienti', 'produrre clienti',
  'aumenterà le vendite', 'riempire la pipeline',
];

export function predictsUnlicensedOutcome(text: string): boolean {
  const t = text.toLowerCase();
  return OUTCOME_PREDICTION_TERMS.some((p) => t.includes(p));
}

/**
 * Founder-state → claim-type compatibility. Founder-owned state licenses claims only about what the
 * founder actually owns. A preference is not a target/segment; a channel preference is not a segment
 * choice; a constraint is not a market-effectiveness judgment; a goal is not a market-superiority
 * claim. Aha 2 may CONNECT any founder-state type to business evidence, but may not UPGRADE one type
 * into a stronger claim it cannot support. EN/RO/IT.
 *
 * Two components:
 *  - TARGET/SEGMENT assertions require a target-owning founder kind (goal | intention | decision) to
 *    be among the cited founder refs; otherwise (preference/constraint/resource/etc.) they are an
 *    upgrade and fail.
 *  - Inference-to-segment, market-effectiveness, and market-superiority phrasings are never licensed
 *    by any founder-state type and always fail.
 */
const TARGET_ASSERTION_TERMS = [
  'target segment', 'target market', 'target audience', 'primary segment', 'primary audience',
  'primary client', 'primary customer', 'your segment', 'your niche', 'your market',
  'ideal client', 'ideal customer', 'specialize in', 'specialise in', 'specific segment',
  // RO
  'segment țintă', 'segment tinta', 'segment principal', 'segmentul principal', 'segmentul tău',
  'segmentul tau', 'piață țintă', 'piata tinta', 'nișă', 'nisa', 'client principal', 'specializ',
  // IT
  'segmento target', 'segmento principale', 'il tuo segmento', 'mercato target', 'nicchia',
  'cliente principale', 'pubblico principale',
];

const UNSUPPORTED_UPGRADE_TERMS = [
  // inference-to-segment: deriving a target/market from a non-target state
  'points toward a specific segment', 'points to a specific segment', 'points toward a segment',
  'points to a segment', 'implies a segment', 'suggests a segment', 'points toward a specific market',
  'points to a specific market',
  // market effectiveness — no founder-state type licenses this
  'does not work for', "doesn't work for", 'do not work for', 'work for this audience',
  'commercially ineffective', 'ineffective', 'converts better', 'convert better', 'works better',
  'work better for',
  // market superiority / best-opportunity
  'best business model', 'best market', 'best opportunity', 'optimal niche', 'ideal market',
  'best niche', 'best segment',
  // RO
  'nu funcționează pentru', 'nu functioneaza pentru', 'ineficient', 'cel mai bun model de afaceri',
  'cea mai bună piață', 'cea mai buna piata', 'cea mai bună oportunitate',
  // IT
  'non funziona per', 'inefficace', 'miglior modello di business', 'miglior mercato',
  'migliore opportunità', 'miglior nicchia',
];

const TARGET_OWNING_KINDS = new Set(['goal', 'intention', 'decision']);

export function upgradesFounderState(text: string, citedFounderKinds: Set<string>): boolean {
  const t = text.toLowerCase();
  if (UNSUPPORTED_UPGRADE_TERMS.some((p) => t.includes(p))) return true;
  const assertsTarget = TARGET_ASSERTION_TERMS.some((p) => t.includes(p));
  if (assertsTarget) {
    const ownsTarget = [...citedFounderKinds].some((k) => TARGET_OWNING_KINDS.has(k));
    if (!ownsTarget) return true;
  }
  return false;
}

export interface ValidatedAha2Finding {
  implication: string;
  businessRefs: string[];
  founderRefs: string[];
  observationRefs: string[];
}
export interface ValidatedAha2 {
  status: 'produced' | 'insufficient';
  findings: ValidatedAha2Finding[];
}

/** Why a candidate implication failed the Aha 2 gate. Repairable reasons drive the repair loop. */
export type Aha2Rejection =
  | 'too_short'
  | 'not_cross_source'
  | 'unlicensed_claim'
  | 'psychology'
  | 'strategy_selection'
  | 'unsupported_outcome'
  | 'founder_state_upgrade';

/** Refs available to a finding. `founder` is a map ref → founder-state kind (needed for compatibility). */
export interface Aha2Refs {
  business: Set<string>;
  founder: Map<string, string>;
  observation: Set<string>;
}

export type Aha2Classification =
  | { ok: true; finding: ValidatedAha2Finding }
  | { ok: false; reason: Aha2Rejection };

/**
 * Classify ONE candidate implication against the gates, returning a typed reason on failure so the
 * caller can repair (strategy/outcome/founder-state-upgrade/unlicensed) or drop (too-short,
 * not-cross-source, psychology). Order matters: cheap textual gates first, then ref resolution, then
 * founder-state-type compatibility (which needs the cited kinds).
 */
export function classifyAha2Finding(f: Aha2Finding, refs: Aha2Refs): Aha2Classification {
  const implication = stripRefTokens((f.implication ?? '').trim());
  if (implication.length < 20) return { ok: false, reason: 'too_short' };
  if (makesUnlicensedClaim(implication)) return { ok: false, reason: 'unlicensed_claim' };
  if (makesPsychologyClaim(implication)) return { ok: false, reason: 'psychology' };
  if (selectsStrategy(implication)) return { ok: false, reason: 'strategy_selection' };
  if (predictsUnlicensedOutcome(implication)) return { ok: false, reason: 'unsupported_outcome' };
  const businessRefs = (f.businessRefs ?? []).filter((r) => refs.business.has(r));
  const founderRefs = (f.founderRefs ?? []).filter((r) => refs.founder.has(r));
  const observationRefs = (f.observationRefs ?? []).filter((r) => refs.observation.has(r));
  // Cross-source requirement: a real Aha 2 connects business AND founder.
  if (businessRefs.length === 0 || founderRefs.length === 0) return { ok: false, reason: 'not_cross_source' };
  const citedKinds = new Set(founderRefs.map((r) => refs.founder.get(r)).filter((k): k is string => Boolean(k)));
  if (upgradesFounderState(implication, citedKinds)) return { ok: false, reason: 'founder_state_upgrade' };
  return { ok: true, finding: { implication, businessRefs, founderRefs, observationRefs } };
}

/**
 * Aha 2 gate — fail closed. Each surviving finding must: be a real statement; make no unlicensed
 * (market/behavioral) claim and no psychology claim; resolve real refs; and be a genuine CROSS-SOURCE
 * synthesis — at least one business element AND one founder-owned element. Business-only or
 * founder-only "syntheses" are dropped. Observation refs are optional. Bounded to 3.
 */
/** Strip internal ref tokens the model may have echoed into prose, e.g. "(F3, F4)" / "(B2, B3)". */
function stripRefTokens(text: string): string {
  return text
    .replace(/\s*\((?:\s*[BFO]\d+\s*,?)+\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

export function validateAha2(out: Aha2Output | null | undefined, refs: Aha2Refs): ValidatedAha2 {
  const findings: ValidatedAha2Finding[] = [];
  for (const f of out?.findings ?? []) {
    const res = classifyAha2Finding(f, refs);
    if (res.ok) findings.push(res.finding);
  }
  const bounded = findings.slice(0, 3);
  return { status: bounded.length > 0 ? 'produced' : 'insufficient', findings: bounded };
}

export function assertAha2WellFormed(o: Aha2Output | null | undefined): asserts o is Aha2Output {
  if (!o || !Array.isArray(o.findings)) throw new Error('AHA2_MALFORMED: findings is not an array');
}
