import { useState } from 'react';
import { week } from '../fixtures';
import { RichText } from './rich';
import styles from '../actone.module.css';

/** Approve OR hold — both reach `complete`. No side effects (M1 is fixtures only). */
export function ApprovalBar({ onDecide }: { onDecide: () => void }) {
  const [spent, setSpent] = useState(false);
  const decide = () => { if (spent) return; setSpent(true); onDecide(); };

  return (
    <div className={styles.block}>
      <div className={`${styles.btnrow} ${spent ? styles.btnrowSpent : ''}`}>
        <button className={`${styles.btn} ${styles.btnGold}`} disabled={spent} onClick={decide}>{week.approve}</button>
        <button className={`${styles.btn} ${styles.btnGhost}`} disabled={spent} onClick={decide}>{week.hold}</button>
      </div>
      <div className={styles.note}><RichText text={week.note} /></div>
    </div>
  );
}
