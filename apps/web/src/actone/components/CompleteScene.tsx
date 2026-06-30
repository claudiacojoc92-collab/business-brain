import { useState } from 'react';
import { week } from '../fixtures';
import { useTimeline } from '../useTimeline';
import { SayLine } from './SayLine';
import styles from '../actone.module.css';

/** Final beat — the relationship begins. Terminal phase; no advance. */
export function CompleteScene() {
  const [visible, setVisible] = useState(1);
  useTimeline([{ at: week.completeLines[0].pause, run: () => setVisible(2) }]);
  return (
    <>
      {week.completeLines.slice(0, visible).map((l, i) => (
        <SayLine key={i} rich={l.rich} kind={l.kind} />
      ))}
      <div className={styles.spacer} />
    </>
  );
}
