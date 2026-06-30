import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ConversationComposer } from '../actone/components/ConversationComposer';
import { GiftPreview } from '../actone/components/GiftPreview';
import { SeeingStage } from '../actone/components/SeeingStage';
import { VerdictBar } from '../actone/components/VerdictBar';
import { weekBridge } from '../actone/fixtures';

/**
 * Act I — M1 acceptance-critical coupling: the founder's ACTUAL typed Conversation
 * answer must flow into the Gift echo. Verified at both ends.
 */
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

describe('Act I — Conversation composer', () => {
  it('disables submit under 3 chars and emits the trimmed typed answer', () => {
    const onSubmit = vi.fn();
    render(<ConversationComposer onSubmit={onSubmit} />);
    act(() => { vi.advanceTimersByTime(2700); }); // reveal the deep field

    const field = screen.getByRole('textbox');
    const submit = screen.getByRole('button', { name: /tell business brain/i });

    fireEvent.change(field, { target: { value: 'ab' } });
    expect(submit).toBeDisabled();

    fireEvent.change(field, { target: { value: '  the frustration is the real me  ' } });
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith('the frustration is the real me');
  });
});

describe('Act I — Gift echo', () => {
  it("renders the founder's actual typed answer in the echo line", () => {
    render(<GiftPreview founderAnswer="the frustration is the real me" onReact={() => {}} />);
    act(() => { vi.advanceTimersByTime(1800); }); // reveal the draft + echo

    expect(screen.getByText(/Built from what you just told me/i)).toBeInTheDocument();
    expect(screen.getByText(/the frustration is the real me/)).toBeInTheDocument();
  });

  it('falls back to a generic echo when no answer was given (honest, no fabrication)', () => {
    render(<GiftPreview founderAnswer="" onReact={() => {}} />);
    act(() => { vi.advanceTimersByTime(1800); });

    expect(screen.getByText(/Built toward your sharper voice/i)).toBeInTheDocument();
    expect(screen.queryByText(/Built from what you just told me/i)).toBeNull();
  });
});

describe('Act I — Seeing renders only connected sources (sample-framed)', () => {
  it('shows evidence from selected sources only and marks the Seeing as a sample', () => {
    render(<SeeingStage selectedSources={['Instagram']} onComplete={() => {}} />);
    act(() => { vi.advanceTimersByTime(300); }); // reveal the cloud

    expect(screen.getByText(/A sample business/i)).toBeInTheDocument();            // (b) sample marker
    expect(screen.getByText(/Stop posting daily and hoping/i)).toBeInTheDocument(); // instagram (connected)
    expect(screen.queryByText(/Marketing Clarity Package/i)).toBeNull();            // website (NOT connected)
    expect(screen.queryByText(/5 tools every founder needs/i)).toBeNull();          // linkedin (NOT connected)
  });
});

describe('Act I — verdict confirm/correct (Evidence & Trust Model)', () => {
  it('confirm resolves as confirmed', () => {
    const onResolve = vi.fn();
    render(<VerdictBar onResolve={onResolve} />);
    fireEvent.click(screen.getByRole('button', { name: /yes — that's right/i }));
    expect(onResolve).toHaveBeenCalledWith({ confirmed: true });
  });

  it('"Not quite" resolves with the typed correction (replaces the read)', () => {
    const onResolve = vi.fn();
    render(<VerdictBar onResolve={onResolve} />);
    fireEvent.click(screen.getByRole('button', { name: /not quite/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'the frustration is deliberate' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    act(() => { vi.advanceTimersByTime(1400); });
    expect(onResolve).toHaveBeenCalledWith({ confirmed: false, text: 'the frustration is deliberate' });
  });
});

describe('Act I — week bridge surfaces the carried understanding (provenance)', () => {
  it('confirmed read reads as confirmed; correction carries through; empty demotes', () => {
    expect(weekBridge({ text: 'X', origin: 'i-observed-sample', source: 'confirmed' }))
      .toMatch(/what you just confirmed/i);
    expect(weekBridge({ text: 'the frustration is deliberate', origin: 'you-told-me', source: 'corrected' }))
      .toMatch(/what you told me.*the frustration is deliberate/i);
    expect(weekBridge({ text: '', origin: 'i-suspect', source: 'corrected' }))
      .toMatch(/set my first read aside/i);
  });
});
