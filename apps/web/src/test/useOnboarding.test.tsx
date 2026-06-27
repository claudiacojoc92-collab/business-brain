import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// Mock the API client used by the hook (resolves to src/api/client).
vi.mock('../api/client', () => {
  class ApiError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return {
    ApiError,
    submitIntakeSignal: vi.fn().mockResolvedValue({ session_id: 's', signal_type: 'x', saved: true }),
    completeIntake: vi.fn().mockResolvedValue({ founder_id: 'f', status: 'ACTIVE' }),
  };
});

import { useOnboarding } from '../onboarding/useOnboarding';
import * as client from '../api/client';
import { QUESTIONS } from '../onboarding/questions';

const mockSubmit = client.submitIntakeSignal as unknown as ReturnType<typeof vi.fn>;
const mockComplete = client.completeIntake as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockSubmit.mockResolvedValue({ session_id: 's', signal_type: 'x', saved: true });
  mockComplete.mockResolvedValue({ founder_id: 'f', status: 'ACTIVE' });
});

describe('useOnboarding', () => {
  it('starts on the first question with an empty draft', () => {
    const { result } = renderHook(() => useOnboarding(vi.fn()));
    expect(result.current.phase).toEqual({ kind: 'question', index: 0 });
    expect(result.current.draft).toBe('');
  });

  it('submits the current answer with the right signal_type and advances', async () => {
    const { result } = renderHook(() => useOnboarding(vi.fn()));
    act(() => result.current.setDraft('my answer'));
    act(() => result.current.advance());

    expect(result.current.phase).toEqual({ kind: 'question', index: 1 });
    expect(result.current.draft).toBe('');
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockSubmit).toHaveBeenCalledWith(QUESTIONS[0].signal_type, 'my answer', expect.any(String));
  });

  it('shows a block reflection after the last question of a block, then continues', () => {
    const { result } = renderHook(() => useOnboarding(vi.fn()));
    for (let i = 0; i < 6; i++) {
      act(() => result.current.setDraft('a'));
      act(() => result.current.advance());
    }
    expect(result.current.phase).toEqual({ kind: 'reflection', block: 1, nextIndex: 6 });

    act(() => result.current.continueAfterReflection());
    expect(result.current.phase).toEqual({ kind: 'question', index: 6 });
  });

  it('submits an empty signal when the founder skips (advances blank)', async () => {
    const { result } = renderHook(() => useOnboarding(vi.fn()));
    act(() => result.current.advance()); // empty draft
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockSubmit).toHaveBeenCalledWith(QUESTIONS[0].signal_type, '', expect.any(String));
  });

  it('drives all 28 questions to completion and calls completeIntake + onComplete', async () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => useOnboarding(onComplete));

    for (let guard = 0; guard < 100; guard++) {
      const phase = result.current.phase;
      if (phase.kind === 'complete') break;
      if (phase.kind === 'reflection') {
        act(() => result.current.continueAfterReflection());
        continue;
      }
      act(() => result.current.setDraft('answer'));
      act(() => result.current.advance());
    }

    expect(result.current.phase).toEqual({ kind: 'complete' });
    expect(mockSubmit).toHaveBeenCalledTimes(QUESTIONS.length); // 28
    await waitFor(() => expect(mockComplete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  it('surfaces a save error and retries with the same idempotency key without losing the answer', async () => {
    mockSubmit.mockRejectedValueOnce(new client.ApiError(500, 'INTERNAL', 'boom'));
    const { result } = renderHook(() => useOnboarding(vi.fn()));

    act(() => result.current.setDraft('keep me'));
    act(() => result.current.advance());

    await waitFor(() => expect(result.current.saveError).not.toBeNull());
    const firstKey = result.current.saveError?.idempotencyKey;
    expect(result.current.saveError?.value).toBe('keep me');

    act(() => result.current.retryFailedSave());
    await waitFor(() => expect(result.current.saveError).toBeNull());
    expect(mockSubmit).toHaveBeenCalledTimes(2);
    // Retry reuses the same idempotency key (safe to retry)
    expect(mockSubmit).toHaveBeenLastCalledWith(QUESTIONS[0].signal_type, 'keep me', firstKey);
  });
});
