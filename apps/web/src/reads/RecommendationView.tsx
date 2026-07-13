import type { RecommendationClaim } from './types';
import { claimText, meta } from './styles';
import { ReceiptDisclosure } from './ReceiptDisclosure';
import { EvidenceReceipt } from './EvidenceReceipt';

/**
 * A recommendation (S5) — "my read, not a fact". The statement is framed as an inference the founder can
 * weigh, never a directive. There is NO accept / apply / do-this control, NO completion state, NO
 * obedience mechanic. Its disclosure shows what it assumes, its qualitative confidence, and the real
 * evidence it rests on — all expandable in place.
 */
export function RecommendationView({ claim }: { claim: RecommendationClaim }) {
  const receipts = claim.receipts ?? [];
  const assumptions = claim.disclosure.assumptions ?? [];
  return (
    <div style={{ margin: '0 0 28px' }}>
      <p style={claimText}>{claim.statement}</p>
      <p style={{ ...meta, fontStyle: 'italic', margin: '0 0 4px' }}>My read, not a fact.</p>
      {receipts.length > 0 && (
        <ReceiptDisclosure label="What this rests on">
          {receipts.map((r) => <EvidenceReceipt key={r.fragmentId} receipt={r} />)}
        </ReceiptDisclosure>
      )}
      {assumptions.length > 0 && (
        <ReceiptDisclosure label="What I&rsquo;m assuming">
          {assumptions.map((a, i) => <p key={i} style={{ ...meta, color: 'var(--ink-2)', margin: '4px 0 0' }}>{a}</p>)}
        </ReceiptDisclosure>
      )}
      <p style={{ ...meta, marginTop: 8 }}>Confidence: {claim.disclosure.confidence}</p>
    </div>
  );
}
