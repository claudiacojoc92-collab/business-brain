import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ArcView } from '../api/client';

// Arc CHROME follows the CONTENT language (view.contentLanguage), NOT the UI locale. Here the UI locale is 'en'
// but the business content is Romanian — the section labels/buttons must render in Romanian. Uses the REAL
// translate() (not mocked) so we see actual localized chrome.
vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'en' }) }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('../api/client', () => ({
  getArc: vi.fn(), arcAddSource: vi.fn(), arcAddLink: vi.fn(), arcAddInstagram: vi.fn(), arcAddFile: vi.fn(),
  getInstagramConnectUrl: vi.fn(), arcPourInDone: vi.fn(), arcConversation: vi.fn(),
  arcConfirmUnderstanding: vi.fn(), arcCorrectUnderstanding: vi.fn(), arcMirrorSeen: vi.fn(), arcAdoptStrategy: vi.fn(), arcChallengeStrategy: vi.fn(),
  arcAdoptWeekDay: vi.fn(), arcGenerateEmail: vi.fn(), arcSaveEmail: vi.fn(), arcExportEmail: vi.fn(), arcContainerSeen: vi.fn(),
}));

import * as api from '../api/client';
import { ArcSurface } from '../slice0/ArcSurface';

const strat: ArcView = {
  moment: 'strategy', businessName: 'Body Move', contentLanguage: 'ro',
  strategy: { bet: 'canalul de recomandări', over: 'o campanie generală', horizon: '6 luni', tradeOffs: [], notNow: [], reconsider: [], proposalId: 'v1', adoptable: true },
} as ArcView;

describe('arc chrome follows the CONTENT language, not the UI locale', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders Romanian chrome for a Romanian business even when the UI locale is English', async () => {
    vi.mocked(api.getArc).mockResolvedValue(strat);
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    // the bet line uses the RO template "Pariul: … — în locul …", not the EN "The bet: …"
    expect(await screen.findByText(/Pariul:/)).toBeInTheDocument();
    expect(screen.queryByText(/The bet:/)).toBeNull();
    // the adopt button is Romanian
    expect(screen.getByText(/Adoptă/i)).toBeInTheDocument();
  });

  it('falls back to the UI locale (en) when there is no content language yet', async () => {
    vi.mocked(api.getArc).mockResolvedValue({ ...strat, contentLanguage: null });
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText(/The bet:/)).toBeInTheDocument();
  });
});
