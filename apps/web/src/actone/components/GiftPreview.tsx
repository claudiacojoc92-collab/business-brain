import { useState } from 'react';
import { gift } from '../fixtures';
import { useTimeline } from '../useTimeline';
import { SayLine } from './SayLine';
import styles from '../actone.module.css';

/**
 * Scene 5 — First Gift. The draft body is static fixture, but the echo line is LIVE:
 * it renders the founder's ACTUAL typed Conversation answer (the one live coupling in M1).
 */
export function GiftPreview({
  founderAnswer,
  onReact,
}: {
  founderAnswer: string;
  onReact: (reactionId: string) => void;
}) {
  const [step, setStep] = useState(0); // 0 intro · 1 kicker · 2 draft · 3 reactions
  const [spent, setSpent] = useState(false);

  useTimeline([
    { at: 1500, run: () => setStep((s) => Math.max(s, 1)) },
    { at: 1750, run: () => setStep((s) => Math.max(s, 2)) },
    { at: 3250, run: () => setStep((s) => Math.max(s, 3)) },
  ]);

  const answer = founderAnswer.trim();
  const quote = answer.length > gift.echoMax ? `${answer.slice(0, gift.echoMax)}…` : answer;

  return (
    <>
      <SayLine rich={[gift.intro]} kind="med" />
      {step >= 1 && <span className={styles.kick}>{gift.kicker}</span>}
      {step >= 2 && (
        <div className={styles.block}>
          <div className={styles.draft}>
            <div className={styles.draftLabel}>{gift.draft.label}</div>
            <div className={styles.draftHook}>{gift.draft.hook}</div>
            <div className={styles.draftBody}>{gift.draft.body}</div>
            <div className={styles.draftEcho}>
              {answer ? (
                <>
                  {gift.echoPrefix}
                  <b>“{quote}”</b>
                  {gift.echoSuffix}
                </>
              ) : (
                gift.echoFallback
              )}
            </div>
          </div>
        </div>
      )}
      {step >= 3 && (
        <div className={styles.block}>
          <div className={`${styles.btnrow} ${spent ? styles.btnrowSpent : ''}`}>
            {gift.reactions.map((r) => (
              <button
                key={r.id}
                className={`${styles.btn} ${r.id === 'gy' ? styles.btnPrimary : styles.btnGhost}`}
                disabled={spent}
                onClick={() => { setSpent(true); onReact(r.id); }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
