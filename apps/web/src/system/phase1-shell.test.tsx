import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Phase 1 (web) — the unified application shell. Proves the founder-facing surface holds together:
 *  · the primary nav uses ONLY founder-friendly names and is hidden when signed out;
 *  · legacy subsystem names never appear in the nav;
 *  · Home has two honest states — a new founder is invited to help Business Brain understand the business
 *    (NOT dropped into a blank Clarity box), a returning founder sees what's understood + the next move;
 *  · Sources shows each source's true state and Meta is "access pending" with no connect action / no fake data;
 *  · the type scale meets the readability minimums (body ≥17px, important ≥19px, generous line-height).
 */

// ── Mutable auth + client mocks (reconfigured per test) ──────────────────────────────────────────────────
const auth = { founderId: 'f1' as string | null, isLoading: false, refresh: vi.fn(), logout: vi.fn() };
vi.mock('../auth/AuthContext', () => ({ useAuth: () => auth }));

vi.mock('../api/client', () => ({
  getBusinessProfile: vi.fn(),
  getEffectiveUnderstanding: vi.fn(),
  listConcerns: vi.fn(),
  getSourcesStatus: vi.fn(),
  getPreferences: vi.fn(),
  setLanguage: vi.fn(),
  logoutSession: vi.fn(),
  TRUTH_LABEL_TEXT: { observed_from_material: 'Observed from your material', you_told_me: 'You told me', my_reading: 'My reading', you_corrected_this: 'You corrected this', unconfirmed_or_disagree: 'Unconfirmed / we disagree' },
}));

import * as client from '../api/client';
import { PrimaryNav } from './PrimaryNav';
import { HomePage } from '../home/HomePage';
import { SourcesPage } from '../sources/SourcesPage';

const m = client as unknown as Record<string, ReturnType<typeof vi.fn>>;
const EMPTY_PROFILE = { name: null, stage: null, description: null, offer: null, customer: null, goals: [], constraints: [], resources: [], otherToldMe: [], positioningCount: 0, hasAnyContext: false };

beforeEach(() => {
  vi.clearAllMocks();
  auth.founderId = 'f1'; auth.isLoading = false;
  m.getBusinessProfile.mockResolvedValue({ ...EMPTY_PROFILE, name: 'Lumen', hasAnyContext: true });
  m.getPreferences.mockResolvedValue({ language: 'en' });
  m.setLanguage.mockResolvedValue(undefined);
  m.logoutSession.mockResolvedValue(undefined);
  m.getEffectiveUnderstanding.mockResolvedValue({ current: [], unknowns: [], disagreements: [], recentlyAccepted: [] });
  m.listConcerns.mockResolvedValue([]);
  m.getSourcesStatus.mockResolvedValue([]);
});

const at = (path: string, ui: React.ReactElement) => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

describe('PrimaryNav — the one founder-facing navigation', () => {
  const FOUNDER_NAMES = ['Home', 'Business', 'Understanding', 'Clarity', 'Strategy', 'Sources', 'Account'];
  const LEGACY_NAMES = ['Market', 'Positioning', 'Strategic context', 'Reads', 'Login', 'Connect', 'Declare', 'Welcome'];

  it('renders exactly the seven founder-friendly names', async () => {
    at('/home', <PrimaryNav />);
    for (const n of FOUNDER_NAMES) expect(await screen.findByText(n)).toBeInTheDocument();
  });

  it('never shows a legacy subsystem name', async () => {
    at('/home', <PrimaryNav />);
    await screen.findByText('Home');
    for (const n of LEGACY_NAMES) expect(screen.queryByText(n)).toBeNull();
  });

  it('is hidden entirely when signed out', () => {
    auth.founderId = null;
    at('/home', <PrimaryNav />);
    expect(screen.queryByTestId('primary-nav')).toBeNull();
  });

  it('marks the current surface active (aria-current=page)', async () => {
    at('/business', <PrimaryNav />);
    const active = await screen.findByTestId('nav-business');
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('nav-home')).not.toHaveAttribute('aria-current', 'page');
  });

  it('shows the business name once known', async () => {
    at('/home', <PrimaryNav />);
    expect(await screen.findByTestId('nav-business-name')).toHaveTextContent('Lumen');
  });

  it('language toggle switches EN→RO and persists', async () => {
    at('/home', <PrimaryNav />);
    const toggle = await screen.findByTestId('lang-toggle');
    expect(toggle).toHaveTextContent('EN');
    fireEvent.click(toggle);
    await waitFor(() => expect(m.setLanguage).toHaveBeenCalledWith('ro'));
    expect(toggle).toHaveTextContent('RO');
  });
});

describe('Home — two honest states', () => {
  it('new founder is invited to help understand the business (not a blank Clarity box)', async () => {
    m.getBusinessProfile.mockResolvedValue({ ...EMPTY_PROFILE, hasAnyContext: false });
    at('/home', <HomePage />);
    expect(await screen.findByText(/Let’s help Business Brain understand your business\./)).toBeInTheDocument();
    expect(screen.getByText('Add your website')).toBeInTheDocument();
    expect(screen.getByText('Describe your business')).toBeInTheDocument();
    expect(screen.getByText('Continue later')).toBeInTheDocument();
    // NOT dropped into clarity first
    expect(screen.queryByTestId('home-clarity-entry')).toBeNull();
  });

  it('returning founder sees the business + a single most-useful next action', async () => {
    m.getBusinessProfile.mockResolvedValue({ ...EMPTY_PROFILE, name: 'Lumen', hasAnyContext: true });
    m.getEffectiveUnderstanding.mockResolvedValue({
      current: [{ id: 'i1', statement: 'A calm tool for solo founders.', label: 'my_reading', source: 'observed', origin: 'synthesis', createdAt: null }],
      unknowns: ['Who exactly buys first?'], disagreements: [], recentlyAccepted: [],
    });
    at('/home', <HomePage />);
    expect(await screen.findByText('Most useful next')).toBeInTheDocument();
    expect(screen.getByText('A calm tool for solo founders.')).toBeInTheDocument();
    expect(screen.getByText('Still incomplete')).toBeInTheDocument();
    // a returning founder CAN bring a tension, but it isn't the only thing offered
    expect(screen.getByTestId('home-clarity-entry')).toBeInTheDocument();
  });
});

describe('Sources — truthful state, Meta never faked', () => {
  it('renders each source status and offers no connect action for pending Meta', async () => {
    m.getSourcesStatus.mockResolvedValue([
      { key: 'founder', name: 'What you tell me', status: 'connected', detail: 'Describe your business.' },
      { key: 'website', name: 'Your website', status: 'not_added', detail: 'I read your site.' },
      { key: 'meta', name: 'Meta (Facebook / Instagram)', status: 'access_pending', detail: 'Connection is pending access. Nothing is connected yet.' },
      { key: 'future', name: 'More connections', status: 'unavailable', detail: 'Later.' },
    ]);
    at('/sources', <SourcesPage />);
    const meta = await screen.findByTestId('source-meta');
    expect(screen.getByTestId('source-meta-status')).toHaveTextContent('Access pending');
    // no action button inside the Meta card (pending sources cannot be connected)
    expect(meta.querySelector('button')).toBeNull();
    // a real, addable source does offer its one true action
    expect(screen.getByTestId('source-website').querySelector('button')).not.toBeNull();
    expect(screen.getByTestId('source-founder-status')).toHaveTextContent('Connected');
  });
});

describe('Typography — readability minimums (system.css)', () => {
  const css = readFileSync(`${process.cwd()}/src/styles/system.css`, 'utf8'); // vitest runs from apps/web
  const rem = (name: string): number => {
    const mt = css.match(new RegExp(`${name}\\s*:\\s*([0-9.]+)rem`));
    if (!mt) throw new Error(`token ${name} not found`);
    return parseFloat(mt[1]!);
  };
  it('body text is at least 17px', () => expect(rem('--fs-body')).toBeGreaterThanOrEqual(17 / 16));
  it('important text (--fs-4) is at least 19px', () => expect(rem('--fs-4')).toBeGreaterThanOrEqual(19 / 16));
  it('secondary text (--fs-sm) is at least 15px', () => expect(rem('--fs-sm')).toBeGreaterThanOrEqual(15 / 16));
  it('body line-height is generous (≥1.5)', () => expect(parseFloat(css.match(/--lh-body\s*:\s*([0-9.]+)/)![1]!)).toBeGreaterThanOrEqual(1.5));
});
