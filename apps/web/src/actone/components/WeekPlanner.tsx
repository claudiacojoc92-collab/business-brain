import { useState } from 'react';
import { week } from '../fixtures';
import { useTimeline } from '../useTimeline';
import { SayLine } from './SayLine';
import { ApprovalBar } from './ApprovalBar';
import styles from '../actone.module.css';

/** Scene 6 — Week One. Three drafted items, then the approval decision. */
export function WeekPlanner({ onDecide }: { onDecide: () => void }) {
  const [step, setStep] = useState(0); // 0 intro · 1 kicker · 2 plan · 3 approval

  useTimeline([
    { at: 1450, run: () => setStep((s) => Math.max(s, 1)) },
    { at: 1700, run: () => setStep((s) => Math.max(s, 2)) },
    { at: 3100, run: () => setStep((s) => Math.max(s, 3)) },
  ]);

  return (
    <>
      <SayLine rich={[week.intro]} kind="med" />
      {step >= 1 && <span className={styles.kick}>{week.kicker}</span>}
      {step >= 2 && (
        <div className={styles.block}>
          <div className={styles.plan}>
            {week.items.map((it, i) => (
              <div key={i} className={styles.pday}>
                <div className={styles.pdayDay}>{it.day}</div>
                <div className={styles.pdayCopy}>
                  {it.title}
                  <span className={styles.pdayNote}>{it.note}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {step >= 3 && <ApprovalBar onDecide={onDecide} />}
    </>
  );
}
