import { useState } from 'react';
import { evidence, seeing, TIMING } from '../fixtures';
import type { EvidenceVisual } from '../types';
import { useTimeline } from '../useTimeline';
import { EvidenceItem } from './EvidenceItem';
import { ObservationCard } from './ObservationCard';
import { SayLine } from './SayLine';
import styles from '../actone.module.css';

/**
 * Scene 3 — The Seeing. Renders ONLY the sources the founder connected (a), and is
 * framed as a labeled SAMPLE business (b) — so nothing reads as a claim about the
 * founder's own business. Irrelevant items recede, relevant brighten, the observation
 * composes, the reframe (a hypothesis) lands; onComplete advances to the verdict.
 */
export function SeeingStage({
  selectedSources,
  onComplete,
}: {
  selectedSources: string[];
  onComplete: () => void;
}) {
  const [showCloud, setShowCloud] = useState(false);
  const [receded, setReceded] = useState(false);
  const [bright, setBright] = useState<ReadonlySet<string>>(new Set());
  const [showObs, setShowObs] = useState(false);

  // (a) Only evidence from sources the founder actually connected.
  const connected = new Set(selectedSources.map((s) => s.toLowerCase()));
  const shown = evidence.filter((e) => connected.has(e.source.toLowerCase()));
  const relevant = shown.filter((e) => e.relevant);
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
      <div className={styles.note}>{seeing.sampleMarker}</div>
      <SayLine rich={[seeing.framing]} kind="med" />
      {showCloud && (
        <div className={`${styles.block} ${styles.cloud}`}>
          {shown.map((e) => (
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
