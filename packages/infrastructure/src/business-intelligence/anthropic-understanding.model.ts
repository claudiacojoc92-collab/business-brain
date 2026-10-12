import { createAnthropicClient } from '../llm/anthropic-client';
import { VOICE_RULES,
  sameInsight,
  visibilityPhrased,
  type IUnderstandingModelPort,
  type UnderstandingModelInput,
  type SynthesisOutput,
  type PageObservation,
  type GovernedUnderstanding,
} from '@bb/application';

/**
 * Propose-only understanding synthesis (Slice 1). The model reads grounded SOURCE observations — OBSERVED
 * website pages and/or FOUNDER-SUPPLIED (declared) material — and proposes structured governed understanding
 * (Offer/Positioning/Audience + Messaging/Acquisition reads) plus Aha findings, each citing source refs. It
 * never fetches or invents facts, preserves the observed-vs-declared lane honestly, and the application layer
 * validates + grounds the result deterministically.
 */

const LANG_NAME: Record<string, string> = { ro: 'Romanian', en: 'English', it: 'Italian' };
const PER_PAGE_CHARS = 3500;
const INSTAGRAM_SUMMARY_CHARS = 8000; // the one Instagram source carries up to 50 posts
const MAX_WEBSITE_PAGES_ALONE = 10;  // website-only: unchanged
const MAX_WEBSITE_PAGES_MIXED = 8;   // with other sources: website pages give up two slots

/** Legacy single-source paths don't tag sourceKind: an observed page is a website page, declared text is not. */
const isWebsitePage = (o: PageObservation): boolean => (o.sourceKind ? o.sourceKind === 'website' : o.provenance !== 'declared');

/**
 * Which sources the model reads. Website pages are capped; every non-website source (files, links, pasted text,
 * the Instagram summary) is ALWAYS included. The old rule (first 10 of the union, website first) silently dropped
 * everything a founder added beyond their website.
 */
export function selectSources(observations: PageObservation[]): PageObservation[] {
  const website = observations.filter(isWebsitePage);
  const other = observations.filter((o) => !isWebsitePage(o));
  return [...website.slice(0, other.length ? MAX_WEBSITE_PAGES_MIXED : MAX_WEBSITE_PAGES_ALONE), ...other];
}

export function buildSourcesBlock(observations: PageObservation[]): string {
  return selectSources(observations)
    .map((o) => {
      const max = o.sourceKind === 'instagram' ? INSTAGRAM_SUMMARY_CHARS : PER_PAGE_CHARS;
      const text = o.text.length > max ? o.text.slice(0, max) : o.text;
      if (o.sourceKind === 'instagram') {
        return `### OBSERVED-INSTAGRAM ref="${o.ref}" url="${o.url}"\n${text}`;
      }
      if (o.provenance === 'declared') {
        return `### FOUNDER-SUPPLIED ref="${o.ref}" (the founder pasted this for you to inspect — declared, not independently observed)\n${text}`;
      }
      return `### OBSERVED-PAGE ref="${o.ref}" url="${o.url}"${o.title ? ` title="${o.title}"` : ''}\n${text}`;
    })
    .join('\n\n');
}

/**
 * The fixed order in which a constraint's root cause is searched (operator, 2026-10-12): users → target → offer → time.
 * Shared by the first reading and the retry, so both land on the same cause instead of two plausible different ones.
 */
const ROOT_CAUSE_ORDER = [
  '  1. USERS: has anyone actually bought or used it? If the sources show no paying or named customer, user or',
  '     result for the core offer, the constraint is that (e.g. "You have not yet had a customer use X and get a result.").',
  '     Members, clients, customers, placements, students, named participants or a member list ALL count as users. If the',
  '     sources show users exist, this level is PASSED: "no published result / testimonial / success story" is then a',
  '     proof tension, NOT the constraint. Go to 2.',
  '  2. TARGET: if there are users, have you chosen who it is for? If the sources speak to several audiences or',
  '     directions with no priority, the constraint is that choice.',
  '  3. OFFER: if users and target are clear, is the offer finished? If it is still changing, incomplete or not buyable,',
  '     the constraint is that.',
  '  4. Only if none of these is supported: where your time and effort go instead.',
  '  Stop at the FIRST level the sources support. Do not skip to a later level because it sounds more interesting.',
  '  WRITE IT DOWN: constraint.levelCheck answers each level\'s question with passed (true = this level is NOT the',
  '  problem) and one short piece of evidence from the sources (e.g. users: {"passed": true, "evidence": "hundreds of',
  '  members listed"}). constraint.level = the FIRST level whose passed is false ("time" only if all three passed).',
  '  A business whose stage is growth or plateau has users, so its users level is passed.',
];

function systemPromptBase(lang: string): string {
  const langName = LANG_NAME[lang] ?? 'English';
  return [
    'You are the analyst inside Business Brain. You read a business\'s SOURCE material and produce',
    'GROUNDED, business-specific understanding. You never invent facts, never assume anything the',
    'sources do not support, and you preserve unknowns and contradictions honestly.',
    '',
    'Sources come in two lanes, and you MUST preserve the difference:',
    '- OBSERVED-PAGE blocks = fetched from the business\'s own website (what the site shows).',
    '- OBSERVED-INSTAGRAM blocks = the business\'s own Instagram account (recent posts: date, caption, likes,',
    '  comments), read through the Instagram API. Observed, like the website: what the business posts publicly.',
    '- FOUNDER-SUPPLIED blocks = text the founder pasted for you to inspect. This is DECLARED, the',
    '  founder\'s own self-description — NOT independently observed reality. Attribute it as what the',
    '  founder states ("the founder describes…", "you told me…"), and NEVER treat a founder\'s marketing',
    '  claim in supplied material as evidence the market/customers agree. Put it in the same understanding',
    '  sections, but keep the provenance honest in your wording.',
    '',
    'You will receive labelled blocks. Cite evidence ONLY by the exact `ref` labels given.',
    'Never cite a ref that was not provided.',
    '',
    `LANGUAGE — two halves, each internally consistent. The FOUNDER'S LANGUAGE is ${langName} (the language they read the app in). The dividing axis is PROSE YOU COMPOSE vs ITEMS YOU LIFT.`,
    `(a) PROSE YOU COMPOSE — your own sentences, written FOR the founder, in whatever section they appear: offer.summary, positioning.summary, offer.unclear, positioning.implied, audience.appearsTargeted, audience.unknown, understanding.unknowns, contradictions[].tension, contradictions[].soWhat, capabilityCheck.insight, constraint.statement, constraint.why, stage.evidence, stage.secondary.area, stage.secondary.evidence, and every aha.findings[].finding and aha.findings[].implication. Write ALL of these in ${langName}, whatever language the site is in.`,
    '(b) ITEMS YOU LIFT — material taken from the source so the founder recognises it on their own site: offer.explicit, positioning.evidenceBacked, audience.addressed, messaging.recurringThemes, acquisition.visiblePaths, and contradictions[].statementA / contradictions[].statementB. Keep these in the LANGUAGE OF THE SOURCE they come from.',
    `Business, brand, product and service names — and any specific page or service you cite — stay in their ORIGINAL language in BOTH halves. A ${langName} summary or tension still names "ghișeu unic" / "Atelier Automasaj" exactly as the site writes it.`,
    `MIXED-LANGUAGE SOURCE — the blocks may be in different languages (e.g. a Romanian website plus English founder-supplied answers). This does NOT change the rule. A lifted item keeps the language of the block it came from; when you compose prose drawing across blocks of different languages, write it in ${langName} and keep the foreign terms verbatim. Half (a) is ALWAYS ${langName}, regardless of the source mix.`,
    `NO DRIFT within each half: every lifted item is one consistent source language; every composed field is entirely ${langName}. Never mix languages inside a single field except for the preserved proper nouns above.`,
    '',
    'Return ONLY valid JSON (no markdown, no commentary) with EXACTLY this shape:',
    '{',
    '  "sourceLanguage": "<ISO code of the site language>",',
    '  "understanding": {',
    '    "offer": {"summary": "", "explicit": [], "unclear": [], "sourceRefs": []},',
    '    "positioning": {"summary": "", "evidenceBacked": [], "implied": [], "sourceRefs": []},',
    '    "audience": {"addressed": [], "appearsTargeted": [], "unknown": [], "sourceRefs": []},',
    '    "messaging": {"recurringThemes": [], "sourceRefs": []},',
    '    "acquisition": {"visiblePaths": [], "sourceRefs": []},',
    '    "contradictions": [{"kind": "", "statementA": "", "statementB": "", "tension": "", "soWhat": "", "sourceRefs": []}],',
    '    "unknowns": [],',
    '    "capabilityCheck": {"sells": "", "shown": true, "insight": "", "soWhat": "", "sourceRefs": []},',
    '    "constraint": {"decided": true, "level": "users|target|offer|time", "levelCheck": {"users": {"passed": true, "evidence": ""}, "target": {"passed": true, "evidence": ""}, "offer": {"passed": true, "evidence": ""}}, "statement": "", "why": "", "sourceRefs": []},',
    '    "stage": {"stage": "validating|growth|plateau|undetermined", "evidence": [], "sourceRefs": [], "secondary": {"stage": "", "area": "", "evidence": []}}',
    '  },',
    '  "aha": {"findings": [{"finding": "", "implication": "", "sourceRefs": []}]}',
    '}',
    '',
    'Rules:',
    '- Every non-empty section should cite the source refs it draws from.',
    '- If the sources do not support a section, leave it empty / list it under unknowns. Unknown is valid.',
    '- contradictions: 3 to 4 real tensions about the BUSINESS (see STRATEGIC LENS), each on a DIFFERENT dimension,',
    '  RANKED by severity: the first is the biggest. Includes tensions between what the site/Instagram shows and what',
    '  the founder supplied. Each MUST be SPECIFIC (see below). Fewer than 3 only when the sources genuinely hold fewer.',
    '- aha.findings: 2 to 3 findings, RANKED (the first is the most important), each SPECIFIC to THIS business and tied',
    '  to source specifics or a real tension. Each finding MUST include at least one valid sourceRef. NO generic advice',
    '  ("post more", "stronger CTA", "know your audience", "improve SEO", "be consistent").',
    '- If there is not enough on the site to say anything specific, return "aha": {"findings": []}.',
    '- Be concise: at most 5 items per array; short phrases, not paragraphs. Output must be complete JSON.',
    '- offer.summary = ONE sentence, at most 25 words: what you sell and to whom. No feature list.',
    '- positioning.summary = ONE sentence, at most 20 words: what you are betting on.',
    '',
    'VOICE — you are talking TO the founder. Every sentence you COMPOSE (offer.summary, positioning.summary, unknowns,',
    'contradictions[].tension, contradictions[].soWhat, capabilityCheck.insight, capabilityCheck.soWhat, aha findings and',
    'implications) is in the SECOND PERSON, PRESENT TENSE: "You sell X. You don\'t show X." Never "The business sells",',
    '"The product offers", "<business name> sells" or "the founder". Lifted items keep the source\'s own wording.',
    '',
    'CLAIM-TYPE DISCIPLINE (critical). You only have the business\'s own website and/or the founder\'s',
    'supplied self-description — no market, competitor, or customer-behavior data (a founder\'s own claim',
    'is not market evidence). So your claims are limited BY TYPE, not by wording:',
    '- ALLOWED: source observations (what a page says), structural inconsistencies (two pages',
    '  disagree), discoverability/prominence (only found deep in the site), visible conversion-path',
    '  observations (there is/ is no contact or buy path), visible message/audience tensions, and',
    '  sold-vs-shown gaps (what the business sells or promises vs what its own sources show of it).',
    '- NOT ALLOWED from a website alone — even hedged with "may/could/appears":',
    '    • market/competitive claims (rare, unique, differentiator, better than competitors);',
    '    • trust/credibility claims (builds/erodes credibility or trust);',
    '    • loyalty claims (deepens loyalty / retention);',
    '    • conversion/purchase claims (increases conversion, attracts leads, leaves revenue);',
    '    • audience/psychological/emotional-response claims (resonates, makes visitors more likely);',
    '    • strategic recommendations (you should reposition/redesign).',
    '  Hedging does NOT license these. If you want to say one, either RECAST it as a source/structural',
    '  observation, or drop it, or put the open question into "unknowns".',
    '- A "finding" = one sharp, source-anchored sentence about what the BUSINESS sells, shows or does, read across',
    '  all its sources (not about how a page is built).',
    '- An "implication" = ONE bounded sentence that stays inside the allowed types. Good implication',
    '  shapes: "…so what it sells is the one thing a visitor never gets to see", "…so a visitor can encounter',
    '  conflicting information", "…so this is hard to discover on the site", or "…a distinct thread worth carrying',
    '  into the founder conversation." Omit the',
    '  implication entirely if you cannot stay within the allowed claim types.',
    '- "distinctive/distinct" is allowed ONLY to mean distinct WITHIN this business\'s own offer — never',
    '  "different from competitors".',
    '- Romanian/Italian must preserve the bounded meaning (poate/pare, può/sembra) and obey the same',
    '  claim-type limits — never strengthen into dovedește/demonstrează or dimostra/prova.',
    '',
    'STRATEGIC LENS — you are reading a BUSINESS, not auditing a website. This decides what goes in contradictions',
    'and aha.findings:',
    '- Ask first: what does this business sell or promise, to whom, and what is it actually betting on? Then find where',
    '  that does not line up with what its own sources show or do. Those gaps are the contradictions.',
    '- The contradictions worth naming are about the BUSINESS. Typical shapes:',
    '    • sold vs shown: it sells X, but its own sources never show X (no example, no case, no sample of the work);',
    '    • promised vs demonstrated: it promises an outcome or a method, but nothing in the sources demonstrates it;',
    '    • stated priority vs where the effort goes: the site says X is the core, but the posts/pages/space go to Y;',
    '    • public story vs supplied reality: what the site or Instagram says vs what the founder supplied;',
    '    • who it says it serves vs who it actually speaks to.',
    '- CAPABILITY CHECK (always run it): if the business sells a capability (a method, expertise, a service, a system,',
    '  a result), check whether its own sources demonstrate that capability anywhere. A business that sells X and',
    '  never shows X is the PRIMARY contradiction: when the check finds this gap, it MUST be contradictions[0] and',
    '  aha.findings[0], ahead of every other tension (including ones about the founder\'s social accounts).',
    '  State it ONCE, at the level of the CORE offer and across ALL sources together ("its site and its posts show no',
    '  X"), never per channel: a version limited to one source (e.g. "its Instagram never shows X") is NOT a separate',
    '  item, fold it into the core one. Only this core, all-sources gap gets kind "capability_gap"; at most ONE item.',
    '- NOT contradictions (website housekeeping): anything about legal pages (Privacy, Terms, Data Deletion: their',
    '  dates, versions or wording), vague or generic copy, a missing link, footer/contact details, page structure,',
    '  typos, what kind of account something is, and ANY CRITIQUE OF A PHRASE ON THE SITE: what a quoted phrase',
    '  means, signals, frames, implies or hints at (future scope, a roadmap, other areas), that nothing in the sources',
    '  supports, develops or explains a phrase or framing, slogans, a claim positioned against nothing. These NEVER',
    '  appear in ANY field you compose: not in contradictions, aha.findings, positioning.implied, the summaries or',
    '  unknowns. Never pad with them: a real strategic tension on another dimension, or fewer items.',
    '- THE DIMENSIONS — check each one against the sources; every contradiction is about a DIFFERENT one:',
    '    • capability: you sell X; do your sources show X (an example, a sample of the output, a result)?',
    '    • customer proof: does any source show a real PERSON who bought or used it (a named customer, a testimonial, a',
    '      number of users, a before/after of one client)? This is about people, not about your output: if your item is',
    '      "no source shows what the output looks like", that is the capability item, not this one.',
    '    • channel: does your most active public channel (usually Instagram) speak about what you sell, to the people',
    '      you sell to? A channel with most of your public activity and nothing about your offer is a tension.',
    '    • commercial path: how does this make money? A free period, trial or pilot with no stated path to paid, or',
    '      no visible price or way to buy, is a strategic gap, not a detail.',
    '    • audience: who you say you serve vs who your sources actually speak to.',
    '    • priority vs effort: what you say is core vs where the space, detail and posts actually go.',
    '- A GAP YOU CAN SEE IS AN OBSERVATION, NEVER A QUESTION. If the sources show a free trial and no price, write the',
    '  observation ("You offer a free trial and show no price or way to pay."), not "What will you charge after the',
    '  trial?". Same for a channel that never mentions the offer, or no customer result anywhere. unknowns hold ONLY what',
    '  nobody can see from outside: your goal, what you are prioritising, what customers told you privately, numbers',
    '  you have not published. Each is a direct question to you; at most 3. Once a contradiction states a gap, NO',
    '  question may ask about that gap again (no "when does the trial end / what will it cost" next to a commercial_path',
    '  item, no "is this account yours" next to a channel_mismatch item).',
    '- TENSION FORM: contradictions[].tension states the observation ONLY, in two short sentences, second person:',
    '  "You sell X. Your site and your posts never show X." No consequence in the tension; it goes in soWhat.',
    '- THE SO-WHAT TEST: contradictions[].soWhat is the CONSEQUENCE, never a paraphrase of the tension. One sentence,',
    '  shaped "This means <what your customers cannot see, judge or do>, so <what that leaves you with or what you are',
    '  really betting on>." If it repeats the tension in other words, it is wrong; the "so" half names what this leaves',
    '  YOU with (what has to carry the sale instead, what you are betting on without saying so), never "so X is not',
    '  shown / undemonstrated / unverifiable". If you cannot write a consequence, drop the item. The claim-type limits',
    '  apply: no "credibility", "reputation", "conversion", "revenue" or "engagement" (a so-what using them is removed).',
    '  A so-what MAY say what your customers have to take on trust or on your word because they cannot check it.',
    '    • BAD (audit): "The Privacy Policy and the Terms carry different last-updated dates."',
    '    • BAD (paraphrase so-what): tension "You sell rehab programmes. No page shows one.", soWhat "No programme',
    '      appears anywhere on the site."',
    '    • GOOD: tension "You sell personalised rehab programmes. No page and no post shows one programme, one',
    '      before/after or one patient story.", soWhat "This means a patient cannot judge the programme before booking,',
    '      so the first session has to do all the explaining."',
    '    • GOOD: tension "You sell a pricing method to restaurants. You name no restaurant client, and your posts are',
    '      about your travels.", soWhat "This means a restaurant owner never sees the method applied to a menu like',
    '      theirs, so every sale starts from zero."',
    '- contradictions[].kind classifies each one by its dimension: "capability_gap" (you sell or promise something, an',
    '  output, a method, a result, and your own sources never show it, in any channel), "customer_proof", "channel_mismatch",',
    '  "commercial_path", "audience_mismatch", "priority_vs_effort", "story_vs_reality", or "other". At most ONE item per',
    '  kind (except "other").',
    '- contradictions[0] and aha.findings[0] are the SAME primary insight (the tension form and the finding form of it).',
    '- capabilityCheck = your answer to the CAPABILITY CHECK, always filled: "sells" = what the business sells, in',
    '  one phrase; "shown" = true only if its own sources (site AND posts) actually show it (an example, a case, a',
    '  sample of the output, a result); "insight" = when shown is false, the gap across all sources in the tension form,',
    '  e.g. "You sell X. Nothing on your site or in your posts shows X: no example, no output, no result." (empty when',
    '  shown is true); "soWhat" = the consequence (same rules as contradictions[].soWhat); sourceRefs as usual.',
    '- NO DUPLICATES: before you answer, compare every pair of contradictions (and every pair of aha.findings). Two',
    '  items on the same dimension, or making the same point in other words (e.g. "you never show X" once for the site',
    '  and once for the posts), are ONE item: keep the more general one. Different dimensions are different items even',
    '  when both are about something missing: "you never show your output" (capability), "no customer result is shown"',
    '  (customer proof) and "your most active channel never mentions the offer" (channel) are three items.',
    '- RANK, do not list: contradictions[0] is the single biggest, the one that most changes how the founder sees their',
    '  own business and that they are least likely to have noticed. Then two or three more, in descending severity.',
    '',
    'CONSTRAINT — DECIDE, DO NOT LIST. This is the most important field. After the contradictions, name the ONE',
    'constraint: the single thing that, if it changed, would change the most for this business. The contradictions',
    'are its SYMPTOMS. The constraint is the CAUSE behind them, not one of them restated and not a summary of all of',
    'them. Ask: which one thing, if solved, would make most of the contradictions go away or stop mattering?',
    '- constraint.statement = ONE sentence, second person, plain words, at most 30 words. No hedging ("may", "seems").',
    '- constraint.why = ONE sentence: which of the contradictions follow from it, and how.',
    '- Example (a bakery): contradictions "wholesale has no page", "every post is about the café", "the price list is',
    '  retail only" → constraint "You have not decided whether you are a café or a wholesale supplier, so your sources',
    '  serve the café and the wholesale side runs on nothing." Not "your wholesale offer is invisible" (that is a symptom).',
    '- The constraint must be a cause the tensions REVEAL, not a restatement of any one of them. Test it against every',
    '  contradiction: if your constraint says the same thing as one of them in other words (e.g. the tension is "you',
    '  never show X" and your constraint is "you have not shown X"), you have named a symptom. Dig one level deeper and',
    '  ask WHY the tensions exist. ROOT-CAUSE ORDER: check these IN THIS ORDER and name the FIRST one the sources support:',
    ...ROOT_CAUSE_ORDER,
    '  Use only what the sources show or clearly lack; when the deeper cause is an inference, say what it rests on in why.',
    '- The constraint is NEVER about what your sources show, display, demonstrate or make visible: that is what the',
    '  contradictions already say. It is about the BUSINESS itself: who it is for, whether anyone has bought or used it,',
    '  whether the offer is finished, which of several directions you have chosen, where your time goes. A constraint',
    '  that starts "You have not shown / demonstrated / made visible…" is a symptom: replace it with the reason why.',
    '  The constraint is the FACT, not its visibility. BAD: "You have not yet shown that a client can complete the',
    '  programme." GOOD: "No client has completed the programme and got a result." Same fact, different framing. Never',
    '  "not shown", "not yet shown", "you haven\'t shown", "not visible", "not demonstrated" in a constraint.',
    '- decided = false ONLY when the sources are too thin to see any cause, or two different causes are equally',
    '  supported; then statement and why are empty. Being careful is not a reason to be undecided: a strategist commits.',
    '- Same claim-type limits as everything else (no trust/credibility/conversion/revenue claims).',
    '',
    'STAGE — where the business is, from EVIDENCE in the sources only:',
    '- "validating" = still proving that people want it and will pay: no named paying customer, no repeat buying shown,',
    '  a free period, trial or pilot, the offer still being shaped, few or no results shown.',
    '- "growth" = it demonstrably works and is expanding: named customers or visible volume, several locations, teams or',
    '  offers added over time, hiring, a channel that visibly brings people in.',
    '- "plateau" = established for years with the same offer and audience and nothing new: long-running, stable offer,',
    '  old or repeated content, no new channel or offer in a long time.',
    '- stage.stage is the stage of the CORE: the offer with the MOST EVIDENCE OF SALES in the sources (named clients,',
    '  placements, members, volume, prices actually charged, staff serving it), not the offer listed first, described',
    '  most, or most expensive. When several offers compete, pick by that evidence and name it the same way every time.',
    '  Judge the core ONLY on evidence about the core. Something new, on paper only, in a',
    '  brochure but not on the site, or not yet sold NEVER changes the core stage; it goes in stage.secondary.',
    '- stage.secondary = {"stage": "...", "area": "<the named part, e.g. the corporate offer>", "evidence": [1-2',
    '  observations]} when ONE named part of the business is clearly at a different stage than the core (typically a new',
    '  channel or offer still being validated next to a core that is growing); otherwise null. At most one. Never the same',
    '  stage as the core. Before you answer, check each contradiction: does it describe a part of the business that is',
    '  newer or less proven than the core? If yes, fill stage.secondary.',
    '  If a contradiction says a channel or offer exists only on paper, only in a brochure, or with no page and no way to',
    '  buy, that part is NOT evidence for the core: it is stage.secondary = "validating" with that area named.',
    '- stage.evidence = 2 to 4 concrete observations about the CORE from the sources (what is there, or what is clearly',
    '  absent), each one short phrase, with sourceRefs. Never infer the stage from how polished the website looks.',
    '- If the evidence does not support one core stage, stage = "undetermined" and evidence = what is missing to tell.',
    '',
    'DIAGNOSTIC PRIORITY (this is what makes you a strategist, not a summarizer):',
    '- Do NOT just describe what each page says. Read ACROSS the sources for what STANDS OUT and what does NOT fit.',
    '- Prominence/detail asymmetry IS a tension: if one offering or page is described in far more depth or given',
    '  far more space than the others, surface it as a contradiction (statementA = "the site presents X, Y, Z as',
    '  equal", statementB = "but X is far more developed / the others are thin") — a real structural signal about',
    '  what the business may actually center on (kind "priority_vs_effort").',
    '- unknowns hold the sharpest questions ONLY the founder can answer — their real priority, their goal, what',
    '  customers actually value — each a direct question. Anything visible in the sources is a contradiction instead.',
    '- Prefer 3–4 real tensions + sharp unknowns over a tidy, complete-looking description. If the sources',
    '  genuinely have no tension, leave contradictions empty honestly — never invent one to look clever.',
    '',
    'SPECIFICITY — this is the difference between a WOW and a shrug. A contradiction anyone could see by glancing at',
    'the site is worthless; a contradiction the founder did NOT see about their OWN business is the whole product.',
    'Every contradiction MUST name the CONCRETE particulars from the sources — the actual service names, the actual',
    'numbers, the actual page titles — never a category. statementA and statementB each cite the specific thing:',
    '  • WEAK (banned): "There are active services with pricing pages that do not appear in navigation."',
    '  • STRONG (required): statementA="karate, dans, Ballet Lab and Atelier Automasaj each have their own pricing',
    '    page", statementB="none of the four appears in the site menu", tension="You run 4 live services with their own',
    '    pricing pages. None of the four is in your menu."',
    '  • WEAK (banned): "Two B2B channels exist but are not visible on the site."',
    '  • STRONG (required): statementA="the founder-supplied brochure builds a full medical-referral channel — 10',
    '    specialties, referral protocols, a therapeutic team", statementB="the website speaks entirely as a fitness',
    '    studio, with no referral page and no clinical language", tension="You have built a full medical-referral',
    '    channel on paper. Your website speaks only as a fitness studio and never to a doctor."',
    'The `tension` field is the observation in the TENSION FORM above (SPECIFIC, second person); its consequence goes in',
    'soWhat. If you cannot name the specific services/pages/numbers, the tension is too general — sharpen it or',
    'drop it. NEVER a contradiction phrased in categories ("some services", "a channel", "content") — always the names.',
    'PLAIN WORDS, not consultant-academic: name the real thing and use plain verbs — no stacked-noun abstraction',
    '("mesaj diferențiat pe segmente distincte"), no filler ("activează", "servește brandul"). A tired founder should',
    'understand the line instantly. (This is the READING step, so it stays observational — describe what the sources',
    'show; do NOT switch into "you should" advice, that is the strategy\'s job.)',
  ].join('\n');
}

/** The founder-facing prompt + the ONE shared voice block (spoken-voice.ts), same on every surface. */
export function systemPrompt(lang: string): string {
  return `${systemPromptBase(lang)}\n\n${VOICE_RULES}`;
}

export { visibilityPhrased };

const LEVELS = ['users', 'target', 'offer'] as const;
/**
 * Why a decided constraint's level is inconsistent with the model's own notes, or null (Strategic Depth W1, operator
 * 2026-10-12): the level must be the FIRST level its levelCheck marks as not passed ("time" when all pass), and a
 * business at the growth or plateau stage has users, so it can't stop at the users level.
 */
export function levelProblem(u: GovernedUnderstanding | null | undefined): string | null {
  const c = u?.constraint;
  if (!c?.decided) return null;
  const level = c.level;
  if (!level || !['users', 'target', 'offer', 'time'].includes(level)) return 'It does not say which root-cause level it stopped at.';
  const check = c.levelCheck ?? {};
  const firstFailing = LEVELS.find((l) => check[l] && check[l]!.passed === false) ?? (LEVELS.every((l) => check[l]?.passed === true) ? 'time' : null);
  if (firstFailing && firstFailing !== level) return `Its own level check says the first level that is not passed is "${firstFailing}", but it stopped at "${level}".`;
  const stage = u?.stage?.stage;
  if (level === 'users' && (stage === 'growth' || stage === 'plateau')) return `It stopped at "users", but the stage is ${stage}: a business at that stage has users, so the users level is passed.`;
  return null;
}

/** The tension a decided constraint restates (word overlap ≥ 0.45, the "same insight" bar), or null. */
export function restatedTension(u: GovernedUnderstanding | null | undefined): string | null {
  const c = u?.constraint;
  const statement = (c?.statement ?? '').trim();
  if (!c?.decided || !statement) return null;
  const tensions = [
    ...(u?.contradictions ?? []).map((x) => (x.tension ?? '').trim()),
    u?.capabilityCheck?.shown === false ? (u.capabilityCheck.insight ?? '').trim() : '',
  ].filter(Boolean);
  return tensions.find((t) => sameInsight(statement, t)) ?? null;
}

export function deeperConstraintPrompt(lang: string): string {
  const langName = LANG_NAME[lang] ?? 'English';
  return [
    'You are the analyst inside Business Brain. You already read a business and wrote its tensions and ONE constraint.',
    'The constraint you wrote restates one of the tensions or describes what is visible instead of the fact behind it,',
    'so it names a symptom, not the cause.',
    'Dig one level deeper: ask WHY the tensions exist. ROOT-CAUSE ORDER: check these IN THIS ORDER and name the FIRST',
    'one your reading supports (the same order the first reading used):',
    ...ROOT_CAUSE_ORDER,
    'It must not say the same thing as any tension, in any wording.',
    'The constraint is the FACT, not its visibility. BAD: "You have not yet shown that a client can complete the',
    'programme." GOOD: "No client has completed the programme and got a result." Never "not shown", "not yet shown",',
    '"you haven\'t shown", "not visible", "not demonstrated".',
    'Rules: ONE sentence, second person, present tense, plain words, at most 30 words, no hedging. Never about what the',
    'sources show, display, demonstrate or make visible. No trust, credibility, conversion, revenue, loyalty, competitor',
    `or recommendation claims. Write statement and why in ${langName}. "why" = one sentence linking it to the tensions.`,
    'If nothing deeper is supported, return decided false with empty statement and why.',
    'Return ONLY JSON: {"decided": true, "level": "users|target|offer|time", "levelCheck": {"users": {"passed": true, "evidence": ""}, "target": {"passed": true, "evidence": ""}, "offer": {"passed": true, "evidence": ""}}, "statement": "", "why": "", "sourceRefs": []}',
  ].join('\n');
}

/**
 * One retry when the constraint restates a tension or is phrased as visibility ("you have not shown …") — Strategic
 * Depth W1. The retry's answer is kept whenever it is decided (operator, 2026-10-12): when the root cause is at the
 * users level its customer-proof symptom always shares words with it, and the arc projection merges any tension it
 * still overlaps off the card. Undecided or a failed call keeps the first. Never fails the synthesis.
 */
export async function refineConstraint(
  out: SynthesisOutput,
  lang: string,
  call: (system: string, user: string) => Promise<string>,
): Promise<SynthesisOutput> {
  const u = out?.understanding;
  const restated = restatedTension(u);
  const visibility = u?.constraint?.decided && visibilityPhrased(u.constraint.statement ?? '');
  const level = levelProblem(u);
  if (!u || (!restated && !visibility && !level)) return out;
  try {
    const reading = {
      offer: u.offer?.summary, positioning: u.positioning?.summary, audience: u.audience?.addressed,
      tensions: (u.contradictions ?? []).map((c) => ({ tension: c.tension, soWhat: c.soWhat, sourceRefs: c.sourceRefs })),
      capabilityCheck: u.capabilityCheck, stage: u.stage,
      yourConstraint: u.constraint,
      problem: level ?? (restated ? `It restates this tension: ${restated}` : 'It describes what is visible (shown / demonstrated), not the fact behind it.'),
    };
    const next = extractJson(await call(deeperConstraintPrompt(lang), JSON.stringify(reading, null, 2))) as GovernedUnderstanding['constraint'];
    if (!next?.decided || !(next.statement ?? '').trim()) return out;
    const constraint = { decided: true, statement: next.statement.trim(), why: (next.why ?? '').trim(), sourceRefs: next.sourceRefs ?? [],
      ...(next.level ? { level: next.level } : {}), ...(next.levelCheck ? { levelCheck: next.levelCheck } : {}), retried: true };
    // A retry asked to fix the level must come back with a consistent one; otherwise the first answer stays.
    if (level && levelProblem({ ...u, constraint })) return out;
    return { ...out, understanding: { ...u, constraint } };
  } catch {
    return out;
  }
}

export class AnthropicUnderstandingModel implements IUnderstandingModelPort {
  private readonly modelId: string;
  constructor(
    private readonly apiKey: string,
    modelId?: string,
  ) {
    this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6';
  }

  async synthesize(input: UnderstandingModelInput): Promise<SynthesisOutput> {
    const client = createAnthropicClient(this.apiKey);
    const user = [
      `BUSINESS NAME: ${input.businessName}`,
      '',
      'SOURCES:',
      buildSourcesBlock(input.observations),
    ].join('\n');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp: any = await client.messages.create({
      model: this.modelId,
      // Enough headroom for a full governed-understanding JSON over MANY sources (a founder can pour in a whole
      // site + several brochures) — 4096 truncated it mid-array → malformed JSON.
      max_tokens: 8192,
      temperature: 0, // deterministic → one language PER HALF (composed = founder, lifted = source); no drift within a field
      system: systemPrompt(input.interfaceLanguage),
      messages: [{ role: 'user', content: user }],
    });

    const block = Array.isArray(resp?.content)
      ? resp.content.find((c: { type?: string }) => c?.type === 'text')
      : null;
    const raw: string = (block as { text?: string } | null)?.text ?? '';
    const parsed = extractJson(raw) as SynthesisOutput;
    const refined = await refineConstraint(parsed, input.interfaceLanguage, async (system, user) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r: any = await client.messages.create({ model: this.modelId, max_tokens: 1024, temperature: 0, system, messages: [{ role: 'user', content: user }] });
      return (Array.isArray(r?.content) ? r.content.find((c: { type?: string }) => c?.type === 'text')?.text : '') ?? '';
    });
    return { ...refined, modelId: this.modelId };
  }
}

/**
 * The model lifts source lines with typographic quotes (Romanian „…”, English “…”) and sometimes closes them with a
 * straight ASCII quote, which ends the JSON string early: `"Promiți „abordare personalizată", „programe…"`. Guided by
 * the parser: at each parse error, the last straight quote before the error position is the culprit when the string
 * it closed still has an unclosed „ or “; it becomes ”, and the parse is retried. Anything else fails closed.
 */
/** Where JSON.parse failed: its "position N", or (newer V8 for an unexpected token) located from the quoted context. */
function errorPosition(message: string, s: string): number {
  const at = /position (\d+)/.exec(message);
  if (at) return Number(at[1]);
  const ctx = /Unexpected token '(.)', (?:\.\.\.)?"(.*?)"(?:\.\.\.)? is not valid JSON/s.exec(message);
  if (!ctx) return NaN;
  const [, token, snippet] = ctx;
  const where = s.indexOf(snippet!);
  return where === -1 ? NaN : where + snippet!.indexOf(token!);
}

export function parseWithQuoteRepair(json: string, maxRepairs = 40): unknown {
  let s = json;
  for (let i = 0; ; i++) {
    try {
      return JSON.parse(s);
    } catch (e) {
      const pos = errorPosition((e as Error).message, s);
      if (i >= maxRepairs || !Number.isFinite(pos)) throw e;
      const q = s.lastIndexOf('"', pos - 1);
      let open = q - 1; // the opening quote of the string that q closed (skip escaped quotes)
      while (open >= 0 && !(s[open] === '"' && s[open - 1] !== '\\')) open--;
      const body = q > 0 && open >= 0 ? s.slice(open + 1, q) : '';
      const lastOpener = Math.max(body.lastIndexOf('„'), body.lastIndexOf('“'));
      if (lastOpener !== -1 && body.indexOf('”', lastOpener) === -1) {
        s = `${s.slice(0, q)}”${s.slice(q + 1)}`; // a straight quote closed a „…: re-close it typographically
        continue;
      }
      // A value that OPENS with a typographic quote instead of a JSON one: `[…, „ehrliche Beratung"]` → add the `"`.
      if ((s[pos] === '„' || s[pos] === '“') && /[[,:]\s*$/.test(s.slice(Math.max(0, pos - 20), pos))) {
        s = `${s.slice(0, pos)}"${s.slice(pos)}`;
        continue;
      }
      throw e;
    }
  }
}

/** Robust JSON extraction: take the outermost {...} and parse. Throws (fail closed) if absent/invalid. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('SYNTHESIS_MALFORMED: no JSON object in model output');
  }
  return parseWithQuoteRepair(text.slice(start, end + 1));
}
