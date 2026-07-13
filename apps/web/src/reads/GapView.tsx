import type { ReadClaim } from './types';
import { claimText } from './styles';
import { ReceiptDisclosure } from './ReceiptDisclosure';
import { EvidenceReceipt } from './EvidenceReceipt';

/**
 * A Gap (S3) — where the founder's story and their evidence diverge. The engine's Gap statement is shown
 * VERBATIM, with the verdict withheld: this surface never says which side is right. The two sides expand
 * SEPARATELY and are NEVER merged into one list — "The story you've told" (declared receipts) and "The
 * evidence" (observed receipts). It never renders the internal category, stakes, rank, severity, urgency,
 * or any action control (Respond / Name a Bet / Hold Open have no backend in scope — no dead controls).
 */
export function GapView({ claim }: { claim: ReadClaim }) {
  const declared = claim.declaredReceipts ?? [];
  const observed = claim.observedReceipts ?? [];
  return (
    <div style={{ margin: '0 0 28px' }}>
      <p style={claimText}>{claim.statement}</p>
      {declared.length > 0 && (
        <ReceiptDisclosure label="The story you&rsquo;ve told">
          {declared.map((r) => <EvidenceReceipt key={r.fragmentId} receipt={r} />)}
        </ReceiptDisclosure>
      )}
      {observed.length > 0 && (
        <ReceiptDisclosure label="The evidence">
          {observed.map((r) => <EvidenceReceipt key={r.fragmentId} receipt={r} />)}
        </ReceiptDisclosure>
      )}
    </div>
  );
}
