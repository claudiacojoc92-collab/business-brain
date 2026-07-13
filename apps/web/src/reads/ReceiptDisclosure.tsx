import { useId, useState, type ReactNode } from 'react';
import { discButton } from './styles';

/**
 * Expand-in-place disclosure for evidence. The claim above stays visible; the receipts appear directly
 * beneath, in place — NO modal, NO navigation. A real <button> with aria-expanded / aria-controls, so it
 * is keyboard operable and screen-reader correct. Reveal is instant (no theatrical animation), which also
 * respects prefers-reduced-motion by construction.
 *
 * `label` is always visible (so which evidence group this is — e.g. "The story you've told" vs "The
 * evidence" — stays clear even when collapsed); a quiet Show/Hide affordance toggles the region.
 */
export function ReceiptDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" aria-expanded={open} aria-controls={regionId} onClick={() => setOpen((o) => !o)} style={discButton}>
        <span aria-hidden="true">{open ? '–' : '+'}</span>
        <span>{label}</span>
      </button>
      {open && (
        <div id={regionId} role="region" aria-label={label} style={{ marginTop: 4 }}>
          {children}
        </div>
      )}
    </div>
  );
}
