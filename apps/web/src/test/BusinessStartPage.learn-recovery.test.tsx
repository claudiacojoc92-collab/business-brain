import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// The learn request can be dropped by the proxy/network while the API keeps working and persists the
// result. These tests prove the founder never sees a terminal failure while the result is still landing,
// a genuine failure still resolves to a real failure, and recovery never re-submits the learn.

vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'en' }) }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useParams: () => ({ id: 'b1' }), useNavigate: () => () => {}, Navigate: () => null };
});
vi.mock('../slice0/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../slice0/session', () => ({ useSession: () => ({ account: { name: 'Founder' } }) }));
vi.mock('../api/client', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); }
  }
  return {
    ApiError,
    getBusiness: vi.fn(), getAha: vi.fn(), getDiscoveredProfiles: vi.fn(),
    learnBusiness: vi.fn(), setDiscoveredProfileStatus: vi.fn(),
  };
});

import * as api from '../api/client';
import { BusinessStartPage } from '../slice0/BusinessStartPage';

const drain = async (): Promise<void> => {
  // mount load() chains getBusiness → getAha; drain enough microtask rounds for the state to settle.
  for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0);
};

async function reachWebsiteAndSubmit(): Promise<void> {
  render(<BusinessStartPage />);
  await drain();                                   // mount load() → intro
  fireEvent.click(screen.getByText('start.cta'));  // intro → website
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'acme.com' } });
  fireEvent.submit(input.closest('form')!);        // → runLearn
  await drain();                                   // let the rejected learn settle into recovery
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.mocked(api.getBusiness).mockResolvedValue({ id: 'b1', name: 'Acme' } as never);
  vi.mocked(api.getDiscoveredProfiles).mockResolvedValue({ profiles: [] } as never);
});
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('BusinessStartPage — learn timeout recovery', () => {
  it('a dropped long-running learn does NOT become a terminal failure — eventual persisted success is surfaced', async () => {
    // mount sees no prior Aha; the learn REQUEST is dropped (proxy timeout); the Aha lands shortly after.
    vi.mocked(api.getAha)
      .mockResolvedValueOnce({ state: 'none' } as never)
      .mockResolvedValue({ state: 'produced', findings: [{ finding: 'Founder-led studio', sourceRefs: [] }] } as never);
    vi.mocked(api.learnBusiness).mockRejectedValue(new api.ApiError(504, 'GATEWAY_TIMEOUT', 'gateway timeout'));

    await reachWebsiteAndSubmit();
    // While recovering, the founder is still in the honest "reading" state — NOT a failure.
    expect(screen.queryByText('learn.fail.title')).toBeNull();
    expect(screen.getByText('reading.sub')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(6000); // first recovery poll → Aha 'produced'

    expect(screen.getByText('aha.heading')).toBeInTheDocument();     // success surfaced
    expect(screen.getByText('Founder-led studio')).toBeInTheDocument();
    expect(screen.queryByText('learn.fail.title')).toBeNull();
    // recovery polls the persisted result — it must NEVER re-submit the learn (no duplicate state).
    expect(api.learnBusiness).toHaveBeenCalledTimes(1);
  });

  it('a genuine failure (nothing ever persists) still resolves to a real failure state', async () => {
    vi.mocked(api.getAha).mockResolvedValue({ state: 'none' } as never); // never lands
    vi.mocked(api.learnBusiness).mockRejectedValue(new api.ApiError(504, 'GATEWAY_TIMEOUT', 'gateway timeout'));

    await reachWebsiteAndSubmit();
    expect(screen.queryByText('learn.fail.title')).toBeNull(); // still working, not yet failed

    await vi.advanceTimersByTimeAsync(280_000); // exhaust the recovery window (~4.5min)

    expect(screen.getByText('learn.fail.title')).toBeInTheDocument(); // real failure
    expect(api.learnBusiness).toHaveBeenCalledTimes(1);              // never re-submitted
  });

  it('a normal fast success (no drop) surfaces the result directly', async () => {
    vi.mocked(api.getAha).mockResolvedValue({ state: 'none' } as never); // mount only
    vi.mocked(api.learnBusiness).mockResolvedValue({
      state: 'synced', pagesRead: 3, discovered: [],
      aha: { status: 'produced', findings: [{ finding: 'Clear switcher angle', sourceRefs: [] }] },
    } as never);

    await reachWebsiteAndSubmit();
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.getByText('aha.heading')).toBeInTheDocument();
    expect(screen.getByText('Clear switcher angle')).toBeInTheDocument();
    expect(api.getAha).toHaveBeenCalledTimes(1); // mount only — no recovery polling on the success path
  });
});
