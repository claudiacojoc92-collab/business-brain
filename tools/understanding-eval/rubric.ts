/**
 * UNDERSTANDING EVAL — RUBRIC (2026-10-17). The operator's bar for a first read, as checks a human can apply the same
 * way every time ("coerent, structurat, nu audit, strategist"). Pure functions over what the founder SEES (the rendered
 * card lines from stage B) plus the structured view and snapshot (stage A).
 *
 * The detectors here are deliberately FIXED and independent of the product's own governance (which this work changes):
 * the bar must not move when the code under test moves. One judgement stays human, per business, and it is the bar
 * (operator, 2026-10-17): would she send this card to a paying client?
 */
import { detectTextLanguage } from '../../packages/application/src/business/content-language';
import { sameInsight } from '../../packages/application/src/bi/insight-text';

export interface RenderedCard { readonly label: string; readonly lines: readonly string[] }
export interface Rendered { readonly slug: string; readonly run: number; readonly language: string | null; readonly recordName: string; readonly cards: readonly RenderedCard[] }

export interface Scored {
  readonly slug: string;
  readonly run: number;
  /** A decided constraint whose text is on the card. */
  readonly constraintShown: boolean;
  readonly constraintText: string;
  /** Deterministic proxy for "cause, not symptom": the constraint does not restate a tension shown with it. */
  readonly constraintRestatesTension: boolean;
  /** Items in the tension / matters sections of the card. */
  readonly tensionCount: number;
  /** Of those, how many name one of the business's own things (an offer, a place, a person) or a number. */
  readonly tensionsConcrete: number;
  /** A stage word (growth / validating / plateau, in any supported language) on the card. */
  readonly stageShown: boolean;
  readonly housekeeping: string[];
  readonly behaviour: string[];
  /** BB-written lines whose detected language differs from the business's content language. */
  readonly wrongLanguage: string[];
  /** The record name appears on the card although the business's own material never uses it (D4). */
  readonly recordNameMisused: boolean;
  /** Sentences repeated inside this card. */
  readonly repeatsWithin: string[];
}

/** Section labels that hold tensions / "what matters" items (UI English plus the content-language variants). */
const TENSION_SECTIONS = /^(what stood out|also on my mind|what i noticed|what i think matters here|ce mi-a s[ăa]rit [îi]n ochi|m[ăa] mai g[âa]ndesc la|ce am observat|cosa mi ha colpito|ho anche in mente|cosa ho notato|was mir aufgefallen ist|was mir noch durch den kopf geht|was ich bemerkt habe)/iu;
const CONSTRAINT_SECTION = /^(your real constraint|constr[âa]ngerea ta real[ăa]|il tuo vero vincolo|deine eigentliche (engstelle|einschr[äa]nkung)|.*constraint)/iu;
const QUESTIONS_SECTION = /(what i need to know next|what i'?ll ask|ce te voi întreba|unknowns|questions)/iu;
const UI_ONLY = /^(understanding|what i understand about your business|what i read|what i need to know next|my first read|→)/iu;
const STAGE_WORDS = /(?<!\p{L})(growth|validating|plateau|cre[șs]tere|validare|platou|wachstum|validierung|crescita|validazione)(?!\p{L})/iu;

/**
 * WEBSITE HOUSEKEEPING: the site's structure, not the business (menu, navigation, buttons, counters, sitemap, footer,
 * maintenance or test pages, indexing, links). Such an item belongs in website notes, never in a tension.
 */
const HOUSEKEEPING = /(?<!\p{L})(meniu\p{L}*|menu\p{L}*|navig\p{L}*|sitemap\p{L}*|buton\p{L}*|button\p{L}*|contor\p{L}*|counter\p{L}*|footer|subsol|mentenan\p{L}*|maintenance|indexa\p{L}*|indexed|link\p{L}* direct|homepage|pagina principal\p{L}*|pagina de start|startseite|schaltfl[äa]che\p{L}*|navigation)(?!\p{L})/iu;

/**
 * BEHAVIOUR PREDICTIONS (the narrowed ban, operator 2026-10-17): claims about how people FEEL, whether they convert, or
 * what they WILL do. Still allowed, because it is about available information: what a customer cannot see, judge or
 * check from the sources ("a patient cannot judge the programme before booking").
 */
const BEHAVIOUR = /(?<!\p{L})(pleac\p{L}*|p[ăa]r[ăa]se[șs]t\p{L}*|renun[țt]\p{L}*|ezit\p{L}*|abandon\p{L}*|trec\p{L}* mai departe|merg [îi]n alt[ăa] parte|nu (mai )?au [îi]ncredere|nu vor avea [îi]ncredere|se simt|simt c[ăa]|confuz\p{L}*|vor cump[ăa]ra|vor alege|convertesc|se convertesc|leave|leaves|bounce|hesitat\p{L}*|give up|gives up|move on|go elsewhere|won'?t trust|will not trust|don'?t trust|feel (that|like|confused|unsure)|get confused|will buy|will choose|converts?|converting|verlassen|z[öo]gern|springen ab|lasciano|esitano)(?!\p{L})/iu;

const norm = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const sentences = (line: string): string[] => line.split(/(?<=[.!?])\s+(?=\p{Lu})/u).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 4);

/** Lines BB composed (not the English UI chrome, which D3 keeps out of the language check). */
export function bbLines(r: Rendered): string[] {
  return r.cards.filter((c) => !/^understanding$/i.test(c.label)).flatMap((c) => c.lines).filter((l) => !UI_ONLY.test(l));
}

export function score(r: Rendered, opts: { constraint: { decided: boolean; text?: string } | null | undefined; entities: readonly string[]; sourceText: string }): Scored {
  const all = r.cards.flatMap((c) => c.lines);
  const tensionLines = r.cards.filter((c) => TENSION_SECTIONS.test(c.label)).flatMap((c) => c.lines);
  const constraintText = (opts.constraint?.decided ? opts.constraint.text ?? '' : '').trim();
  const constraintCard = r.cards.find((c) => CONSTRAINT_SECTION.test(c.label));
  const constraintShown = Boolean(constraintText) && (all.some((l) => l.includes(constraintText.slice(0, 40))) || Boolean(constraintCard?.lines.length));
  const concrete = (t: string): boolean => /\d/.test(t) || opts.entities.some((e) => e.length >= 4 && t.toLowerCase().includes(e.toLowerCase()));
  const lang = (r.language ?? '').slice(0, 2);
  const wrongLanguage = bbLines(r).filter((l) => l.split(/\s+/).length >= 6).filter((l) => { const d = detectTextLanguage(l); return Boolean(d) && Boolean(lang) && d !== lang; });
  const seen = new Map<string, number>();
  for (const s of all.flatMap(sentences)) seen.set(norm(s), (seen.get(norm(s)) ?? 0) + 1);
  const recordInSources = opts.sourceText.toLowerCase().includes(r.recordName.toLowerCase());
  return {
    slug: r.slug,
    run: r.run,
    constraintShown,
    constraintText,
    constraintRestatesTension: Boolean(constraintText) && tensionLines.some((t) => sameInsight(constraintText, t)),
    tensionCount: tensionLines.length,
    tensionsConcrete: tensionLines.filter(concrete).length,
    stageShown: all.some((l) => STAGE_WORDS.test(l)),
    housekeeping: tensionLines.filter((t) => HOUSEKEEPING.test(t)),
    // A question asks about behaviour, it does not predict it: the questions card is not checked.
    behaviour: r.cards.filter((c) => !QUESTIONS_SECTION.test(c.label)).flatMap((c) => c.lines).filter((l) => !UI_ONLY.test(l) && BEHAVIOUR.test(l)),
    wrongLanguage,
    recordNameMisused: !recordInSources && all.some((l) => l.includes(r.recordName)),
    repeatsWithin: [...seen.entries()].filter(([, n]) => n > 1).map(([s]) => s),
  };
}

/**
 * CROSS-BUSINESS REPEATS: a sentence (or a sentence opening of six or more words) that appears on the cards of two or
 * more DIFFERENT businesses. That is a template, not a reading, whoever wrote it.
 */
export function crossBusinessRepeats(rendered: readonly Rendered[]): { sentence: string; businesses: string[] }[] {
  const bySentence = new Map<string, Set<string>>();
  const add = (key: string, slug: string): void => { const set = bySentence.get(key) ?? new Set<string>(); set.add(slug); bySentence.set(key, set); };
  for (const r of rendered) {
    for (const s of bbLines(r).flatMap(sentences)) {
      const n = norm(s);
      add(n, r.slug);
      const opening = n.split(' ').slice(0, 6).join(' ');
      if (n.split(' ').length > 6) add(`${opening} …`, r.slug);
    }
  }
  return [...bySentence.entries()].filter(([, s]) => s.size > 1).map(([sentence, s]) => ({ sentence, businesses: [...s].sort() }));
}

/** The bar, per business and run: true only when every deterministic check passes (the human columns come on top). */
export function meetsBar(s: Scored): boolean {
  return s.constraintShown && !s.constraintRestatesTension && s.tensionCount >= 3 && s.tensionCount <= 4 && s.tensionsConcrete === s.tensionCount
    && s.stageShown && !s.housekeeping.length && !s.behaviour.length && !s.wrongLanguage.length && !s.recordNameMisused && !s.repeatsWithin.length;
}
