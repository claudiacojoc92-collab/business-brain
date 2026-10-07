import type { AhaResult, PageObservation, SourceRef, SynthesisOutput } from './contracts';

/**
 * Generic, transplantable phrases that are NOT Aha findings unless tied to a specific observed
 * tension. The anti-transplant gate rejects a finding that leans on one of these.
 */
const GENERIC_PHRASES = [
  'could be clearer',
  'stronger cta',
  'stronger ctas',
  'stronger call to action',
  'know your audience',
  'brand needs consistency',
  'be more consistent',
  'post more',
  'improve your seo',
  'engage more',
  'more engaging',
  'tell your story',
  'clear value proposition',
  'unique selling proposition',
  'leverage social media',
  'build trust',
  'increase visibility',
];

function isTransplantable(text: string): boolean {
  const t = text.toLowerCase();
  return GENERIC_PHRASES.some((p) => t.includes(p));
}

/**
 * Claim-TYPE discipline (Slice 1). Website/public-site evidence can license source, structural,
 * and discoverability observations — but NOT market/competitive, trust/credibility, loyalty,
 * conversion/purchase-behavior, emotional/psychological, or strategic-superiority inferences.
 * Hedging ("may/could/appears") does NOT change this — an unlicensed claim type fails regardless.
 * Terms are matched as substrings and cover EN / RO / IT so a translation cannot bypass the rule.
 * (Substring traps are deliberately avoided, e.g. "convert" is excluded so "conversation" passes.)
 */
const UNLICENSED_CLAIM_TERMS = [
  // market / competitive / differentiation (needs comparative market evidence)
  'differentiat', 'competitor', 'competitive', 'stand out', 'stands out', 'set apart', 'sets apart',
  'category-leading', 'market-leading', 'best-in-class', 'best in class', 'edge over', 'advantage over',
  'unlike competitors', 'unlike other', 'rare', 'unique', 'superior', 'outperform',
  'diferenția', 'diferentia', 'concurenț', 'concurent', 'avantaj fața', 'avantaj fata', 'unic', 'superior',
  'differenzia', 'concorren', 'vantaggio rispetto', 'unico', 'raro', 'si distingue',
  // trust / credibility (needs audience/behavior evidence)
  'trust', 'credibility', 'credible', 'reputation', 'reassur',
  'încredere', 'incredere', 'credibilit', 'reputați', 'reputati',
  'fiducia', 'credibilità', 'credibilita', 'reputazione',
  // loyalty / retention
  'loyal', 'retention', 'retain customer', 'stickiness',
  'loialitate', 'fideliz', 'reține client', 'retine client',
  'fedeltà', 'fedelta', 'fidelizz',
  // conversion / purchase / behavioral response
  'conversion', 'converts better', 'will convert', 'purchase decision', 'buying decision',
  'more likely to', 'likely to buy', 'drive sales', 'boost sales', 'increase revenue', 'revenue',
  'leave money', 'engagement', 'resonate', 'resonance', 'appeal to', 'appeals to', 'attract',
  'inbound lead', 'targeted lead', 'more leads', 'proven to', 'guarantee',
  'conversie', 'conversii', 'venit', 'vânzăr', 'vanzar', 'mai probabil să', 'mai probabil sa',
  'rezon', 'atrage client', 'atrage lead',
  'conversione', 'convertir', 'ricav', 'vendite', 'più propensi', 'piu propensi', 'risuon', 'attrarre',
  // emotional / psychological / perception outcomes
  'emotional', 'emotionally', 'erode', 'undermine', 'perception of',
  'emoțional', 'emotional', 'erod', 'submineaz',
  'emotiv', 'emozional', 'mina la',
  // strategic superiority / recommendation (belongs in Strategy, not Aha 1)
  'you should', 'reposition', 'redesign', 'overhaul', 'stronger than', 'better than',
  'ar trebui să', 'ar trebui sa', 'repoziți', 'reproiect',
  'dovresti', 'riposiziona', 'riprogetta',
  // strengthened-claim verbs (translation cannot strengthen a bounded claim past the gate)
  'proves that', 'demonstrates that',
  'dovedește', 'dovedeste', 'demonstrează', 'demonstreaza', 'dimostra che', 'prova che',
];

/** True when the text makes a claim whose TYPE website-only evidence cannot license. */
export function makesUnlicensedClaim(text: string): boolean {
  const t = text.toLowerCase();
  return UNLICENSED_CLAIM_TERMS.some((p) => t.includes(p));
}

export interface ValidatedFinding {
  finding: string;
  implication?: string;
  sourceRefs: SourceRef[];
}

export interface ValidatedAha {
  status: 'produced' | 'insufficient';
  findings: ValidatedFinding[];
}

/** Resolve model-supplied page refs to real linked pages (drops anything that doesn't resolve). */
export function resolveRefs(refs: string[], observations: PageObservation[]): SourceRef[] {
  const byRef = new Map(observations.map((o) => [o.ref, o] as const));
  const out: SourceRef[] = [];
  const seen = new Set<string>();
  for (const r of refs ?? []) {
    const o = byRef.get(r);
    if (o && !seen.has(o.url)) {
      seen.add(o.url);
      out.push({ label: o.ref, url: o.url });
    }
  }
  return out;
}

/**
 * Deterministic Aha gate — fails closed. Each surviving finding must:
 *  - be a real statement (not a stub),
 *  - not be transplantable (generic),
 *  - resolve at least one real source page (grounding).
 * Bounded to 4. Zero survivors → status 'insufficient' (honest "not enough yet"), never filler.
 */
export function validateAha(aha: AhaResult, observations: PageObservation[]): ValidatedAha {
  const findings: ValidatedFinding[] = [];
  for (const f of aha?.findings ?? []) {
    const finding = (f.finding ?? '').trim();
    if (finding.length < 12) continue;
    if (isTransplantable(finding)) continue;
    // Claim-TYPE discipline: a FINDING must be a source/structural/discoverability observation.
    // If it makes a market/trust/loyalty/conversion/behavioral/superiority claim (even hedged),
    // drop it — hedging does not create evidence, and a source cite must not launder it.
    if (makesUnlicensedClaim(finding)) continue;
    const refs = resolveRefs(f.sourceRefs ?? [], observations);
    if (refs.length === 0) continue;
    // IMPLICATION must be a bounded inference the evidence type can license. If it makes an
    // unlicensed claim type, drop the implication while keeping the source-supported finding.
    const rawImpl = (f.implication ?? '').trim();
    const implication = rawImpl && !makesUnlicensedClaim(rawImpl) ? rawImpl : '';
    findings.push({ finding, ...(implication ? { implication } : {}), sourceRefs: refs });
  }
  const bounded = findings.slice(0, 4);
  return { status: bounded.length > 0 ? 'produced' : 'insufficient', findings: bounded };
}

/** Structural guard for the raw synthesis; throws (fail closed) on a malformed shape. */
export function assertWellFormed(s: SynthesisOutput | null | undefined): asserts s is SynthesisOutput {
  if (!s || typeof s !== 'object') throw new Error('SYNTHESIS_MALFORMED: not an object');
  const u = s.understanding;
  if (!u || !u.offer || !u.positioning || !u.audience) {
    throw new Error('SYNTHESIS_MALFORMED: missing understanding sections');
  }
  if (!s.aha || !Array.isArray(s.aha.findings)) {
    throw new Error('SYNTHESIS_MALFORMED: aha.findings is not an array');
  }
}
