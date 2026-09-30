import { useEffect, useState } from 'react';

export type T = (k: string, v?: Record<string, string>) => string;

/**
 * THE shared "BB is working…" spinner — animated dots + a content-language message that escalates to a
 * "still working…" line after ~12s, so a long generation (strategy / plan / next-cycle plan) reads as progress
 * everywhere in the product, never a frozen screen. Used by the arc AND by the verdict / cycle-close surfaces so a
 * 74–150s wait looks the same wherever it happens.
 */
export function ArcWorking({ t, messageKey }: { t: T; messageKey: string }) {
  const [longWait, setLongWait] = useState(false);
  useEffect(() => { const id = setTimeout(() => setLongWait(true), 12000); return () => clearTimeout(id); }, []);
  return (
    <div className="s0-arc-working" role="status" aria-live="polite">
      <span className="s0-arc-working-dots" aria-hidden="true"><i /><i /><i /></span>
      <span className="s0-arc-working-text">{longWait ? t('arc.working.still') : t(messageKey)}</span>
    </div>
  );
}
