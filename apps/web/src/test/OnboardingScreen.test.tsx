import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

import { OnboardingScreen } from '../onboarding/OnboardingScreen';
import * as client from '../api/client';
import { QUESTIONS, REFLECTIONS } from '../onboarding/questions';

const mockSubmit = client.submitIntakeSignal as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockSubmit.mockResolvedValue({ session_id: 's', signal_type: 'x', saved: true });
});

describe('OnboardingScreen', () => {
  it('renders the first question, one at a time (no progress bar / numbers)', () => {
    render(<OnboardingScreen onComplete={vi.fn()} />);
    expect(screen.getByText(QUESTIONS[0].prompt)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    // No second question shown simultaneously
    expect(screen.queryByText(QUESTIONS[1].prompt)).not.toBeInTheDocument();
  });

  it('submits the answer and advances to the next question on Continue', async () => {
    const user = userEvent.setup();
    render(<OnboardingScreen onComplete={vi.fn()} />);

    await user.type(screen.getByRole('textbox'), 'an answer');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText(QUESTIONS[1].prompt)).toBeInTheDocument();
    expect(mockSubmit).toHaveBeenCalledWith(QUESTIONS[0].signal_type, 'an answer', expect.any(String));
  });

  it('shows the block-1 reflection after the sixth question', async () => {
    const user = userEvent.setup();
    render(<OnboardingScreen onComplete={vi.fn()} />);

    for (let i = 0; i < 6; i++) {
      await user.click(screen.getByRole('button', { name: /continue/i }));
    }
    expect(await screen.findByText(REFLECTIONS[1])).toBeInTheDocument();
  });

  it('reaches the completion screen after the final question', async () => {
    const user = userEvent.setup();
    render(<OnboardingScreen onComplete={vi.fn()} />);

    for (let i = 0; i < 40; i++) {
      if (screen.queryByText('I have what I need.')) break;
      const buttons = screen.getAllByRole('button', { name: /continue/i });
      await user.click(buttons[0]);
    }
    expect(await screen.findByText('I have what I need.')).toBeInTheDocument();
  });
});
