import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// Add context routes each founder-language intent to the CORRECT existing primitive, preserving the frozen
// epistemic lanes: material → DECLARED evidence, "something changed" → held-truth correction, link → website.

vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: '/b/b1/home' }) }));
vi.mock('../api/client', () => ({
  learnFromMaterial: vi.fn(), learnBusiness: vi.fn(), submitCorrection: vi.fn(),
}));

import * as api from '../api/client';
import { AddContextProvider, useAddContext } from '../slice0/AddContextDrawer';

function Harness() {
  const { open } = useAddContext();
  return <button onClick={open}>open</button>;
}
const openDrawer = () => {
  render(<AddContextProvider><Harness /></AddContextProvider>);
  fireEvent.click(screen.getByText('open'));
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.learnFromMaterial).mockResolvedValue({} as never);
  vi.mocked(api.learnBusiness).mockResolvedValue({} as never);
  vi.mocked(api.submitCorrection).mockResolvedValue({} as never);
});
afterEach(cleanup);

describe('Add context — intent routing preserves the epistemic lanes', () => {
  it('"I have something to add" → learnFromMaterial (DECLARED), not a correction', async () => {
    openDrawer();
    fireEvent.click(screen.getByText('add.intent.material'));
    fireEvent.change(screen.getByPlaceholderText('add.material.ph'), { target: { value: 'We are a handmade sourdough bakery in Bristol.' } });
    fireEvent.click(screen.getByText('add.submit'));
    await waitFor(() => expect(api.learnFromMaterial).toHaveBeenCalledWith('b1', expect.stringContaining('sourdough'), 'add_context'));
    expect(api.submitCorrection).not.toHaveBeenCalled();
    expect(screen.getByText('add.done.material')).toBeInTheDocument();
  });

  it('"Something changed" → submitCorrection (held truth) with a subject, not declared material', async () => {
    openDrawer();
    fireEvent.click(screen.getByText('add.intent.changed'));
    fireEvent.change(screen.getByPlaceholderText('add.changed.ph'), { target: { value: 'We no longer offer karate.' } });
    fireEvent.click(screen.getByText('add.submit'));
    await waitFor(() => expect(api.submitCorrection).toHaveBeenCalledWith('b1', 'offer', 'We no longer offer karate.'));
    expect(api.learnFromMaterial).not.toHaveBeenCalled();
  });

  it('"Add a link" → learnBusiness (observed website)', async () => {
    openDrawer();
    fireEvent.click(screen.getByText('add.intent.link'));
    fireEvent.change(screen.getByPlaceholderText('add.link.ph'), { target: { value: 'example.com/new' } });
    fireEvent.click(screen.getByText('add.submit'));
    await waitFor(() => expect(api.learnBusiness).toHaveBeenCalledWith('b1', 'example.com/new'));
    expect(api.submitCorrection).not.toHaveBeenCalled();
    expect(api.learnFromMaterial).not.toHaveBeenCalled();
  });

  it('too-thin material is rejected before any call', async () => {
    openDrawer();
    fireEvent.click(screen.getByText('add.intent.material'));
    fireEvent.change(screen.getByPlaceholderText('add.material.ph'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByText('add.submit'));
    expect(screen.getByText('add.err.short')).toBeInTheDocument();
    expect(api.learnFromMaterial).not.toHaveBeenCalled();
  });
});
