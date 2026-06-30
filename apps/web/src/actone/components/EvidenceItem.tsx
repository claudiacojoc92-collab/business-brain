import type { EvidenceData, EvidenceVisual } from '../types';
import styles from '../actone.module.css';

/** A single piece of public evidence. Light-native: bright = darken-to-ink, recede = fade-to-grey. */
export function EvidenceItem({ data, visual }: { data: EvidenceData; visual: EvidenceVisual }) {
  const cls = [
    styles.ev,
    visual === 'bright' ? styles.evBright : '',
    visual === 'recede' ? styles.evRecede : '',
  ].filter(Boolean).join(' ');
  return (
    <div className={cls} style={{ left: data.pos.left, top: data.pos.top }}>
      <div className={styles.evType}>{data.source}</div>
      {data.text}
    </div>
  );
}
