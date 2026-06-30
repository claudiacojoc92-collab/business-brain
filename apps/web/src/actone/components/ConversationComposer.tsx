import { useState } from 'react';
import { conversation } from '../fixtures';
import { useTimeline } from '../useTimeline';
import { SayLine } from './SayLine';
import styles from '../actone.module.css';

/**
 * Scene 4 — The Conversation: the heaviest give. A deep field with more room and a
 * gold submit. Submit is disabled until ≥ minChars. The typed answer is handed up
 * (it becomes the live Gift echo).
 */
export function ConversationComposer({ onSubmit }: { onSubmit: (answer: string) => void }) {
  const [step, setStep] = useState(0); // 0 intro · 1 kicker · 2 question · 3 field
  const [value, setValue] = useState('');
  const [spent, setSpent] = useState(false);

  useTimeline([
    { at: 1650, run: () => setStep((s) => Math.max(s, 1)) },
    { at: 1900, run: () => setStep((s) => Math.max(s, 2)) },
    { at: 2600, run: () => setStep((s) => Math.max(s, 3)) },
  ]);

  const tooShort = value.trim().length < conversation.minChars;
  const submit = () => {
    if (tooShort || spent) return;
    setSpent(true);
    onSubmit(value.trim());
  };

  return (
    <>
      <SayLine rich={conversation.intro} kind="med" />
      {step >= 1 && <span className={styles.kick}>{conversation.kicker}</span>}
      {step >= 2 && <SayLine rich={conversation.question} kind="big" />}
      {step >= 3 && (
        <div className={styles.block}>
          <div className={styles.deepfield}>
            <textarea
              className={styles.textarea}
              rows={4}
              value={value}
              placeholder={conversation.placeholder}
              disabled={spent}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <div className={`${styles.btnrow} ${spent ? styles.btnrowSpent : ''}`}>
            <button className={`${styles.btn} ${styles.btnGold}`} disabled={tooShort || spent} onClick={submit}>
              {conversation.button}
            </button>
            <span className={styles.minihint}>{conversation.hint}</span>
          </div>
        </div>
      )}
    </>
  );
}
