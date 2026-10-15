import type { CommunicationBrief, ContextualRejection, DraftMessage, GateFailure, MessageChannel, RecipientCategory, WritingContext, WritingEntry, WritingRule, WritingRuleKey } from './contracts';

/**
 * FOUNDER WRITING RULES (Result Loop V1, 2026-10-14). Reusable writing constraints derived ONLY from observable evidence:
 * her real messages (SAMPLE), her explicit preferences (PREFERENCE), the phrases she said she never uses (NEVER_SAY /
 * REJECTED_PHRASE), and what she removed when she edited a BB draft (edit evidence). Never a personality, never a fact.
 *
 * Three levels of evidence about wording, never conflated:
 *  1. explicit never-say (she said it / typed it in the never-say field) → HARD: the deterministic gate blocks it.
 *  2. one edit removed it (REJECTED_IN_CONTEXT: that draft, that recipient, that purpose) → soft context for a similar
 *     message only. One edit can be about the recipient, the length, repetition or nuance: it is never a ban.
 *  3. similar wording removed in several independent edits → a soft "usually avoids" preference that cites every edit,
 *     weighed cumulatively against her own messages that use it. Never becomes never-say without her saying so.
 *
 * Precedence: explicit instruction (never-say, preference, accepted phrase) > her real samples > repeated edit patterns >
 * a single contextual edit > generic defaults. Every rule names the writing entries it came from (`evidence`).
 */

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);
const lines = (s: string): string[] => s.split('\n').map((l) => l.trim()).filter(Boolean);
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)]! : 0; };

/** A BB draft she edited counts as her own text only when most of the final is her words. */
export const MOSTLY_HERS = 0.5;

/**
 * Her own messages: text she wrote (samples) and BB drafts she mostly rewrote. Never someone else's outreach she liked,
 * never a BB draft she sent unchanged (accepted_draft), never a lightly edited BB draft: BB must not learn its own prose
 * as her voice.
 */
export function ownSamples(entries: readonly WritingEntry[]): WritingEntry[] {
  return entries.filter((e) => e.kind === 'SAMPLE' && (e.evidence.kind === 'sample' || (e.evidence.kind === 'edit' && (e.evidence.authoredShare ?? 0) >= MOSTLY_HERS)));
}

/** Written in the same register context: same kind of recipient, same channel (both must be known). */
export function sameContext(e: WritingEntry, ctx: Pick<WritingContext, 'recipientCategory' | 'channel'>): boolean {
  return e.evidence.recipientCategory === ctx.recipientCategory && e.evidence.channel === ctx.channel;
}

/** The share of `after` that is her words (the added runs), 0–1. */
export function authoredShare(after: string, added: readonly string[]): number {
  const total = words(after).length;
  return total ? Math.min(1, added.reduce((n, a) => n + words(a).length, 0) / total) : 0;
}

/** A short first line that greets ("Bună ziua,", "Hi Ana,"), name stripped to its greeting words. */
function greetingOf(text: string): string | null {
  const first = lines(text)[0] ?? '';
  if (!first || words(first).length > 6 || /[.?]$/.test(first)) return null;
  // Keep the greeting words up to the first comma / name-like capital after the first word: "Bună ziua, doamna doctor" → "Bună ziua,"
  const m = first.match(/^([^,!]+[,!]?)/);
  const g = (m?.[1] ?? first).trim();
  return words(g).length <= 4 ? g : null;
}

/** The closing block: the last 1–2 short lines (a sign-off and / or her name). */
function signoffOf(text: string): string | null {
  const ls = lines(text);
  if (ls.length < 2) return null;
  const tail = ls.slice(-2).filter((l) => words(l).length <= 4 && !/[?]$/.test(l));
  return tail.length ? tail.join('\n') : null;
}

// Second-person register markers (Romanian; other languages fall through to "no register rule").
// Letter boundaries, not \b: \b is ASCII-only, so it never matched after "ă" / "ț" ("Vă", "ați" went undetected).
const RO_FORMAL = /(?<!\p{L})(dumneavoastr[ăa]|dvs\.?|v[ăa]|sunte[țt]i|a[țt]i|pute[țt]i|vre[țt]i|dori[țt]i)(?!\p{L})/giu;
const RO_INFORMAL = /(?<!\p{L})(e[șs]ti|po[țt]i|vrei|ai fi|[îi][țt]i|te rog|tu)(?!\p{L})/giu;

function mode<T>(xs: { v: T; id: string }[], key: (v: T) => string): { v: T; ids: string[]; n: number } | null {
  const by = new Map<string, { v: T; ids: string[] }>();
  for (const x of xs) { const k = key(x.v); const b = by.get(k) ?? { v: x.v, ids: [] }; b.ids.push(x.id); by.set(k, b); }
  const best = [...by.values()].sort((a, b) => b.ids.length - a.ids.length)[0];
  return best ? { ...best, n: best.ids.length } : null;
}

/**
 * Derive the rules (entries = ONE sender's evidence). Sample-derived rules (length, greeting, sign-off, register, ask,
 * punctuation) hold only for the context her samples were written in (kind of recipient + channel): "Bună ziua" and
 * "dumneavoastră" to doctors by email say nothing about a WhatsApp to a past client. With `ctx`, only that context's rules;
 * without, every context's rules, each tagged with its scope. Samples with no known context shape no rule. Explicit
 * preferences, never-say and edit evidence are about the sender, across contexts.
 */
export function deriveWritingRules(entries: readonly WritingEntry[], ctx: WritingContext | null = null): WritingRule[] {
  const sorted = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const explicit = explicitRules(sorted);
  const scoped = ownSamples(sorted).filter((e) => e.evidence.recipientCategory && e.evidence.channel);
  const contexts = ctx ? [{ recipientCategory: ctx.recipientCategory, channel: ctx.channel }]
    : [...new Map(scoped.map((e) => [`${e.evidence.recipientCategory}|${e.evidence.channel}`, { recipientCategory: e.evidence.recipientCategory!, channel: e.evidence.channel! }])).values()];
  const fromSamples = contexts.flatMap((c) => sampleRules(scoped.filter((e) => sameContext(e, c)), c, ctx?.purpose ?? null)
    .filter((r) => !explicit.some((x) => x.key === r.key)));
  return [...explicit.filter((r) => r.key !== 'never_say'), ...fromSamples, ...explicit.filter((r) => r.key === 'never_say'), ...softRules(sorted)];
}

/** The rules her messages in ONE context support (the cta rule only from messages with this purpose, when known). */
function sampleRules(own: WritingEntry[], scope: { recipientCategory: RecipientCategory; channel: MessageChannel }, purpose: string | null): WritingRule[] {
  const rules = new Map<WritingRuleKey, WritingRule>();
  const put = (r: WritingRule): void => { rules.set(r.key, { ...r, scope }); };

  if (own.length) {
    const ids = own.map((s) => s.id);
    const lengths = own.map((s) => words(s.text).length);
    const med = median(lengths);
    put({ key: 'length', value: `about ${med} words (her messages: ${Math.min(...lengths)}–${Math.max(...lengths)})`, maxWords: Math.max(30, Math.min(160, Math.round(med * 1.2))), source: 'samples', evidence: ids });
    const sentences = own.flatMap((s) => s.text.split(/[.!?]+\s|\n+/).map((x) => words(x).length).filter((n) => n > 0));
    put({ key: 'sentence_length', value: `sentences of about ${median(sentences)} words`, source: 'samples', evidence: ids });

    const g = mode(own.flatMap((s) => { const v = greetingOf(s.text); return v ? [{ v, id: s.id }] : []; }), (v) => fold(v).replace(/[,!]/g, ''));
    if (g && (g.n >= 2 || own.length === 1)) put({ key: 'greeting', value: g.v, source: 'samples', evidence: g.ids });
    const so = mode(own.flatMap((s) => { const v = signoffOf(s.text); return v ? [{ v, id: s.id }] : []; }), (v) => fold(v));
    if (so && (so.n >= 2 || own.length === 1)) put({ key: 'signoff', value: so.v, source: 'samples', evidence: so.ids });

    const formal = own.filter((s) => (s.text.match(RO_FORMAL) ?? []).length > (s.text.match(RO_INFORMAL) ?? []).length);
    const informal = own.filter((s) => (s.text.match(RO_INFORMAL) ?? []).length > (s.text.match(RO_FORMAL) ?? []).length);
    if (formal.length && !informal.length) put({ key: 'formality', value: 'formal second person (dumneavoastră / vă)', register: 'formal', source: 'samples', evidence: formal.map((s) => s.id) });
    else if (informal.length && !formal.length) put({ key: 'formality', value: 'conversational second person (tu)', register: 'informal', source: 'samples', evidence: informal.map((s) => s.id) });

    const forPurpose = purpose ? own.filter((s) => s.evidence.purpose === purpose) : own;
    const asks = forPurpose.filter((s) => /\?\s*$/.test(lines(s.text).slice(0, -1).pop() ?? ''));
    if (forPurpose.length) put({ key: 'cta', value: asks.length * 2 >= forPurpose.length ? 'ends with one direct question' : 'ends with a statement or an offer, not a question', source: 'samples', evidence: forPurpose.map((s) => s.id) });

    const excl = own.filter((s) => s.text.includes('!'));
    const dash = own.filter((s) => /[–—]|\s-\s/.test(s.text));
    put({ key: 'punctuation', value: [excl.length ? 'uses "!"' : 'never uses "!"', dash.length ? 'uses dashes' : 'never uses dashes'].join('; '),
      noExclamation: !excl.length, noDashes: !dash.length, source: 'samples', evidence: ids });
  }

  return [...rules.values()];
}

/** What she told BB: preferences (latest per key) and the phrases she never uses (HARD). Across all her contexts. */
function explicitRules(sorted: readonly WritingEntry[]): WritingRule[] {
  const rules = new Map<WritingRuleKey, WritingRule>();
  for (const e of sorted) {
    if (e.kind !== 'PREFERENCE' || !e.key) continue;
    const key = e.key === 'signoff' ? 'signoff' : e.key === 'greeting' ? 'greeting' : e.key === 'length' ? 'length' : e.key === 'directness' ? 'directness' : e.key === 'warmth' ? 'warmth' : null;
    if (!key) continue;
    const maxWords = key === 'length' ? (/short|scurt|kurz|breve/i.test(e.text) ? 70 : /long|lung|lang|lungo/i.test(e.text) ? 140 : /medium|mediu|mittel|medio/i.test(e.text) ? 110 : undefined) : undefined;
    rules.set(key, { key, value: e.text, source: 'explicit', evidence: [e.id], ...(maxWords ? { maxWords } : {}) });
  }

  // HARD: only what she explicitly said she never uses.
  const never = sorted.filter((e) => e.kind === 'NEVER_SAY' || e.kind === 'REJECTED_PHRASE');
  if (never.length) {
    rules.set('never_say', { key: 'never_say', value: never.map((e) => `"${e.text}"`).join(', '), phrases: never.map((e) => e.text), source: 'explicit', evidence: never.map((e) => e.id) });
  }
  return [...rules.values()];
}

/** Every removal from every edited BB draft, with the message it belongs to (REJECTED_IN_CONTEXT). */
export function contextualRejections(entries: readonly WritingEntry[]): ContextualRejection[] {
  return entries.filter((e) => e.kind === 'SAMPLE' && e.evidence.kind === 'edit').flatMap((e) => (e.evidence.removed ?? []).map((phrase) => ({
    phrase, entryId: e.id, purpose: e.evidence.purpose ?? null, contactId: e.evidence.contactId ?? null, recipientCategory: e.evidence.recipientCategory ?? null,
    before: e.evidence.before ?? '', after: e.evidence.after ?? e.text, at: e.createdAt,
  })));
}

const bare = (s: string): string => fold(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
/** Similar wording: one contains the other, or most of their words are shared ("dacă are sens" ~ "dacă vi se pare că are sens"). */
function similar(a: string, b: string): boolean {
  const x = bare(a), y = bare(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const A = new Set(x.split(' ')), B = new Set(y.split(' '));
  const shared = [...A].filter((w) => B.has(w)).length;
  return shared / Math.min(A.size, B.size) >= 0.6;
}

/**
 * The soft wording evidence: removals grouped by similar wording. Support = the distinct edits that removed it; against =
 * her own messages (samples and final texts) that use it; an explicit accepted phrase or never-say takes it out of the
 * soft layer. One supporting edit = changed_once (context); several = usually_avoids (a preference, cumulative).
 */
function softRules(sorted: readonly WritingEntry[]): WritingRule[] {
  const explicit = sorted.filter((e) => e.kind === 'ACCEPTED_PHRASE' || e.kind === 'NEVER_SAY' || e.kind === 'REJECTED_PHRASE').map((e) => e.text);
  const groups: ContextualRejection[][] = [];
  for (const r of contextualRejections(sorted)) {
    if (explicit.some((x) => similar(x, r.phrase))) continue;
    const g = groups.find((xs) => xs.some((x) => similar(x.phrase, r.phrase)));
    if (g) g.push(r); else groups.push([r]);
  }
  const own = ownSamples(sorted);
  return groups.map((g): WritingRule => {
    const support = [...new Set(g.map((r) => r.entryId))];
    const phrases = [...new Set(g.map((r) => r.phrase))];
    const against = own.filter((s) => !support.includes(s.id) && phrases.some((p) => bare(s.text).includes(bare(p)))).map((s) => s.id);
    const quoted = phrases.map((p) => `"${p}"`).join(' / ');
    const but = against.length ? `; you do use it in ${against.length} of your own message${against.length === 1 ? '' : 's'}` : '';
    if (support.length === 1) {
      const r = g[0]!;
      return { key: 'changed_once', value: `${quoted}: removed once, from ${r.purpose ? `a ${r.purpose.replace(/_/g, ' ')}` : 'one'} message${but}`,
        phrases, source: 'edit', evidence: support, against, purpose: r.purpose, ...(r.recipientCategory ? { scope: { recipientCategory: r.recipientCategory, channel: entryChannel(sorted, r.entryId) } } : {}) };
    }
    const people = new Set(g.map((r) => r.contactId ?? r.entryId)).size;
    return { key: 'usually_avoids', value: `usually avoids ${quoted} (removed in ${support.length} of your edits, to ${people} ${people === 1 ? 'person' : 'people'}${but})`,
      phrases, source: 'edits', evidence: support, against };
  });
}

const entryChannel = (sorted: readonly WritingEntry[], id: string): MessageChannel => sorted.find((e) => e.id === id)?.evidence.channel ?? 'EMAIL';

/**
 * The soft rules that inform THIS message: a pattern whose edits outweigh her own uses of the wording, or a single edit of a
 * similar message (same purpose, and the same kind of recipient when known) that her own messages do not contradict.
 * Never checked by the gate.
 */
export function softAvoidFor(rules: readonly WritingRule[], purpose: string, recipientCategory?: RecipientCategory): WritingRule[] {
  const similar = (r: WritingRule): boolean => r.purpose === purpose && (!r.scope || !recipientCategory || r.scope.recipientCategory === recipientCategory);
  return rules.filter((r) => (r.key === 'usually_avoids' || (r.key === 'changed_once' && similar(r))) && (r.against?.length ?? 0) < r.evidence.length);
}

export const isSoftRule = (r: WritingRule): boolean => r.key === 'usually_avoids' || r.key === 'changed_once';

/**
 * The rules a draft can be checked against deterministically (greeting, sign-off, register, "!", dashes). Each failure
 * names the rule and its evidence. Length and never-say are checked by the sendability layer already.
 */
export function checkWritingRules(m: DraftMessage, brief: CommunicationBrief): GateFailure[] {
  const f: GateFailure[] = [];
  const body = m.body ?? '';
  const rule = (k: WritingRuleKey): WritingRule | undefined => brief.writing_rules.find((r) => r.key === k);
  const cite = (r: WritingRule): string => `(${r.source === 'explicit' ? 'her preference' : r.source === 'edits' ? 'her edits' : r.source === 'edit' ? 'one edit' : `her ${r.evidence.length} message${r.evidence.length === 1 ? '' : 's'}`})`;
  const g = rule('greeting');
  if (g) {
    const want = fold(g.value).replace(/[,!.]/g, '').trim().split(/\s+/).slice(0, 2).join(' ');
    if (want && !fold(lines(body)[0] ?? '').startsWith(want)) f.push({ code: 'writing_rule', detail: `She opens with "${g.value}" ${cite(g)}.` });
  }
  const so = rule('signoff');
  if (so) {
    const tail = fold(lines(body).slice(-3).join(' '));
    const want = lines(so.value).map(fold);
    if (want.length && !want.every((w) => tail.includes(w.replace(/[,]/g, '').trim()))) f.push({ code: 'writing_rule', detail: `She signs off with "${so.value.replace(/\n/g, ' / ')}" ${cite(so)}.` });
  }
  const reg = rule('formality');
  if (reg?.register && brief.language === 'ro') {
    const formal = (body.match(RO_FORMAL) ?? []).length;
    const informal = (body.match(RO_INFORMAL) ?? []).length;
    if (reg.register === 'formal' && informal) f.push({ code: 'writing_rule', detail: `She writes in the formal second person (dumneavoastră / vă) ${cite(reg)}; this uses "tu".` });
    if (reg.register === 'informal' && formal) f.push({ code: 'writing_rule', detail: `She writes in the conversational second person (tu) ${cite(reg)}; this uses "dumneavoastră / vă".` });
  }
  const p = rule('punctuation');
  if (p?.noExclamation && body.includes('!')) f.push({ code: 'writing_rule', detail: `She never uses "!" ${cite(p)}.` });
  if (p?.noDashes && /[–—]|\s-\s/.test(body)) f.push({ code: 'writing_rule', detail: `She never uses dashes ${cite(p)}.` });
  return f;
}

/**
 * What she changed in a BB draft, word by word: the runs she removed and the runs she added (an LCS diff over words).
 * Writing evidence only: never read as a business fact or a personality trait.
 */
export function draftEdits(before: string, after: string): { removed: string[]; added: string[] } {
  const a = words(before), b = words(after);
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = fold(a[i]!) === fold(b[j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const removed: string[] = [], added: string[] = [];
  let ra: string[] = [], rb: string[] = [];
  const flush = (): void => { if (ra.length) removed.push(ra.join(' ')); if (rb.length) added.push(rb.join(' ')); ra = []; rb = []; };
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && fold(a[i]!) === fold(b[j]!)) { flush(); i++; j++; }
    else if (j < m && (i >= n || dp[i]![j + 1]! >= dp[i + 1]![j]!)) rb.push(b[j++]!);
    else ra.push(a[i++]!);
  }
  flush();
  const clean = (x: string): string => x.replace(/^[,.;:!?–—-]+|[,.;:!?–—-]+$/g, '').trim();
  return { removed: removed.map(clean).filter(Boolean), added: added.map(clean).filter(Boolean) };
}

/** Removed runs worth keeping as contextual evidence: 2–8 words, no numbers, not added back elsewhere. */
export function removedWording(edits: { removed: string[]; added: string[] }): string[] {
  const back = fold(edits.added.join(' '));
  return edits.removed.filter((r) => { const w = words(r).length; return w >= 2 && w <= 8 && !/\d/.test(r) && !back.includes(fold(r)); });
}
