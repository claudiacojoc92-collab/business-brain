import { useState } from 'react';
import { evidence, seeing, TIMING } from '../fixtures';
import type { EvidenceVisual } from '../types';
import { useTimeline } from '../useTimeline';
import { EvidenceItem } from './EvidenceItem';
import { ObservationCard } from './ObservationCard';
import styles from '../actone.module.css';

/**
 * Scene 3 — The Seeing. Evidence reveals, irrelevant items recede, relevant items
 * brighten (staggered), then the observation composes and the reframe lands.
 * onComplete advances to the verdict (seeing_verdict).
 */
export function SeeingStage({ onComplete }: { onComplete: () => void }) {
  const [showCloud, setShowCloud] = useState(false);
  const [receded, setReceded] = useState(false);
  const [bright, setBright] = useState<ReadonlySet<string>>(new Set());
  const [showObs, setShowObs] = useState(false);

  const relevant = evidence.filter((e) => e.relevant);
  const cloudAt = 250;
  const recedeAt = cloudAt + TIMING.recedeAfter;
  const brightStart = recedeAt + TIMING.brightAfter;
  const brightEnd = brightStart + relevant.length * TIMING.brightStagger;

  useTimeline([
    { at: cloudAt, run: () => setShowCloud(true) },
    { at: recedeAt, run: () => setReceded(true) },
    ...relevant.map((e, i) => ({
      at: brightStart + i * TIMING.brightStagger,
      run: () => setBright((prev) => new Set(prev).add(e.key)),
    })),
    { at: brightEnd + 1450, run: () => setShowObs(true) },
  ]);

  const visualFor = (key: string, relevantFlag: boolean): EvidenceVisual => {
    if (bright.has(key)) return 'bright';
    if (receded && !relevantFlag) return 'recede';
    return 'neutral';
  };

  return (
    <>
      <span className={styles.kick}>{seeing.kicker}</span>
      {showCloud && (
        <div className={`${styles.block} ${styles.cloud}`}>
          {evidence.map((e) => (
            <EvidenceItem key={e.key} data={e} visual={visualFor(e.key, e.relevant)} />
          ))}
        </div>
      )}
      {showObs && (
        <ObservationCard text={seeing.observation} reframe={seeing.reframe} onSettled={onComplete} />
      )}
    </>
  );
}
