import { CATALOG, DEFAULT_LOCALE, isLocale, translate, type Locale } from './messages';

/**
 * CONTENT-LANGUAGE STRINGS (rule amendment, 2026-10-13): a UI string that reads as part of BB's sentence about the
 * business ("Everything else is a symptom.", "For: {who}.", "Your bet: {bet}") follows the business's STORED
 * content_language, not the UI locale. Headings, buttons and provenance chips stay English (see LocaleContext).
 *
 * Only the keys below switch language; every other key renders English even when a content language is passed, so a
 * component can route ALL its strings through `contentT` without leaking a translated heading or button.
 */
export const CONTENT_KEYS: ReadonlySet<string> = new Set([
  // Understanding card: the constraint and the stage.
  'arc.understanding.constraint.tail',
  // Understanding v2 (2026-10-15): BB's sentences about the business (headings and basis chips stay English).
  'arc.u2.unknownDims', 'arc.u2.absence', 'arc.u2.whyAsk',
  'arc.u2.dim.offer', 'arc.u2.dim.customer', 'arc.u2.dim.acquisition', 'arc.u2.dim.conversion', 'arc.u2.dim.retention',
  'arc.u2.dim.capacity', 'arc.u2.dim.economics', 'arc.u2.dim.performance', 'arc.u2.dim.intent',
  'arc.u2.basis.observed', 'arc.u2.basis.declared', 'arc.u2.basis.inferred', 'arc.u2.basis.contradicted',
  'arc.u2.dimLower.offer', 'arc.u2.dimLower.customer', 'arc.u2.dimLower.acquisition', 'arc.u2.dimLower.conversion', 'arc.u2.dimLower.retention',
  'arc.u2.dimLower.capacity', 'arc.u2.dimLower.economics', 'arc.u2.dimLower.performance', 'arc.u2.dimLower.intent',
  'arc.u2.reason.sitemap', 'arc.u2.reason.technical', 'arc.u2.reason.sitemap_only', 'arc.u2.reason.unread', 'arc.u2.reason.no_goal', 'arc.u2.reason.not_established',
  'arc.understanding.constraint.none',
  'arc.understanding.servesLead',
  'arc.understanding.stage',
  'arc.understanding.stage.split',
  'arc.understanding.stage.why',
  'arc.understanding.stage.validating',
  'arc.understanding.stage.growth',
  'arc.understanding.stage.plateau',
  'arc.understanding.stage.undetermined',
  'arc.understanding.stage.means.validating',
  'arc.understanding.stage.means.growth',
  'arc.understanding.stage.means.plateau',
  'arc.understanding.stage.means.area.validating',
  'arc.understanding.stage.means.area.growth',
  'arc.understanding.stage.means.area.plateau',
  // Strategy moment.
  'arc.strategy.over',
  'arc.strategy.horizon',
  'arc.strategy.changed',
  // Home briefing lines.
  'home.line.read',
  'home.line.needBet',
  'home.line.canPropose',
  'home.line.bet',
  'home.line.changed.strategy',
  'home.line.changed.impact',
  'home.line.today',
  'home.line.canDraft',
  'home.line.canWork',
  'home.line.ask',
  'home.line.blocked',
  'home.line.shapeWeek',
  'home.close.bet',
  'home.close.did2',
  'home.close.did1',
  'home.close.did0',
  'home.close.ask',
  // Verdict / impact reasons.
  'verdict.because',
  'verdict.newStrategy',
  'verdict.holds',
  'impact.strategy.reconsider',
  'impact.strategy.revise',
  'impact.strategy.holds',
  'impact.today.strategyMoving',
  'impact.today.executionShift',
  'impact.today.unchanged',
  'verdict.queue.one',
  'verdict.queue.many',
]);

/** German exists ONLY as a content language: the UI has no German table, so only the content keys are here. */
const de: Record<string, string> = {
  'arc.understanding.constraint.tail': 'Alles andere ist ein Symptom.',
  'arc.u2.dim.offer': 'Angebot',
  'arc.u2.dim.customer': 'Kunden',
  'arc.u2.dim.acquisition': 'Wie Kunden kommen',
  'arc.u2.dim.conversion': 'Wie sie buchen',
  'arc.u2.dim.retention': 'Wiederkehr und Abos',
  'arc.u2.dim.capacity': 'Kapazität',
  'arc.u2.dim.economics': 'Wirtschaftlichkeit',
  'arc.u2.dim.performance': 'Was funktioniert',
  'arc.u2.dim.intent': 'Dein Ziel',
  'arc.u2.basis.observed': 'in deinen Quellen',
  'arc.u2.basis.declared': 'hast du mir gesagt',
  'arc.u2.basis.inferred': 'meine Lesart',
  'arc.u2.basis.contradicted': 'deine Quellen widersprechen sich',
  'arc.u2.unknownDims': 'Das kann ich noch nicht sagen: {list}.',
  'arc.u2.absence': 'Das habe ich auf den gelesenen Seiten nicht gesehen. Es kann außerhalb der Website existieren.',
  'arc.u2.whyAsk': 'Warum ich frage: {why}',
  'arc.u2.dimLower.offer': 'was du am meisten verkaufst',
  'arc.u2.dimLower.customer': 'wer am meisten kauft',
  'arc.u2.dimLower.acquisition': 'wie Kunden dich finden',
  'arc.u2.dimLower.conversion': 'was sie buchen lässt',
  'arc.u2.dimLower.retention': 'wer wiederkommt',
  'arc.u2.dimLower.capacity': 'wo du noch Platz hast',
  'arc.u2.dimLower.economics': 'was am meisten einbringt',
  'arc.u2.dimLower.performance': 'was wächst oder nachlässt',
  'arc.u2.dimLower.intent': 'was du wachsen lassen willst',
  'arc.u2.reason.sitemap': 'es stützt sich auf die Sitemap, nicht auf Seiten, die deine Website verlinkt',
  'arc.u2.reason.technical': 'es stammt von einer technischen Seite, nicht von dem, was Besucher sehen',
  'arc.u2.reason.sitemap_only': 'die Seite steht nur in der Sitemap und ist nicht verlinkt, sie kann also alt sein',
  'arc.u2.reason.unread': 'keine gelesene Seite stützt es',
  'arc.u2.reason.no_goal': 'ich kenne dein Ziel noch nicht, also nenne ich nichts den Engpass',
  'arc.u2.reason.not_established': 'die Belege zeigen es noch nicht',
  'arc.understanding.constraint.none': 'Nicht genug Belege, um den Engpass zu benennen. Hier sind die Spannungen, die ich sehe.',
  'arc.understanding.servesLead': 'Für: {who}.',
  'arc.understanding.stage': 'Phase: {stage}.',
  'arc.understanding.stage.split': 'Phase: {stage} im Kern; {secondary} im Bereich {area}.',
  'arc.understanding.stage.why': 'Warum: {why}.',
  'arc.understanding.stage.validating': 'Validierung',
  'arc.understanding.stage.growth': 'Wachstum',
  'arc.understanding.stage.plateau': 'Plateau',
  'arc.understanding.stage.undetermined': 'Phase: Das kann ich aus deinen Quellen noch nicht sagen.',
  'arc.understanding.stage.means.validating': 'In dieser Phase: erst validieren, nicht skalieren.',
  'arc.understanding.stage.means.growth': 'In dieser Phase: skalieren, was funktioniert, nicht experimentieren.',
  'arc.understanding.stage.means.plateau': 'In dieser Phase: etwas Grundlegendes ändern, nicht optimieren.',
  'arc.understanding.stage.means.area.validating': 'Im Bereich {area}: erst validieren, nicht skalieren.',
  'arc.understanding.stage.means.area.growth': 'Im Bereich {area}: skalieren, was funktioniert, nicht experimentieren.',
  'arc.understanding.stage.means.area.plateau': 'Im Bereich {area}: etwas Grundlegendes ändern, nicht optimieren.',
  'arc.strategy.over': 'statt {over}',
  'arc.strategy.horizon': 'Der Zeitrahmen: {horizon}.',
  'arc.strategy.changed': 'Ich habe das überarbeitet, weil du mir gesagt hast: „{because}“. So sieht es jetzt aus.',
  'home.line.read': 'Ich habe mir dein Business angesehen.',
  'home.line.needBet': 'Der nächste Schritt ist die eine strategische Wette, die sich lohnt.',
  'home.line.canPropose': 'Ich kann sie vorschlagen, du entscheidest.',
  'home.line.bet': 'Deine Wette: {bet}',
  'home.line.changed.strategy': 'Seit wir zuletzt gesprochen haben: Du hast Strategie v{v} übernommen.',
  'home.line.changed.impact': 'Seit wir zuletzt gesprochen haben: {reason}',
  'home.line.today': 'Heute: {move}',
  'home.line.canDraft': 'Ich kann einen Entwurf schreiben, oder wir sprechen zuerst über Prioritäten.',
  'home.line.canWork': 'Ich kann das mit dir durcharbeiten.',
  'home.line.ask': 'Was möchtest du tun?',
  'home.line.blocked': 'Zuerst: {blocked}',
  'home.line.shapeWeek': 'Deine Wette steht, lass uns die Schritte für diese Woche festlegen.',
  'home.close.bet': 'Vor etwa einem Monat war deine Wette: {bet}',
  'home.close.did2': 'Du hast {a} und {b} durchgezogen.',
  'home.close.did1': 'Du hast {a} durchgezogen.',
  'home.close.did0': 'Dieser Plan ist einen Monat alt.',
  'home.close.ask': 'Was ist passiert? Was hat funktioniert, was nicht?',
  'verdict.because': 'Grund: {reason}',
  'verdict.newStrategy': 'Ich habe eine überarbeitete Strategie entworfen, Version {v}.',
  'verdict.holds': 'Heute bleibt alles gleich. Die Strategie hält.',
  'impact.strategy.reconsider': 'Etwas, das du als Grund zum Umdenken genannt hast, ist eingetreten: {condition}. Ich habe eine überarbeitete Strategie für dich entworfen.',
  'impact.strategy.revise': 'Was du mir gesagt hast, ändert etwas, worauf deine Strategie gebaut hat. Deshalb lohnt sich eine Überarbeitung. Ich habe eine überarbeitete Version für dich entworfen.',
  'impact.strategy.holds': 'Deine zentrale Wette bleibt unverändert.',
  'impact.today.strategyMoving': 'Deine Strategie verschiebt sich.',
  'impact.today.executionShift': 'Wie du arbeitest, ändert sich, die Wette nicht.',
  'impact.today.unchanged': 'Heute bleibt alles gleich. Die Strategie hält.',
  'verdict.queue.one': '1 neues Follow-up wurde hinzugefügt, das erste am {date}.',
  'verdict.queue.many': '{n} neue Follow-ups wurden hinzugefügt, das erste am {date}.',
};

const fill = (raw: string, vars?: Record<string, string>): string =>
  vars ? raw.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? `{${k}}`) : raw;

/** The content-language entry for `key`, or null when `key` is not a content key, the language is English, missing
 *  or unsupported, or the table has no entry (the caller then uses its normal UI string). */
function contentEntry(lang: string | null | undefined, key: string): Record<string, string> | null {
  if (!CONTENT_KEYS.has(key)) return null;
  const l = (lang ?? '').trim().toLowerCase().slice(0, 2);
  if (l === 'de') return de[key] ? de : null;
  if (l !== DEFAULT_LOCALE && isLocale(l) && CATALOG[l][key]) return CATALOG[l];
  return null;
}

/** Translate `key`: a content key in the business's content language (`lang`), anything else in the UI locale
 *  (English in the app). An unknown or missing language, or a missing entry, falls back to the UI locale. */
export function contentT(lang: string | null | undefined, key: string, vars?: Record<string, string>, uiLocale: Locale = DEFAULT_LOCALE): string {
  const table = contentEntry(lang, key);
  return table ? fill(table[key]!, vars) : translate(uiLocale, key, vars);
}

/** Wrap a component's UI translator: content keys follow `lang`, every other key goes through `uiT` unchanged. */
export function withContentLanguage(
  uiT: (key: string, vars?: Record<string, string>) => string, lang: string | null | undefined,
): (key: string, vars?: Record<string, string>) => string {
  return (key, vars) => {
    const table = contentEntry(lang, key);
    return table ? fill(table[key]!, vars) : uiT(key, vars);
  };
}

/** The German content table, exported for tests (parity with CONTENT_KEYS). */
export const CONTENT_DE: Readonly<Record<string, string>> = de;
