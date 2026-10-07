import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ArcView } from '../api/client';

// Arc CHROME is UI, so it is English for every founder (operator rule 2026-10-07); the content BB wrote stays in the
// business's language. Uses the REAL translate() (not mocked) so we see the actual chrome.
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

describe('arc chrome is English UI; the content stays in the business language (rule 2026-10-07)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('a Romanian business: English labels and buttons, Romanian content untouched', async () => {
    vi.mocked(api.getArc).mockResolvedValue(strat);
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText(/what I think you should do/i)).toBeInTheDocument();   // English chrome
    expect(screen.queryByText(/Iată ce cred că ar trebui să faci/)).toBeNull();            // no Romanian chrome
    expect(screen.queryByText(/Da, îmi place/i)).toBeNull();
    expect(screen.getByText(/canalul de recomandări/)).toBeInTheDocument();                  // content as BB wrote it
  });

  it('no content language yet: still English', async () => {
    vi.mocked(api.getArc).mockResolvedValue({ ...strat, contentLanguage: null });
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText(/what I think you should do/i)).toBeInTheDocument();
  });
});
