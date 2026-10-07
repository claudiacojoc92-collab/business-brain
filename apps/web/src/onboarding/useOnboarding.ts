/**
 * src/onboarding/useOnboarding.ts
 *
 * Core state machine for the B1 conversational onboarding flow.
 *
 * Responsibilities:
 *   - Track current question index and answer draft
 *   - Submit answers optimistically (advance UI immediately, save in background)
 *   - Show block reflections between blocks
 *   - Trigger CompleteIntake after the last question
 *   - Surface per-question save errors with retry capability (no answer loss)
 *
 * UX rules enforced:
 *   - Empty answers are submitted (skips are still signals)
 *   - No required field enforcement — advance always works
 *   - Double-Enter auto-advance is handled by the component
 */

import { useState, useCallback, useRef } from 'react';
import { submitIntakeSignal, completeIntake, ApiError } from '../api/client';
import { QUESTIONS, isLastInBlock } from './questions';
import { ulid } from '../utils/ulid';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Phase =
  | { kind: 'question'; index: number }
  | { kind: 'reflection'; block: number; nextIndex: number }
  | { kind: 'complete' };

export interface SaveError {
  index: number;
  signalType: string;
  value: string;
  idempotencyKey: string;
  message: string;
}

export interface OnboardingState {
  phase: Phase;
  draft: string;
  isSaving: boolean;
  saveError: SaveError | null;

  // Actions
  setDraft: (value: string) => void;
  advance: () => void;               // move to next question / reflection / complete
  continueAfterReflection: () => void;
  retryFailedSave: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOnboarding(onComplete: () => void): OnboardingState {
  const [phase, setPhase] = useState<Phase>({ kind: 'question', index: 0 });
  const [draft, setDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<SaveError | null>(null);

  // Keep a ref to the latest draft so async callbacks see current value
  const draftRef = useRef(draft);
  draftRef.current = draft;

  /**
   * Persist signal in the background.
   * Optimistic: UI advances immediately; failure is surfaced inline.
   */
  const persistSignal = useCallback(
    async (index: number, value: string, idempotencyKey: string) => {
      const question = QUESTIONS[index];
      setIsSaving(true);
      setSaveError(null);

      try {
        await submitIntakeSignal(question.signal_type, value, idempotencyKey);
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : 'Could not save your answer. Try again.';
        setSaveError({
          index,
          signalType: question.signal_type,
          value,
          idempotencyKey,
          message,
        });
      } finally {
        setIsSaving(false);
      }
    },
    [],
  );

  /**
   * Advance: submit current answer and move to next step.
   * Fires optimistically — UI moves before save completes.
   */
  const advance = useCallback(() => {
    if (phase.kind !== 'question') return;

    const { index } = phase;
    const value = draftRef.current;
    const idempotencyKey = ulid();

    // Clear draft for next question
    setDraft('');

    // Fire-and-forget save (optimistic)
    void persistSignal(index, value, idempotencyKey);

    const nextIndex = index + 1;

    if (isLastInBlock(index)) {
      const block = QUESTIONS[index].block;

      if (block === 6) {
        // Last block — go to completion after brief delay
        setPhase({ kind: 'complete' });
        // Trigger CompleteIntake on the backend
        void completeIntake(ulid()).then(() => onComplete());
      } else {
        // Show block reflection
        setPhase({ kind: 'reflection', block, nextIndex });
      }
    } else {
      setPhase({ kind: 'question', index: nextIndex });
    }
  }, [phase, persistSignal, onComplete]);

  /**
   * Continue from a block reflection to the first question of the next block.
   */
  const continueAfterReflection = useCallback(() => {
    if (phase.kind !== 'reflection') return;
    setPhase({ kind: 'question', index: phase.nextIndex });
  }, [phase]);

  /**
   * Retry a failed save using the same idempotency key (safe to retry).
   */
  const retryFailedSave = useCallback(() => {
    if (!saveError) return;
    const { index, value, idempotencyKey } = saveError;
    void persistSignal(index, value, idempotencyKey);
  }, [saveError, persistSignal]);

  return {
    phase,
    draft,
    isSaving,
    saveError,
    setDraft,
    advance,
    continueAfterReflection,
    retryFailedSave,
  };
}
