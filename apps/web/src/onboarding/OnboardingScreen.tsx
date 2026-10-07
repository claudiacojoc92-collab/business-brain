/**
 * src/onboarding/OnboardingScreen.tsx
 *
 * The B1 conversational onboarding UI.
 *
 * UX rules (from spec):
 *   - One question visible at a time. No progress bar. No question numbers.
 *   - Free text <textarea> only.
 *   - Auto-advance: double-Enter (two consecutive newlines at the end)
 *     OR the "Continue →" link below the textarea.
 *   - 300ms CSS transition before next question appears.
 *   - Block reflections appear between blocks with 300ms fade-in.
 *   - "Continue" advances to next block's first question.
 *   - Mobile-first. Full-width textarea.
 *   - Empty advance = submit signal with empty string (skip recorded).
 *   - Inline save error + retry without losing answer.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { QUESTIONS, REFLECTIONS } from './questions';
import { useOnboarding } from './useOnboarding';
import styles from './OnboardingScreen.module.css';

interface OnboardingScreenProps {
  /** Called when CompleteIntake succeeds and the founder should be redirected. */
  onComplete: () => void;
}

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const {
    phase,
    draft,
    isSaving,
    saveError,
    setDraft,
    advance,
    continueAfterReflection,
    retryFailedSave,
  } = useOnboarding(onComplete);

  // Control the fade-in animation
  const [visible, setVisible] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Trigger 300ms fade-in whenever phase changes
  useEffect(() => {
    setVisible(false);
    const t = setTimeout(() => {
      setVisible(true);
      if (phase.kind === 'question') {
        textareaRef.current?.focus();
      }
    }, 300);
    return () => clearTimeout(t);
  }, [phase]);

  // Auto-advance on double-Enter (two newlines at the end of input)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const endsWithNewline = draft.endsWith('\n');
        if (endsWithNewline) {
          e.preventDefault();
          // Strip the trailing double-newline before submitting
          setDraft(draft.trimEnd());
          advance();
        }
        // First Enter: let it insert a newline (natural behaviour)
      }
    },
    [draft, advance, setDraft],
  );

  // ─── Completion screen ──────────────────────────────────────────────────────
  if (phase.kind === 'complete') {
    return (
      <div className={`${styles.container} ${styles.visible}`}>
        <div className={styles.completionCard}>
          <h1 className={styles.completionHeading}>I have what I need.</h1>
          <p className={styles.completionBody}>
            Your first brief will arrive on Monday morning. Business Brain will use
            everything you've just shared — your conviction, your voice, how your
            audience thinks, what your offer actually is — to produce a brief that's
            specific to you.
          </p>
        </div>
      </div>
    );
  }

  // ─── Block reflection ───────────────────────────────────────────────────────
  if (phase.kind === 'reflection') {
    const message = REFLECTIONS[phase.block];
    return (
      <div className={`${styles.container} ${visible ? styles.visible : ''}`}>
        <div className={styles.questionCard}>
          <p className={styles.reflection}>{message}</p>
          <button
            type="button"
            className={styles.continueBtn}
            onClick={continueAfterReflection}
          >
            Continue →
          </button>
        </div>
      </div>
    );
  }

  // ─── Question ───────────────────────────────────────────────────────────────
  const question = QUESTIONS[phase.index];

  return (
    <div className={`${styles.container} ${visible ? styles.visible : ''}`}>
      <div className={styles.questionCard}>
        <p className={styles.prompt}>{question.prompt}</p>

        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder=""
          rows={5}
          aria-label={question.prompt}
        />

        {/* Save error — inline, non-blocking */}
        {saveError && saveError.index === phase.index - 1 && (
          <div className={styles.errorBanner} role="alert">
            <span>{saveError.message}</span>
            <button
              type="button"
              className={styles.retryBtn}
              onClick={retryFailedSave}
              disabled={isSaving}
            >
              {isSaving ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        )}

        <div className={styles.controls}>
          {isSaving && <span className={styles.savingIndicator}>Saving…</span>}
          <button
            type="button"
            className={styles.continueLink}
            onClick={advance}
          >
            Continue →
          </button>
        </div>
      </div>
    </div>
  );
}
