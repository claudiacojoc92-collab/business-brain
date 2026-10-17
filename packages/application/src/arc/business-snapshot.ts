import type { GovernedUnderstanding } from '../bi/index';
import type { ThesisRecord } from './theses';

/**
 * BUSINESS SNAPSHOT (2026-10-17): before Business Brain interprets the business, the founder sees that it understood WHAT
 * the business is. A pure projection at view time from facts that are already governed: the stored offer summary, the
 * observed location line, the stored audience summary, the structural mechanisms verified on the pages, and the thesis
 * business model (entry offers, how motions are bought and continued). Never persisted, never written by a model here,
 * never from implied positioning, website notes or judgements. Fixed templates per content language, ≤ 90 words.
 */
export interface BusinessSnapshot {
  readonly kind: string | null;                    // what the business sells (stored offer summary)
  readonly where: { readonly area: string | null; readonly locations: number | null; readonly names: string[] } | null;
  readonly forWhom: string | null;                 // stored audience summary
  readonly ways: { readonly kind: 'direct' | 'paid_first_step' | 'one_to_one' | 'timetable'; readonly offers: string[] }[];
  readonly continuity: ('sessions' | 'package' | 'subscription')[];
  readonly provenance: { readonly kind: 'observed'; readonly where: 'observed'; readonly forWhom: 'observed'; readonly ways: 'structural'; readonly continuity: 'structural' };
  /** The founder-facing text (2–3 sentences); '' when there is too little to say. */
  readonly text: string;
}

const LOCATION_WORD = /(?<!\p{L})(loca[țt]i\p{L}*|location\p{L}*|sed[ei]\b|standort\p{L}*|filial\p{L}*)(?!\p{L})/iu;
const COUNT: Record<string, number> = { una: 1, unu: 1, o: 1, one: 1, due: 2, două: 2, doua: 2, doi: 2, two: 2, zwei: 2, trei: 3, three: 3, tre: 3, drei: 3, patru: 4, four: 4, quattro: 4, vier: 4 };
const withoutParentheses = (t: string): string => t.replace(/\s*\([^)]*\)/gu, '').replace(/\s{2,}/gu, ' ').trim();

/** The observed location line ("Două locații în Cluj-Napoca: Bună Ziua (…) și Decebal."), parsed generically. */
function whereOf(u: GovernedUnderstanding): { line: string; area: string | null; locations: number | null; names: string[] } | null {
  const lines = (u.read?.model ?? []).flatMap((d) => (d.known ?? []).filter((k) => k.basis === 'observed').map((k) => k.text ?? ''));
  // A location LINE states how many locations there are ("Două locații în …", "Two locations in …"), not a mention of one.
  const counted = new RegExp(`^(?:\\d+|${Object.keys(COUNT).join('|')})\\s+(?:loca[țt]i\\p{L}*|location\\p{L}*|sed[ei]|standort\\p{L}*|filial\\p{L}*)`, 'iu');
  const line = lines.find((x) => LOCATION_WORD.test(x) && counted.test(x.trim()));
  if (!line) return null;
  const clean = withoutParentheses(line).replace(/\.\s*$/u, '');
  const [head, list] = clean.includes(':') ? [clean.slice(0, clean.indexOf(':')), clean.slice(clean.indexOf(':') + 1)] : [clean, ''];
  const n = head.match(/(\d+)|(?<!\p{L})(\p{L}+)\s+loca|(?<!\p{L})(\p{L}+)\s+location/iu);
  const locations = n ? (n[1] ? Number(n[1]) : COUNT[(n[2] ?? n[3] ?? '').toLowerCase()] ?? null) : null;
  const area = head.match(/(?<!\p{L})(?:în|in|a|im)\s+([\p{Lu}][\p{L}-]*(?:\s+[\p{Lu}][\p{L}-]*)*)\s*$/u)?.[1] ?? null;
  const names = list.split(/,\s*|\s+(?:și|and|e|und)\s+/u).map((x) => x.trim()).filter(Boolean);
  return { line: clean, area, locations, names };
}

const T: Record<string, {
  has: (name: string, where: string) => string; forWhom: (offer: string, who: string) => string;
  direct: (cont: string) => string; firstStep: (offers: string) => string; both: (cont: string, offers: string) => string;
  cont: Record<'sessions' | 'package' | 'subscription', string>; or: string; and: string;
}> = {
  ro: { has: (n, w) => `${n} are ${w}.`, forWhom: (o, w) => `${o}, pentru ${w}.`,
    direct: (c) => `Serviciile se rezervă direct, ${c}.`, firstStep: (o) => `Unele servicii încep cu un prim pas plătit: ${o}.`,
    both: (c, o) => `Unele servicii se rezervă direct, ${c}, iar altele încep cu un prim pas plătit: ${o}.`,
    cont: { sessions: 'per ședință', package: 'cu pachet', subscription: 'cu abonament' }, or: 'sau', and: 'și' },
  en: { has: (n, w) => `${n} has ${w}.`, forWhom: (o, w) => `${o}, for ${w}.`,
    direct: (c) => `Services are booked directly, ${c}.`, firstStep: (o) => `Some services start with a paid first step: ${o}.`,
    both: (c, o) => `Some services are booked directly, ${c}, while others start with a paid first step: ${o}.`,
    cont: { sessions: 'per session', package: 'as a package', subscription: 'with a subscription' }, or: 'or', and: 'and' },
  it: { has: (n, w) => `${n} ha ${w}.`, forWhom: (o, w) => `${o}, per ${w}.`,
    direct: (c) => `I servizi si prenotano direttamente, ${c}.`, firstStep: (o) => `Alcuni servizi iniziano con un primo passo a pagamento: ${o}.`,
    both: (c, o) => `Alcuni servizi si prenotano direttamente, ${c}, altri iniziano con un primo passo a pagamento: ${o}.`,
    cont: { sessions: 'a seduta', package: 'con un pacchetto', subscription: 'con un abbonamento' }, or: 'o', and: 'e' },
  de: { has: (n, w) => `${n} hat ${w}.`, forWhom: (o, w) => `${o}, für ${w}.`,
    direct: (c) => `Die Angebote werden direkt gebucht, ${c}.`, firstStep: (o) => `Manche Angebote beginnen mit einem bezahlten ersten Schritt: ${o}.`,
    both: (c, o) => `Manche Angebote werden direkt gebucht, ${c}, andere beginnen mit einem bezahlten ersten Schritt: ${o}.`,
    cont: { sessions: 'pro Termin', package: 'als Paket', subscription: 'im Abo' }, or: 'oder', and: 'und' },
};
const list = (xs: string[], joiner: string): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} ${joiner} ${xs[xs.length - 1]}`);
const lowerFirst = (t: string): string => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const words = (t: string): number => (t.match(/\p{L}+/gu) ?? []).length;
const MAX_WORDS = 90;

export function businessSnapshot(u: GovernedUnderstanding | null, record: ThesisRecord | null, businessName: string, language: string): BusinessSnapshot | null {
  if (!u) return null;
  const t = T[language.slice(0, 2)] ?? T['en']!;
  const w = whereOf(u);
  // What it sells: the stored offer summary; its own trailing location clause goes when the location line is shown.
  let kind = (u.offer?.summary ?? '').trim().replace(/\.\s*$/u, '') || null;
  if (kind && w) kind = kind.replace(/,?\s+(?:în|in|a|an)\s+(?:\d+|\p{L}+)\s+(?:loca[țt]i\p{L}*|location\p{L}*|sed[ei]|standort\p{L}*)\b.*$/iu, '').trim();
  const forWhom = (u.audience?.summary ?? '').trim().replace(/\.\s*$/u, '').replace(/,?\s+(?:din|from|di|aus)\s+[\p{Lu}][\p{L}-]*(?:[\s-][\p{Lu}][\p{L}-]*)*$/u, '').trim() || null;
  // How it is bought and continued: the verified mechanisms and the thesis business model.
  const mech = new Set((u.read?.structure?.mechanisms ?? []).map((m) => m.kind));
  const motions = record?.businessModel.motions ?? [];
  const entry = [...new Set((record?.businessModel.offerRoles ?? []).filter((o) => o.role === 'entry').flatMap((o) => o.offer.split(/\s+\/\s+/u)).map((o) => o.trim()).filter(Boolean))];
  const direct = motions.some((m) => m.buying.some((b) => ['booking', 'checkout', 'direct_purchase'].includes(b))) || mech.has('group_timetable');
  const ways: BusinessSnapshot['ways'] = [
    ...(direct ? [{ kind: 'direct' as const, offers: [] }] : []),
    ...(mech.has('paid_first_step') || entry.length ? [{ kind: 'paid_first_step' as const, offers: entry }] : []),
    ...(mech.has('one_to_one') ? [{ kind: 'one_to_one' as const, offers: [] }] : []),
    ...(mech.has('group_timetable') ? [{ kind: 'timetable' as const, offers: [] }] : []),
  ];
  const forms = new Set(motions.flatMap((m) => m.continuation));
  const continuity = (['sessions', 'package', 'subscription'] as const).filter((c) =>
    (c === 'sessions' && (forms.has('repeat_purchase') || forms.has('ongoing_service'))) || (c === 'package' && (forms.has('package') || mech.has('packages'))) || (c === 'subscription' && forms.has('subscription')));
  // The fixed sentences.
  const s1 = w ? t.has(businessName, lowerFirst(w.line)) : '';
  // The audience once: when the offer summary already says who it serves, it is not repeated.
  const namesWho = kind ? /(?<!\p{L})(pentru|for|per|für)\s/iu.test(kind) : false;
  const s2 = kind ? (forWhom && !namesWho ? t.forWhom(kind, lowerFirst(forWhom)) : `${kind}.`) : '';
  const cont = list(continuity.map((c) => t.cont[c]), t.or);
  const firstStep = ways.find((x) => x.kind === 'paid_first_step');
  const s3 = direct && cont && firstStep?.offers.length ? t.both(cont, list(firstStep.offers, t.and))
    : direct && cont ? t.direct(cont)
      : firstStep?.offers.length ? t.firstStep(list(firstStep.offers, t.and)) : '';
  // Within the word budget: the audience clause goes first, then the way-of-buying sentence.
  let parts = [s1, s2, s3].filter(Boolean);
  if (words(parts.join(' ')) > MAX_WORDS && kind) parts = [s1, `${kind}.`, s3].filter(Boolean);
  if (words(parts.join(' ')) > MAX_WORDS) parts = [s1, kind ? `${kind}.` : ''].filter(Boolean);
  const text = parts.length >= 2 ? parts.join(' ') : '';
  return {
    kind, where: w ? { area: w.area, locations: w.locations, names: w.names } : null, forWhom, ways, continuity,
    provenance: { kind: 'observed', where: 'observed', forWhom: 'observed', ways: 'structural', continuity: 'structural' },
    text,
  };
}
