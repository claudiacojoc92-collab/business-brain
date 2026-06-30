import type { RailFacet } from '../types';
import styles from '../actone.module.css';

const FACETS: ReadonlyArray<{ key: RailFacet; label: string }> = [
  { key: 'business', label: 'your business' },
  { key: 'thinking', label: 'your thinking' },
  { key: 'voice', label: 'your voice' },
  { key: 'rhythm', label: 'your operating rhythm' },
];

/** The "Getting to know" rail — deepening relationship. No percentage, no step count (§4). */
export function ActIRail({ active, done }: { active: RailFacet | null; done: RailFacet[] }) {
  return (
    <aside className={styles.rail}>
      <div className={styles.mark}>
        <div className={styles.glyph} />
        <div className={styles.markName}>Business&nbsp;Brain</div>
      </div>
      <div className={styles.railLabel}>Getting to know</div>
      {FACETS.map((f) => {
        const cls = [
          styles.step,
          done.includes(f.key) ? styles.stepDone : '',
          active === f.key ? styles.stepActive : '',
        ].filter(Boolean).join(' ');
        return (
          <div key={f.key} className={cls}>
            <div className={styles.stepIc} />
            {f.label}
          </div>
        );
      })}
      <div className={styles.railFoot}>No rush. We go as deep as you let me.</div>
    </aside>
  );
}
