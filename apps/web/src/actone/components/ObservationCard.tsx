import { useState } from 'react';
import type { Rich } from '../types';
import { TIMING } from '../fixtures';
import { useTimeline } from '../useTimeline';
import { ComposedText, composeDuration } from './rich';
import styles from '../actone.module.css';

/**
 * The surfaced observation composes word-by-word; the reframe appears as a DISTINCT
 * beat AFTER the observation settles, then the scene advances (to the verdict).
 */
export function ObservationCard({
  text,
  reframe,
  onSettled,
}: {
  text: Rich;
  reframe: string;
  onSettled: () => void;
}) {
  const [showReframe, setShowReframe] = useState(false);
  const dur = composeDuration(text);

  useTimeline([
    { at: dur + TIMING.beat, run: () => setShowReframe(true) },
    { at: dur + TIMING.beat + 1700, run: onSettled },
  ]);

  return (
    <>
      <div className={styles.block}>
        <div className={styles.obs}><ComposedText text={text} /></div>
      </div>
      {showReframe && (
        <div className={styles.block}>
          <div className={styles.reframe}>{reframe}</div>
        </div>
      )}
    </>
  );
}
