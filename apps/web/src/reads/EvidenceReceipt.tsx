import type { Receipt } from './types';
import { receiptQuote, receiptMeta } from './styles';

/**
 * A single receipt — Article VII made visible. PURE EVIDENCE: the verbatim stored source text plus source
 * metadata, and NOTHING ELSE. It never renders "what this means", analysis, a summary, a recommendation, or
 * any interpretation. The text is shown exactly as stored (verbatim), visually distinct from product prose.
 * Source type / label / date are shown ONLY where the snapshot stored them.
 */
function sourceLine(r: Receipt): string {
  // Factual source metadata only — a label if stored, else the source type; plus a date if known.
  const who = r.sourceLabel && r.sourceLabel.trim() ? r.sourceLabel : r.sourceType;
  const whenIso = r.occurredAt ?? r.capturedAt;
  const when = whenIso ? new Date(whenIso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  return when ? `${who} · ${when}` : who;
}

export function EvidenceReceipt({ receipt }: { receipt: Receipt }) {
  return (
    <figure style={{ margin: 0 }}>
      <blockquote style={receiptQuote}>&ldquo;{receipt.text}&rdquo;</blockquote>
      <figcaption style={receiptMeta}>{sourceLine(receipt)}</figcaption>
    </figure>
  );
}
