import { useState } from 'react';
import { connect } from '../fixtures';
import { ConnectionCard } from './ConnectionCard';
import styles from '../actone.module.css';

/** Scene 2 — Connect: the lightest give (a tap). Enables once ≥1 source is selected. */
export function ConnectionPanel({ onConnect }: { onConnect: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [spent, setSpent] = useState(false);

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  const count = selected.size;

  return (
    <div className={styles.block}>
      <div className={styles.sources}>
        {connect.sources.map((s) => (
          <ConnectionCard key={s} name={s} on={selected.has(s)} onToggle={() => !spent && toggle(s)} />
        ))}
      </div>
      <div className={`${styles.btnrow} ${spent ? styles.btnrowSpent : ''}`}>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          disabled={count === 0 || spent}
          onClick={() => { setSpent(true); onConnect(); }}
        >
          {connect.button}
        </button>
        <span className={styles.minihint}>{count === 0 ? connect.hintEmpty : connect.hintCount(count)}</span>
      </div>
    </div>
  );
}
