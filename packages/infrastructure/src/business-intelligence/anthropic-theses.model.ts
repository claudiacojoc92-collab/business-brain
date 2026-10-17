import { createAnthropicClient } from '../llm/anthropic-client';
import { DECISION_AREAS, VOICE_RULES } from '@bb/application';
import type { DecisionArea, IThesisModelPort, ThesisInput, ThesisModelOutput } from '@bb/application';

/**
 * STRATEGIC THESES adapter (2026-10-16): ONE call over an already governed understanding. It sketches how the business
 * works (generic vocabulary), proposes candidate strategic theses and writes the founder-facing copy. It never adds a
 * fact; eligibility, ranking, question selection and every founder sentence are checked again in the application.
 * Generic for any founder-led business: no industry vocabulary. Fails safe to null.
 */
const LANG: Record<string, string> = { ro: 'Romanian', en: 'English', it: 'Italian', de: 'German' };

const SHAPE = `{
  "businessModel": {
    "motions": [{ "name": "short name", "entry": ["referral|organic_inbound|paid|outbound|partner|marketplace|walk_in|founder_led|self_serve|sales_assisted"], "buying": ["direct_purchase|booking|consultation|assessment|demo|quote|trial|sales_call|application|checkout|contract"], "continuation": ["repeat_purchase|subscription|package|ongoing_service|usage|maintenance|follow_up|referral|none_observed"], "refs": ["F1"] }],
    "offerRoles": [{ "offer": "name as the business uses it", "role": "entry|core|recurring|expansion|complementary|one_off|lifecycle", "refs": ["F2"] }],
    "decisionPoints": [{ "from": "a step", "to": "the next commitment", "refs": ["F3"] }]
  },
  "myRead": [{ "text": "one short sentence", "kind": "fact|interpretation", "refs": ["F1", "F4"] }],
  "theses": [{
    "headline": "internal label, at most 12 words",
    "facts": ["F2", "F5"],
    "relationship": "what connects these facts (your interpretation)",
    "implication": "why that relationship may matter for the business",
    "decisions": ["acquisition|conversion|retention|expansion|positioning|offer_design|channel|operating_model|resource_allocation|customer_journey|pricing"],
    "ifTrue": "the DECISION AT STAKE if this is true (which choice it would change), not the solution",
    "weakenedBy": "the founder answer or outcome that would weaken or reverse it",
    "unknown": "what you must learn before relying on it",
    "question": "ONE question to the founder that separates this reading from its alternative",
    "questionWhy": "one short sentence: what decision becomes clearer with the answer",
    "dimensions": ["offer|customer|acquisition|conversion|retention|capacity|economics|performance|intent"],
    "priority": 1,
    "founder": { "headline": "a short STATEMENT (not a question), at most 8 words", "body": "at most 3 short sentences: the structure you see, what it could mean, what founder evidence would show whether it is real", "refs": ["F2", "F5"] }
  }],
  "driverQuestion": { "text": "ONE founder-answerable question about what currently drives the business commercially (which offer, customer group or channel brings most customers and revenue today)", "why": "one short sentence" }
}`;

export function thesisRules(l: string): string {
  return [
    'You are Business Brain, a top strategist. Everything below has ALREADY been read, checked and governed: facts (F-refs),',
    'the structural synthesis (S), readings (H), what is still unknown. Your job: model HOW this business works and propose the',
    'strategic theses worth testing. You may create new INTERPRETATION; you may NEVER create a new FACT.',
    `LANGUAGE: write every founder-facing text ("myRead", "founder", "question", "questionWhy", "headline") in ${l}.`,
    'Return ONLY valid JSON in exactly this shape (no prose around it):',
    SHAPE,
    '',
    'BUSINESS MODEL: how value enters and flows. A motion is a meaningfully different way the business is entered, bought,',
    'continued or paid for (not just a different offer name). Use the generic categories only when a fact supports them;',
    '"none_observed" is a legitimate answer. Every item cites its F-refs.',
    '',
    'THESES: propose the strategic relationships the evidence actually supports, typically 4 to 8, fewer when the business',
    'does not support more. Never invent a weak one to fill a quota. A thesis is NOT an observation ("there are two X") and',
    'NOT a taxonomy ("they sell A and B"). It connects at least two facts into a relationship, says why it may matter, which',
    'founder decision changes if it is true, and what answer would weaken it. Look across offer structure, who buys and why,',
    'how customers enter, how they decide, what happens after the first purchase, how the relationship can grow, the journey,',
    'the decision points, capacity and delivery, economics (only if grounded), the founder\'s intent. Include relationships',
    'between offers over a customer\'s changing needs (continuity from one need to the next, cross-use, lifecycle',
    'transitions, one offer leading to another) when the offer structure makes them possible: model them as POSSIBLE until',
    'founder evidence confirms the behaviour. Set "priority" (1 = the thesis whose answer would most change what the founder',
    'should do).',
    '',
    'STAY ABOVE THE SOLUTION: a thesis describes a business relationship, its consequence, and the decision it may change.',
    'It asks WHETHER the relationship exists before any HOW. Never put a solution in a thesis (a redesign, a new package, a',
    'campaign, a channel to add) unless the evidence already makes it obvious. "ifTrue" names the decision at stake, not',
    'what to build.',
    '',
    'DRIVER QUESTION: also write "driverQuestion", one question about what currently drives the business commercially.',
    'Never presuppose the answer or invent performance.',
    '',
    'QUESTIONS: each thesis has ONE founder-answerable, specific, non-leading question that separates it from its',
    'alternative. Never presuppose the diagnosis or a future the founder has not stated; no bundles of unrelated questions.',
    '',
    'MY READ: 2 to 3 short sentences on HOW the business works (its motions, how customers enter and continue, a meaningful',
    'relationship between offers). Not a service catalogue, not an audience list, not praise, not website copy, no reasoning',
    'mechanics. Mark each sentence "fact" or "interpretation". A FACT is declarative and only what the refs state, with no',
    'primacy word ("main", "principal", "most") unless a ref says it: "the most visible continuation mechanism in the offer",',
    'not "the main continuation mechanism". An INTERPRETATION must read as YOUR reading ("this suggests…", "my reading is…"),',
    'never as a hidden fact.',
    '',
    'GROUNDING: every factual statement must be traceable to the material, at exactly its strength. Never infer margin,',
    'profitability, scalability, demand, utilisation, growth, stagnation, customer preference, channel effectiveness,',
    'retention or conversion rates, importance or dominance unless a fact states it. No numbers that are not in the',
    'material. Never mention refs, labels or the words "thesis" or "hypothesis" in founder-facing text.',
    '',
    'WHAT MATTERS (each thesis\'s "founder"): about HOW the business works and what it means for the founder\'s decisions,',
    'never website or communication advice ("the site should show X"). Shape: the structural relationship you see → why it',
    'matters to you → which founder answer would distinguish the readings. For an open thesis NEVER describe what each',
    'branch would cause ("if mandatory, it qualifies clients" invents an effect): name the fork and why it changes the',
    'decision. A structural POSSIBILITY is never a behaviour FACT: "packages exist" is not "packages retain clients";',
    '"colors can be matched" is not "buyers return to match". No judgements of quality ("that is real signal"). Never tell',
    'the founder what they lose or must do.',
    '',
    'STRENGTH: the certainty and magnitude of an interpretation never exceed its evidence (no "completely", "fundamentally",',
    '"high-intent" unless the facts say so).',
    'TONE for founder-facing text: a top strategist speaking to a smart founder. Concise, precise, warm professional',
    'confidence; decisive where the evidence allows, curious where it does not. SHORT sentences: at most 25 words each. No',
    'consultant-report or website-audit language, no compliments, no drama, no repeated "may/seems/perhaps".',
  ].join('\n');
}

export function thesisUserBlock(input: ThesisInput): string {
  return [
    `BUSINESS: ${input.businessName}`,
    '', 'F — GOVERNED FACTS:', ...input.facts.map((f) => `${f.ref}: ${f.text}`),
    '', `S — THE GOVERNED STRUCTURAL SYNTHESIS: ${input.synthesis}`,
    '', 'H — READINGS ALREADY HELD (reversible):',
    ...(input.hypotheses.length ? input.hypotheses.flatMap((h) => [`${h.ref}: ${h.interpretation}`,
      ...(h.alternative ? [`  what else could explain it: ${h.alternative}`] : []), ...(h.unknown ? [`  not known yet: ${h.unknown}`] : []),
      ...(h.reversal ? [`  what would change it: ${h.reversal}`] : [])]) : ['(none)']),
    '', 'STILL UNKNOWN (by dimension):', ...(input.unknowns.length ? input.unknowns.map((x) => `- ${x}`) : ['(none)']),
    '', 'CONCLUSIONS DELIBERATELY NOT DRAWN:', ...(input.notConcluding.length ? input.notConcluding.map((x) => `- ${x}`) : ['(none)']),
    '', 'Model the business and propose the strategic theses.',
  ].join('\n');
}

function extractJson(text: string): unknown {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) throw new Error('THESES_MALFORMED: no JSON');
  return JSON.parse(text.slice(s, e + 1));
}
const strs = (x: unknown): string[] => (Array.isArray(x) ? x.map((v) => String(v).trim()).filter(Boolean) : []);
const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');

export class AnthropicThesisModel implements IThesisModelPort {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) {
    this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6';
  }

  async compose(input: ThesisInput): Promise<ThesisModelOutput | null> {
    if (!this.apiKey) return null;
    try {
      const client = createAnthropicClient(this.apiKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp: any = await client.messages.create({
        model: this.modelId, max_tokens: 12000, temperature: 0,
        system: `${thesisRules(LANG[input.language] ?? 'English')}\n\n${VOICE_RULES}`,
        messages: [{ role: 'user', content: thesisUserBlock(input) }],
      });
      const block = Array.isArray(resp?.content) ? resp.content.find((c: { type?: string }) => c?.type === 'text') : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = extractJson((block as { text?: string } | null)?.text ?? '') as any;
      const bm = p?.businessModel ?? {};
      return {
        businessModel: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          motions: (Array.isArray(bm.motions) ? bm.motions : []).map((m: any) => ({ name: str(m?.name), entry: strs(m?.entry), buying: strs(m?.buying), continuation: strs(m?.continuation), refs: strs(m?.refs) })),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          offerRoles: (Array.isArray(bm.offerRoles) ? bm.offerRoles : []).map((o: any) => ({ offer: str(o?.offer), role: str(o?.role), refs: strs(o?.refs) })),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          decisionPoints: (Array.isArray(bm.decisionPoints) ? bm.decisionPoints : []).map((d: any) => ({ from: str(d?.from), to: str(d?.to), refs: strs(d?.refs) })),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        myRead: (Array.isArray(p?.myRead) ? p.myRead : []).map((x: any) => ({ text: str(x?.text), kind: x?.kind === 'fact' ? 'fact' as const : 'interpretation' as const, refs: strs(x?.refs) })).filter((x: { text: string }) => x.text),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        theses: (Array.isArray(p?.theses) ? p.theses : []).map((t: any, i: number) => ({
          id: `T${i + 1}`, headline: str(t?.headline), facts: strs(t?.facts), relationship: str(t?.relationship), implication: str(t?.implication),
          decisions: strs(t?.decisions).filter((d): d is DecisionArea => (DECISION_AREAS as readonly string[]).includes(d)),
          ifTrue: str(t?.ifTrue), weakenedBy: str(t?.weakenedBy), unknown: str(t?.unknown), question: str(t?.question), questionWhy: str(t?.questionWhy),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          dimensions: strs(t?.dimensions) as any, priority: Number(t?.priority) || i + 1,
          founder: { headline: str(t?.founder?.headline), body: str(t?.founder?.body), refs: strs(t?.founder?.refs) },
        })),
        ...(str(p?.driverQuestion?.text) ? { driverQuestion: { text: str(p.driverQuestion.text), why: str(p?.driverQuestion?.why) } } : {}),
      };
    } catch {
      return null;
    }
  }
}
