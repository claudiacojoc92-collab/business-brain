import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ConversationComposer } from '../actone/components/ConversationComposer';
import { GiftPreview } from '../actone/components/GiftPreview';

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
