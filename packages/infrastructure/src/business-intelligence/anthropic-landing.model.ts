import { createAnthropicClient } from '../llm/anthropic-client';
import { routeFacts, type ILandingModelPort, type LandingGenInput, type LandingRepairInput, type LandingDraft, type LandingSection, type LandingSectionRole } from '@bb/application';

/**
 * Landing prose generator (move-draft). Produces a STRUCTURED landing page grounded ONLY in licensed facts —
 * never the ungated Email-model pattern: its output is routed through the regulated-claim guard + proposition
 * kernel + judge by MoveDraftService. The prompt forbids the three regulated classes up front, but the prompt
 * is NOT the gate — the deterministic layers are. Fails SAFE to a thin, licensed-only draft (still gated).
 */
const LANG: Record<string, string> = { ro: 'Romanian', en: 'English', it: 'Italian' };
const ROLES: LandingSectionRole[] = ['hero_headline', 'hero_subhead', 'what', 'who', 'proof', 'how_it_works', 'cta'];

function rules(l: string): string {
  return [
    `You are Business Brain writing ONE business's landing-page copy, entirely in ${l}. Write everything in ${l}; never mix languages.`,
    'OUTPUT — your ENTIRE response is ONE JSON object and nothing else (first char "{"): {"sections":[{"role":"hero_headline","heading":"","body":"..."},{"role":"hero_subhead","body":"..."},{"role":"what","heading":"...","body":"..."},{"role":"who","heading":"...","body":"..."},{"role":"proof","heading":"...","body":"..."},{"role":"how_it_works","heading":"...","body":"..."}],"cta":"..."}',
    'FACTS ARE ROUTED TO SECTIONS. Use each group ONLY in its named section, and use ALL of the items in it:',
    '  • "what" names EVERY item under SERVICES, as written. Do NOT collapse them into a category or summary.',
    '  • "proof" NAMES EVERY person under PEOPLE, each with the role given. NEVER replace them with a generic phrase like "our team of specialists" — list the actual names.',
    '  • "how_it_works" states EVERY rule under POLICY as a short, concrete line (e.g. group size, cancellation window, arrival time). These are the practical rules a visitor needs — keep them plain and specific. OMIT this section only if POLICY is empty.',
    '  • "hero_headline" / "hero_subhead" / "who" use POSITIONING/AUDIENCE and LOCATIONS — the general framing, never a specific unlisted claim.',
    '  • the CTA uses CONTACT/BOOKING + the required next action.',
    'GROUND every statement in the routed facts + PROOF below. State NOTHING not entailed by them — no invented facts, numbers, testimonials, results, timeframes or offers.',
    'FORBIDDEN (never write these — this is a recovery/health business and the copy is public):',
    '  1. Promising a health OUTCOME — what will happen to the reader\'s body/health ("get you back to running", "you\'ll be pain-free").',
    '  2. Claiming a THERAPEUTIC EFFECT — that you treat/heal/cure/correct/reduce/prevent a condition.',
    '  3. Implying CLINICAL COMPETENCE beyond a stated credential — a specialty/scope not backed by a credential in the facts.',
    'DESCRIBE what you DO and WHO it is for; name a condition only as the context of a service ("for lower-back pain"), never as something you act on. Do not promise what WILL happen.',
    'Sound like THIS business — follow the VOICE examples for tone (how to say it), never to introduce a new claim.',
    'Keep each section tight — but "what" and "proof" are complete lists, not samples: every service, every person.',
  ].join('\n');
}

function facts(i: LandingGenInput): string {
  const r = routeFacts(i.snapshot.licensedPropositions);
  const list = (xs: string[], empty: string) => (xs.length ? xs.map((x, n) => `  ${n + 1}. ${x}`) : [`  ${empty}`]);
  return [
    `BUSINESS LANDING JOB: ${i.communicationJob}`,
    `REQUIRED NEXT ACTION (CTA): ${i.snapshot.ctaFunction || '(a clear next step)'}`,
    '', 'SERVICES → the "what" section (name every one):', ...list(r.services, '(none)'),
    '', 'PEOPLE → the "proof" section (NAME EVERY ONE with their role):', ...list(r.people, '(none)'),
    '', 'POLICY → the "how_it_works" section (state every rule as a short concrete line):', ...list(r.policy, '(none — omit how_it_works)'),
    '', 'CONTACT / BOOKING → the CTA:', ...list(r.contact, '(none — use the required next action)'),
    '', 'LOCATIONS → hero / subhead context:', ...list(r.locations, '(none)'),
    '', 'POSITIONING / AUDIENCE (synthesis) → hero, subhead, who (general framing only):', ...list([...r.general, ...(i.snapshot.audienceUseContext ? [`audience: ${i.snapshot.audienceUseContext}`] : [])], '(none)'),
    '', 'PROOF (documented, licensed — the only numbers/results you may cite):', ...list(i.snapshot.proofFacts, '(none — cite no results or numbers)'),
    '', 'VOICE (tone only, not new claims):', ...list(i.voiceLines, '(none captured — plain, warm, specific)'),
  ].join('\n');
}

function extractJson(text: string): unknown {
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) throw new Error('LANDING_MALFORMED');
  return JSON.parse(text.slice(s, e + 1));
}

function coerce(parsed: unknown): LandingDraft | null {
  const p = parsed as { sections?: unknown; cta?: unknown };
  if (!Array.isArray(p.sections)) return null;
  const sections: LandingSection[] = [];
  for (const raw of p.sections) {
    const r = raw as { role?: unknown; heading?: unknown; body?: unknown };
    const role = String(r.role ?? '') as LandingSectionRole;
    if (!ROLES.includes(role) || role === 'cta') continue;
    const body = String(r.body ?? '').trim();
    if (!body) continue;
    const heading = String(r.heading ?? '').trim();
    sections.push(heading ? { role, heading, body } : { role, body });
  }
  const cta = String(p.cta ?? '').trim();
  if (!sections.length || !cta) return null;
  return { sections, cta };
}

/** Fail-safe: a thin, LICENSED-ONLY draft (still goes through the full gate). Never a reason to skip the gate. */
function fallback(i: LandingGenInput): LandingDraft {
  const first = i.snapshot.licensedPropositions[0]?.text ?? i.communicationJob;
  return { sections: [{ role: 'hero_headline', body: first }], cta: i.snapshot.ctaFunction || 'Contact us.' };
}

export class AnthropicLandingModel implements ILandingModelPort {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) {
    this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6';
  }

  private async call(system: string, user: string, input: LandingGenInput): Promise<LandingDraft> {
    if (!this.apiKey) return fallback(input);
    try {
      const client = createAnthropicClient(this.apiKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp: any = await client.messages.create({ model: this.modelId, max_tokens: 1800, temperature: 0, system, messages: [{ role: 'user', content: user }] });
      const block = Array.isArray(resp?.content) ? resp.content.find((c: { type?: string }) => c?.type === 'text') : null;
      return coerce(extractJson((block as { text?: string } | null)?.text ?? '')) ?? fallback(input);
    } catch { return fallback(input); }
  }

  async draft(input: LandingGenInput): Promise<LandingDraft> {
    return this.call(rules(LANG[input.language] ?? 'English'), facts(input), input);
  }

  async repair(input: LandingRepairInput): Promise<LandingDraft> {
    const fails = input.failures.map((f, n) => `${n + 1}. section "${f.section}" — ${f.rule}`).join('\n');
    const prev = JSON.stringify({ sections: input.previous.sections, cta: input.previous.cta });
    const user = [
      facts(input),
      '', 'YOUR PREVIOUS DRAFT FAILED THE SAFETY GATE on these exact sections/rules — rewrite ONLY to remove each failure, keeping everything that passed:',
      fails,
      '', 'PREVIOUS DRAFT:', prev,
      '', 'Return the corrected full JSON object.',
    ].join('\n');
    return this.call(rules(LANG[input.language] ?? 'English'), user, input);
  }
}
