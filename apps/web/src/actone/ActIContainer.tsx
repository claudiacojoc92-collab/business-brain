import { useEffect, useRef, useState } from 'react';
import type { Phase } from './types';
import { nextPhase, phaseIndex, railFor } from './machine';
import {
  contactLines, connect, analyzingLine, absorbingLine, gift,
} from './fixtures';
import { useTimeline } from './useTimeline';
import { ActIRail } from './components/ActIRail';
import { SayLine } from './components/SayLine';
import { ConnectionPanel } from './components/ConnectionPanel';
import { SeeingStage } from './components/SeeingStage';
import { VerdictBar } from './components/VerdictBar';
import { ConversationComposer } from './components/ConversationComposer';
import { GiftPreview } from './components/GiftPreview';
import { WeekPlanner } from './components/WeekPlanner';
import { CompleteScene } from './components/CompleteScene';
import styles from './actone.module.css';

// ── small say-only / holding scenes (co-located; each owns its own timers) ──
function ContactScene({ onDone }: { onDone: () => void }) {
  const [visible, setVisible] = useState(1);
  const p0 = contactLines[0].pause;
  const p1 = p0 + contactLines[1].pause;
  const p2 = p1 + contactLines[2].pause;
  useTimeline([
    { at: p0, run: () => setVisible((v) => Math.max(v, 2)) },
    { at: p1, run: () => setVisible((v) => Math.max(v, 3)) },
    { at: p2, run: onDone },
  ]);
  return <>{contactLines.slice(0, visible).map((l, i) => <SayLine key={i} rich={l.rich} kind={l.kind} />)}</>;
}

function ConnectScene({ onConnect }: { onConnect: () => void }) {
  const [step, setStep] = useState(0); // 0 kicker · 1 line · 2 panel
  useTimeline([
    { at: 400, run: () => setStep((s) => Math.max(s, 1)) },
    { at: 1100, run: () => setStep((s) => Math.max(s, 2)) },
  ]);
  return (
    <>
      <span className={styles.kick}>{connect.kicker}</span>
      {step >= 1 && <SayLine rich={[connect.line]} kind="med" />}
      {step >= 2 && <ConnectionPanel onConnect={onConnect} />}
    </>
  );
}

function HoldingLine({
  rich, kind = 'med', advanceAt, onDone,
}: { rich: Parameters<typeof SayLine>[0]['rich']; kind?: 'big' | 'med' | 'admit'; advanceAt: number; onDone: () => void }) {
  useTimeline([{ at: advanceAt, run: onDone }]);
  return <SayLine rich={rich} kind={kind} />;
}

const INITIAL: Phase = 'contact';

export function ActIContainer() {
  const [phase, setPhase] = useState<Phase>(INITIAL);
  const [founderAnswer, setFounderAnswer] = useState('');
  const [giftReaction, setGiftReaction] = useState<'gy' | 'ga' | 'gn' | ''>('');
  const endRef = useRef<HTMLDivElement>(null);

  // Idempotent advance — guards against StrictMode/double-fire (only moves if we're still at `from`).
  const advance = (from: Phase) => setPhase((p) => (p === from ? nextPhase(p) : p));

  // Gentle anchor: ease to the newest content when a phase is appended (won't fight manual scroll between phases).
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [phase, founderAnswer, giftReaction]);

  const reached = (p: Phase) => phaseIndex(phase) >= phaseIndex(p);
  const rail = railFor(phase);

  const reset = () => { setFounderAnswer(''); setGiftReaction(''); setPhase(INITIAL); };

  return (
    <div className={styles.root}>
      <ActIRail active={rail.active} done={rail.done} />
      <div className={styles.stage}>
        {reached('contact') && <ContactScene onDone={() => advance('contact')} />}
        {reached('connect') && <ConnectScene onConnect={() => advance('connect')} />}
        {reached('analyzing') && (
          <HoldingLine rich={[analyzingLine]} advanceAt={1100} onDone={() => advance('analyzing')} />
        )}
        {reached('seeing') && <SeeingStage onComplete={() => advance('seeing')} />}
        {reached('seeing_verdict') && <VerdictBar onComplete={() => advance('seeing_verdict')} />}
        {reached('conversation') && (
          <ConversationComposer onSubmit={(a) => { setFounderAnswer(a); advance('conversation'); }} />
        )}
        {reached('absorbing') && (
          <HoldingLine rich={absorbingLine} advanceAt={1700} onDone={() => advance('absorbing')} />
        )}
        {reached('gift') && (
          <GiftPreview
            founderAnswer={founderAnswer}
            onReact={(id) => { setGiftReaction(id as 'gy' | 'ga' | 'gn'); advance('gift'); }}
          />
        )}
        {reached('gift_reacted') && giftReaction && (
          <HoldingLine rich={gift.reactionLines[giftReaction]} advanceAt={1900} onDone={() => advance('gift_reacted')} />
        )}
        {reached('week') && <WeekPlanner onDecide={() => advance('week')} />}
        {reached('complete') && <CompleteScene />}
        <div ref={endRef} />
      </div>
      <div className={styles.devbadge}>
        Act I · M1 preview (fixtures) · <button onClick={reset}>↺ start over</button>
      </div>
    </div>
  );
}
