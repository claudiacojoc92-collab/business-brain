import { createAnthropicClient } from '../llm/anthropic-client';
import { ATOM_CLASSES, type AtomClass, type AtomCandidate, type AtomExtractionInput, type AtomModelOutput, type IAtomExtractionModel } from '@bb/application';

/**
 * Atom proposer (licensed-atoms). PROPOSES a business's operational atoms from its own page text; it decides
 * nothing — MoveDraft/carousel safety never see its output directly. AtomExtractionService re-verifies every
 * proposal by VERBATIM ANCHORING and drops whatever is not a literal span, so the prompt's job is recall, not
 * trust. Language-neutral: no language is passed and none is assumed. Fails SAFE to {atoms: []} (never invents).
 *
 * The one judgement the prompt carries that anchoring cannot: a `people` atom must be a NAMED individual with a
 * role, never a group/collective phrase ("echipa noastră de specialiști") — a group noun is a verbatim span but
 * not a person. This model-level rule is verified end-to-end in the acceptance test (intent commit 8).
 */
const RULES = [
  'You extract a business\'s VERIFIABLE OPERATIONAL ATOMS from ITS OWN page text, to be licensed as facts the business may state about itself.',
  'OUTPUT — your ENTIRE response is ONE JSON object and nothing else (first char "{"): {"atoms":[{"atomClass":"…","value":"…","sourceRef":"…"}]}',
  'Exactly five atom classes, nothing else:',
  '  - "service": an exact service / offering NAME as written (e.g. a class, a therapy, a session type).',
  '  - "location": a physical address — street + number (+ area/city), one atom per location.',
  '  - "contact_booking": a phone number, an email address, a booking tool/app name, a booking URL, or the one-line booking instruction.',
  '  - "people": a NAMED individual together with their stated role/qualification (name + title as written). NEVER a group or collective phrase ("our team", "specialists", "echipa noastră") — a group noun is not a person.',
  '  - "policy": a RULE of how the service works — group size / capacity, cancellation / rescheduling window, arrival or lead time, booking requirement, membership term (e.g. "(max. 4 persoane)", "anulările se realizează cu minimum 8 ore înainte de ora programată"). NOT a price.',
  'VERBATIM: every "value" MUST be copied character-for-character from the cited unit\'s text — do NOT paraphrase, translate, fix spelling or diacritics, summarise, or join text across units. If you cannot copy it verbatim, OMIT it (it would be dropped anyway).',
  'Cite in "sourceRef" the unit label shown after "sourceRef:" in the header, copied EXACTLY and nothing else — no page type, no parenthetical, no URL.',
  'Extract only what is actually present. No prices, no opening hours. No invented or inferred facts. If a unit has no atoms, return none for it.',
].join('\n');

function units(i: AtomExtractionInput): string {
  // The sourceRef line carries the ref ALONE (no pageType parenthetical) so the model copies it unambiguously —
  // it previously echoed "Homepage (home)" and every atom was dropped on the mismatch.
  return i.units.map((u) => `=== sourceRef: ${u.sourceRef} ===\n${u.text}`).join('\n\n');
}

function extractJson(text: string): unknown {
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) throw new Error('ATOMS_MALFORMED');
  return JSON.parse(text.slice(s, e + 1));
}

function coerce(parsed: unknown): AtomModelOutput {
  const p = parsed as { atoms?: unknown };
  if (!Array.isArray(p.atoms)) return { atoms: [] };
  const atoms: AtomCandidate[] = [];
  for (const raw of p.atoms) {
    const r = raw as { atomClass?: unknown; value?: unknown; sourceRef?: unknown };
    const atomClass = String(r.atomClass ?? '') as AtomClass;
    if (!ATOM_CLASSES.includes(atomClass)) continue;           // closed scope (service re-checks too)
    const value = String(r.value ?? '').trim();
    const sourceRef = String(r.sourceRef ?? '').trim();
    if (!value || !sourceRef) continue;
    atoms.push({ atomClass, value, sourceRef });
  }
  return { atoms };
}

export class AnthropicAtomModel implements IAtomExtractionModel {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) {
    this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6';
  }

  async extract(input: AtomExtractionInput): Promise<AtomModelOutput> {
    if (!this.apiKey || input.units.length === 0) return { atoms: [] };
    try {
      const client = createAnthropicClient(this.apiKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp: any = await client.messages.create({
        model: this.modelId, max_tokens: 2000, temperature: 0, system: RULES,
        messages: [{ role: 'user', content: units(input) }],
      });
      const block = Array.isArray(resp?.content) ? resp.content.find((c: { type?: string }) => c?.type === 'text') : null;
      return coerce(extractJson((block as { text?: string } | null)?.text ?? ''));
    } catch { return { atoms: [] }; } // fail safe: propose nothing rather than risk a malformed/invented atom
  }
}
