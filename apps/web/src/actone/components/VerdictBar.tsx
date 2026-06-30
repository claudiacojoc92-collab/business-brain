import { useState } from 'react';
import { verdict } from '../fixtures';
import styles from '../actone.module.css';

/**
 * The verdict on the observation. Confirm advances; "Not quite" opens a one-line
 * correction → a (canned) sharpened line → then advances. Both paths reach the
 * next phase (conversation).
 */
export function VerdictBar({ onComplete }: { onComplete: () => void }) {
  const [mode, setMode] = useState<'choose' | 'correcting' | 'sharpened'>('choose');
  const [text, setText] = useState('');
  const [sharpened, setSharpened] = useState('');

  const send = () => {
    setSharpened(text.trim() ? verdict.sharpenedWithText : verdict.sharpenedEmpty);
    setMode('sharpened');
    window.setTimeout(onComplete, 1400);
  };

  if (mode === 'sharpened') {
    return (
      <div className={styles.block}>
        <div className={styles.reframe} style={{ animationName: 'none', opacity: 1, transform: 'none' }}>
          {sharpened}
        </div>
      </div>
    );
  }

  if (mode === 'correcting') {
    return (
      <div className={styles.block}>
        <div className={`${styles.say} ${styles.med}`} style={{ fontStyle: 'italic', color: 'var(--ink-2)' }}>
          {verdict.correctionPrompt}
        </div>
        <input
          className={styles.textInput}
          value={text}
          autoFocus
          placeholder={verdict.correctionPlaceholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
        />
        <div className={styles.btnrow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={send}>{verdict.send}</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.block}>
      <div className={styles.btnrow}>
        <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={onComplete}>{verdict.confirm}</button>
        <button className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setMode('correcting')}>{verdict.deny}</button>
      </div>
    </div>
  );
}
