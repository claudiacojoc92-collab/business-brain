import type {
  RelevanceConfidence, RelevanceCorrection, RelevanceDecision, RelevanceInput, RelevantOfferPart, WritingEntry,
} from './contracts';
import { RELEVANCE_CONFIDENCES } from './contracts';

/**
 * RECIPIENT RELEVANCE, decided ONCE per communication brief (Result Loop V1, 2026-10-14). The writer, every repair, the
 * claim grounder, the sendability judge and the founder's brief preview all read this one decision; none of them re-judges
 * which services fit the recipient. The model only proposes; this module keeps what is verifiable:
 *   - an offer part must be one of the verified offer_items (never an inferred service);
 *   - evidence must be a verbatim span of the context the decision was made from (else it is dropped);
 *   - a part without verified evidence is LOW confidence, whatever the model said;
 *   - at most two parts; nothing clear → uncertain (the message then names no service, and BB says so).
 * The founder's correction for a contact replaces the model for that contact and is evidence for similar recipients.
 */

export const MAX_RELEVANT_PARTS = 2;

/**
 * Ordinary connective / evaluative language a reason may use beyond its context (en / ro / it / de, folded, 5-letter
 * stems). Everything else in a reason (a condition, a procedure, a patient group, a use case) must come from the context.
 */
const reasonFold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const GENERIC = new Set([
  // ro
  'pentru', 'acest', 'aceast', 'aceas', 'acesti', 'aceia', 'astfe', 'deoar', 'pentr', 'despr', 'dintr', 'printr', 'poate', 'putea', 'pot',
  'nevoi', 'nevoie', 'servi', 'relev', 'direc', 'potri', 'legat', 'legat', 'conti', 'firea', 'natur', 'impor', 'util', 'utila', 'ajuta',
  'recom', 'oferi', 'ofera', 'lucre', 'lucra', 'trimi', 'trime', 'acolo', 'aici', 'astaz', 'acum', 'dupa', 'inain', 'atunc', 'adica',
  'exact', 'chiar', 'foart', 'mult', 'multe', 'putin', 'pasul', 'urmat', 'urmato', 'ofert', 'parte', 'aceea', 'este', 'sunt', 'fiind',
  'avand', 'avea', 'facut', 'face', 'fac', 'cauta', 'vede', 'vad', 'acele', 'acel', 'lor', 'sale', 'dumne', 'clinic', 'acela',
  'compl', 'compa', 'core', 'leaga', 'leagă', 'favor', 'ambel', 'toate', 'tot', 'flux', 'fluxu', 'canal', 'canalu', 'strat',
  'mentionat', 'mesajul', 'mesaje', 'anterior', 'tinta', 'aliniat', 'profilul', 'specific', 'motivul', 'scopul', 'activ', 'activitatea',
  'principal', 'primul', 'acelasi', 'aceeasi', 'similar', 'dovada', 'confirma', 'contact', 'relatia', 'interes', 'interesat',
  // en / it / de discourse
  'mentioned', 'message', 'previous', 'earlier', 'target', 'aligned', 'profile', 'specific', 'reason', 'purpose', 'main', 'similar',
  'previo', 'messaggio', 'vorherige', 'nachricht', 'ziel',
  // en
  'becau', 'their', 'these', 'those', 'which', 'where', 'there', 'about', 'after', 'befor', 'patie', 'clien', 'servi', 'relev',
  'direc', 'natur', 'neede', 'needs', 'helps', 'usefu', 'makes', 'sense', 'match', 'matte', 'fits', 'offer', 'sends', 'refer',
  'part', 'their', 'work', 'works', 'clear', 'likel', 'step', 'next', 'often', 'usual', 'typic', 'commo', 'stron', 'close',
  // it / de
  'perch', 'quest', 'quell', 'servi', 'pazie', 'clien', 'dopo', 'prima', 'utile', 'adatt', 'weil', 'diese', 'nach', 'vorhe',
  'nutze', 'passe', 'brauc', 'diens', 'kunde', 'direk',
].map((w) => reasonFold(w).slice(0, 5)));
const contentStems = (s: string): string[] => reasonFold(s).split(/[^\p{L}]+/u).filter((w) => w.length >= 5).map((w) => w.slice(0, 5));

/** The reason's terms that come neither from its context nor from ordinary language (empty = grounded). */
export function ungroundedReasonTerms(reason: string, corpus: string): string[] {
  const known = new Set(contentStems(corpus));
  const words = reasonFold(reason).split(/[^\p{L}]+/u).filter((w) => w.length >= 5);
  return [...new Set(words.filter((w) => !known.has(w.slice(0, 5)) && !GENERIC.has(w.slice(0, 5))))];
}
const LOWER: Record<RelevanceConfidence, RelevanceConfidence> = { HIGH: 'MEDIUM', MEDIUM: 'LOW', LOW: 'LOW' };
const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s"'„”“«»]+/g, ' ').trim();
const RANK: Record<RelevanceConfidence, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** The context a relevance decision may rest on (what the evidence spans are checked against). */
export function relevanceCorpus(input: RelevanceInput): string {
  const r = input.recipient;
  return [
    r.name, r.organisation ?? '', r.role ?? '', input.relationship_context, input.why_now, input.strategic_reason,
    input.offer_or_value ?? '', ...input.supporting_context,
    ...input.priorCorrections.flatMap((c) => [c.recipientRole ?? '', c.organisation ?? '', ...c.parts.flatMap((p) => [p.offer_part, p.reason])]),
  ].join('\n');
}

/** The verified offer item this text names exactly (accents / case aside), or null. */
export function matchOfferItem(text: string, items: readonly string[]): string | null {
  const t = fold(text);
  return items.find((i) => fold(i) === t) ?? null;
}

export function checkRelevance(raw: unknown, input: RelevanceInput): RelevanceDecision {
  const list = Array.isArray((raw as { parts?: unknown } | null)?.parts) ? (raw as { parts: unknown[] }).parts : [];
  const corpus = fold(relevanceCorpus(input));
  const seen = new Set<string>();
  const parts: RelevantOfferPart[] = [];
  for (const x of list) {
    const c = (x ?? {}) as Record<string, unknown>;
    const part = matchOfferItem(String(c['offer_part'] ?? ''), input.offer_items);
    if (!part || seen.has(part)) continue; // not a verified offer part → never chosen
    const evidence = (Array.isArray(c['evidence']) ? c['evidence'] : [])
      .map((e) => String(e ?? '').trim()).filter((e) => e.length >= 3 && corpus.includes(fold(e))).slice(0, 4);
    const said = RELEVANCE_CONFIDENCES.includes(c['confidence'] as RelevanceConfidence) ? (c['confidence'] as RelevanceConfidence) : 'LOW';
    const proposed = String(c['reason'] ?? '').trim().slice(0, 300);
    if (!proposed) continue;
    seen.add(part);
    // The reason the founder sees must be trustworthy: it may not add a condition, procedure or use case the context does
    // not name. If it does, it is replaced by the verified evidence itself, and the choice is less certain.
    const extra = ungroundedReasonTerms(proposed, `${relevanceCorpus(input)}\n${part}`);
    const grounded = !extra.length;
    const reason = grounded ? proposed : evidence.length ? evidence.join(' · ') : part;
    const confidence = !evidence.length ? 'LOW' : grounded ? said : LOWER[said];
    parts.push({ offer_part: part, reason, evidence, confidence, ...(grounded ? {} : { droppedReason: proposed, ungroundedTerms: extra }) });
  }
  const chosen = parts.sort((a, b) => RANK[a.confidence] - RANK[b.confidence]).slice(0, MAX_RELEVANT_PARTS);
  return { parts: chosen, uncertain: !chosen.length || chosen.every((p) => p.confidence === 'LOW'), source: 'model', correctionId: null };
}

/** The founder's correction as the decision for that contact: her parts, her reasons, HIGH (she knows this recipient). */
export function decisionFromCorrection(c: RelevanceCorrection, items: readonly string[]): RelevanceDecision {
  const parts = c.parts.flatMap((p) => {
    const part = matchOfferItem(p.offer_part, items);
    return part ? [{ offer_part: part, reason: p.reason, evidence: [`founder: ${p.reason}`], confidence: 'HIGH' as const }] : [];
  }).slice(0, MAX_RELEVANT_PARTS);
  return { parts, uncertain: !parts.length, source: 'founder', correctionId: c.entryId };
}

/** Validate a founder correction: only verified offer parts, a reason for each, at most two. */
export function parseCorrectionParts(raw: unknown, items: readonly string[]): { offer_part: string; reason: string }[] | null {
  if (!Array.isArray(raw)) return null;
  const out: { offer_part: string; reason: string }[] = [];
  for (const x of raw) {
    const c = (x ?? {}) as Record<string, unknown>;
    const part = matchOfferItem(String(c['offer_part'] ?? ''), items);
    const reason = String(c['reason'] ?? '').trim().slice(0, 300);
    if (!part || !reason) return null;
    if (!out.some((o) => o.offer_part === part)) out.push({ offer_part: part, reason });
  }
  return out.length <= MAX_RELEVANT_PARTS ? out : null;
}

/** RELEVANCE writing entries → the latest correction per contact. */
export function projectRelevanceCorrections(entries: readonly WritingEntry[]): RelevanceCorrection[] {
  const latest = new Map<string, RelevanceCorrection>();
  for (const e of [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (e.kind !== 'RELEVANCE' || !e.key) continue;
    try {
      const v = JSON.parse(e.text) as Partial<RelevanceCorrection>;
      latest.set(e.key, {
        entryId: e.id, contactId: e.key, recipientRole: v.recipientRole ?? null, organisation: v.organisation ?? null,
        parts: Array.isArray(v.parts) ? v.parts.filter((p) => p && typeof p.offer_part === 'string' && typeof p.reason === 'string') : [],
        removed: Array.isArray(v.removed) ? v.removed.filter((r): r is string => typeof r === 'string') : [],
      });
    } catch { /* malformed: ignore */ }
  }
  return [...latest.values()];
}
