import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ id: 'b1', actionId: 'a1' }), useNavigate: () => navigate }));

vi.mock('../api/client', () => {
  class ApiError extends Error { constructor(public status: number, public code: string, message: string) { super(message); this.name = 'ApiError'; } }
  return { ApiError, getLandingDraft: vi.fn(), acceptLandingDraft: vi.fn(), rewriteLandingSection: vi.fn(), editLandingSection: vi.fn() };
});

import * as api from '../api/client';
import { LandingMovePage } from '../slice0/LandingMovePage';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('LandingMovePage — draft-primary, legible blocked state, fail-closed rewrite', () => {
  it('no_adopted_strategy renders plain language + the unblock action (never a blank screen)', async () => {
    vi.mocked(api.getLandingDraft).mockResolvedValue({ status: 'blocked', reason: 'no_adopted_strategy', message: 'ignored', unblock: 'adopt_strategy' } as never);
    render(<LandingMovePage />);
    await screen.findByText('landing.blocked.noStrategy.body');
    const action = screen.getByText('landing.blocked.noStrategy.action');
    fireEvent.click(action);
    expect(navigate).toHaveBeenCalledWith('/b/b1/strategy');
  });

  it('a drafted move shows the sections as readable copy + an Accept control', async () => {
    vi.mocked(api.getLandingDraft).mockResolvedValue({ status: 'drafted', version: 1, sections: [{ role: 'what', heading: 'Ce', body: 'Oferim ședințe.' }, { role: 'proof', heading: 'Echipa', body: 'Florin Laza.' }], cta: 'Programează.' } as never);
    render(<LandingMovePage />);
    expect(await screen.findByText('Oferim ședințe.')).toBeTruthy();
    expect(screen.getByText('Florin Laza.')).toBeTruthy();
    expect(screen.getByText('Programează.')).toBeTruthy();
    expect(screen.getByText('landing.accept')).toBeTruthy();
  });

  it('provenance is honest per section: anchored names the source; a founder edit says "your text", never sourced', async () => {
    vi.mocked(api.getLandingDraft).mockResolvedValue({
      status: 'edited', version: 2, cta: 'Programează.', ctaFacts: [],
      sections: [
        { role: 'what', heading: 'Ce', body: 'Oferim kinetoterapie.', facts: [{ source: 'anchored', text: 'Kinetoterapie', sourceUrl: 'https://www.bodymovestudio.ro/servicii' }] },
        { role: 'who', heading: 'Cine', body: 'Textul meu.', facts: [{ source: 'founder', text: null, sourceUrl: null }] },
      ],
    } as never);
    render(<LandingMovePage />);
    await screen.findByText('Oferim kinetoterapie.');
    // Two provenance toggles (one per section). Expand the anchored one → fact + host; expand the founder one → "your text".
    const toggles = screen.getAllByText('landing.prov.toggle');
    expect(toggles).toHaveLength(2);
    fireEvent.click(toggles[0]);
    expect(await screen.findByText('“Kinetoterapie”')).toBeTruthy();
    expect(screen.getByText(/www\.bodymovestudio\.ro/)).toBeTruthy();
    fireEvent.click(toggles[1]);
    expect(await screen.findByText('landing.prov.founder')).toBeTruthy();
  });

  it('a rewrite that cannot pass the gate shows WHY and leaves the previous text intact', async () => {
    vi.mocked(api.getLandingDraft).mockResolvedValue({ status: 'drafted', version: 1, sections: [{ role: 'proof', heading: 'Echipa', body: 'Florin Laza.', facts: [{ source: 'synthesized', text: null, sourceUrl: null }] }], cta: 'Programează.', ctaFacts: [] } as never);
    vi.mocked(api.rewriteLandingSection).mockRejectedValue(new (api.ApiError as unknown as new (s: number, c: string, m: string) => Error)(422, 'REWRITE_BLOCKED', 'could not pass the safety gate'));
    render(<LandingMovePage />);
    await screen.findByText('Florin Laza.');
    fireEvent.click(screen.getByText('landing.rewrite'));
    await waitFor(() => expect(screen.getByText('could not pass the safety gate')).toBeTruthy());
    expect(screen.getByText('Florin Laza.')).toBeTruthy(); // previous text intact
  });
});
