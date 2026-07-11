/**
 * Receipt resolution (S1-T2, Article VII) — every founder-visible grounded claim resolves to REAL stored
 * evidence. A Receipt is PURE EVIDENCE: the verbatim source text + source metadata ONLY — never
 * interpretation, paraphrase, summary, or confidence language. The rule is absolute: NO real receipt → NO
 * grounded claim (the caller drops any claim whose required receipts don't resolve).
 *
 * Read-time resolution reuses the existing byId Map pattern (toRecommendationView / the assembler already
 * build it from findByFounder) — no engine, no LLM, no new resolution path, no extra DB load. Founder
 * isolation is structural: byId only ever holds the session founder's fragments, so another founder's id
 * simply isn't present and resolves to nothing.
 */
import type { EvidenceFragment } from '@bb/domain';

export interface Receipt {
  fragmentId: string;                     // internal id — for inspection/audit
  epistemicKind: 'observed' | 'declared'; // NEVER 'inferred' — receipts are pure evidence
  sourceType: string;                     // = fragment.source (website | upload | google | google-calendar | founder | …)
  text: string;                           // FULL VERBATIM payload.text — no slice, no paraphrase
  sourceLabel?: string;                   // human, source-derived identifier — no interpretation
  sourceUrl?: string;                     // a real URL only where safe/useful; opaque scheme locators omitted; never a secret
  occurredAt?: string;                    // ISO — when the evidence occurred, if known
  capturedAt: string;                     // ISO — when it was captured
}

const iso = (d: Date | null | undefined): string | undefined => (d == null ? undefined : new Date(d).toISOString());

// Human identifier derived from stored metadata — NO interpretation: a document filename, a declared
// answer's label, or a website host. Absent when nothing meaningful is stored.
function deriveSourceLabel(f: EvidenceFragment): string | undefined {
  const doc = f.payload?.['sourceDocument'] as { filename?: string } | undefined;
  if (doc && typeof doc.filename === 'string' && doc.filename) return doc.filename; // upload / google — the document
  const label = f.payload?.['label'] ?? f.payload?.['field'];                       // declared — the answer's field/label
  if (typeof label === 'string' && label) return label;
  if (f.source === 'website' && f.sourceUrl) { try { return new URL(f.sourceUrl).host; } catch { return undefined; } }
  return undefined;
}

// Expose a real address ONLY for the website source (the founder's own public URL). Opaque scheme locators
// (upload:// google:// calendar:// conversation://) are internal plumbing — omitted. Tokens/secrets live in
// app.oauth_credentials, never in a fragment payload/sourceUrl, so no receipt can leak one.
function safeUrl(f: EvidenceFragment): string | undefined {
  if (f.source === 'website' && f.sourceUrl && /^https?:\/\//i.test(f.sourceUrl)) return f.sourceUrl;
  return undefined;
}

/**
 * Resolve provenance ids to receipts. FAIL CLOSED — drops any id that: (a) is not in byId (missing / wrong
 * founder / removed after assembly), (b) is not the required epistemic kind, or (c) has empty verbatim text.
 * Inferred fragments are NEVER receipts (defense in depth). Dedupes (a repeated id resolves once). Output
 * follows PROVENANCE order (the input id order) — deterministic, not importance-ranked.
 */
export function resolveReceipts(
  ids: readonly string[] | null | undefined,
  byId: Map<string, EvidenceFragment>,
  requireKind?: 'observed' | 'declared',
): Receipt[] {
  const out: Receipt[] = [];
  const seen = new Set<string>();
  for (const id of ids ?? []) {
    if (seen.has(id)) continue; // dedupe
    seen.add(id);
    const f = byId.get(id);
    if (!f) continue;                                              // (a) not in the founder's fragment map → drop
    if (requireKind && f.confidenceKind !== requireKind) continue; // (b) wrong epistemic kind → drop
    if (f.confidenceKind === 'inferred') continue;                 // receipts are pure evidence, never inference
    const text = String(f.payload?.['text'] ?? '');
    if (!text) continue;                                           // (c) no verbatim text → no receipt (fail closed)
    out.push({
      fragmentId: f.id,
      epistemicKind: f.confidenceKind as 'observed' | 'declared',
      sourceType: f.source,
      text, // full verbatim payload.text
      sourceLabel: deriveSourceLabel(f),
      sourceUrl: safeUrl(f),
      occurredAt: iso(f.occurredAt),
      capturedAt: iso(f.capturedAt)!,
    });
  }
  return out;
}
