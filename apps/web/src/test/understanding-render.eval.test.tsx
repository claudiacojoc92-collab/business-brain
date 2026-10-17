/**
 * UNDERSTANDING EVAL — STAGE B (2026-10-17). Renders each stage-A view through the real ArcSurface with the real English
 * catalog (the UI is English; BB's text arrives in the content language), and records what the founder actually sees:
 * each card's label and text, in screen order. No model calls. Env-gated so the normal suite never touches .eval/:
 *   BB_UNDERSTANDING_RENDER=1 BB_EVAL_LABEL=baseline npx vitest run apps/web/src/test/understanding-render.eval.test.tsx
 */
import { describe, it, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'en' }) }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('../api/client', () => ({
  getArc: vi.fn(), arcAddSource: vi.fn(), arcAddLink: vi.fn(), arcAddInstagram: vi.fn(), arcAddFile: vi.fn(),
  getInstagramConnectUrl: vi.fn(), arcPourInDone: vi.fn(), arcConversation: vi.fn(),
  arcConfirmUnderstanding: vi.fn(), arcCorrectUnderstanding: vi.fn(), arcMirrorSeen: vi.fn(), arcAdoptStrategy: vi.fn(), arcRetryStrategy: vi.fn(), arcChallengeStrategy: vi.fn(),
  arcAdoptWeekDay: vi.fn(), arcGenerateEmail: vi.fn(), arcSaveEmail: vi.fn(), arcExportEmail: vi.fn(), arcContainerSeen: vi.fn(),
  getArcSources: vi.fn(), arcRemoveSource: vi.fn(),
}));

import * as api from '../api/client';
import { ArcSurface } from '../slice0/ArcSurface';

const ENABLED = process.env['BB_UNDERSTANDING_RENDER'] === '1';
const EVAL = join(__dirname, '..', '..', '..', '..', '.eval', 'understanding');

/** The founder-visible card: every card in screen order, its label and its visible text (closed details excluded). */
function readCards(root: HTMLElement): { label: string; text: string; lines: string[] }[] {
  const container = root.querySelector('.s0-u') ?? root;
  return Array.from(container.querySelectorAll<HTMLElement>('.s0-u-card, .s0-u-hero')).map((card) => {
    const clone = card.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('details:not([open]) > :not(summary)').forEach((n) => n.remove());
    const label = (clone.querySelector('.s0-u-card-label, .s0-u-hero-eyebrow')?.textContent ?? '').trim();
    clone.querySelector('.s0-u-card-label, .s0-u-hero-eyebrow')?.remove();
    // Block boundaries become line breaks, so list items and paragraphs stay separate sentences.
    clone.querySelectorAll('p, li, h3, h4, summary, .s0-u-primary').forEach((el) => el.append('\n'));
    const lines = (clone.textContent ?? '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    return { label, text: lines.join('\n'), lines };
  });
}

describe.skipIf(!ENABLED)('understanding eval — stage B (render what the founder sees)', () => {
  it('renders every stage-A view of the label', async () => {
    const label = process.env['BB_EVAL_LABEL'] ?? 'adhoc';
    const dir = join(EVAL, 'runs', label);
    if (!existsSync(dir)) throw new Error(`No stage-A runs in ${dir}`);
    const out = join(EVAL, 'rendered', label);
    mkdirSync(out, { recursive: true });
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const run = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      if (!run.view) { writeFileSync(join(out, file), JSON.stringify({ slug: run.slug, run: run.run, error: run.error ?? 'no view' })); continue; }
      vi.mocked(api.getArc).mockResolvedValue(run.view);
      const { container } = render(<ArcSurface businessId={run.businessId} onDone={vi.fn()} />);
      await waitFor(() => { if (!container.querySelector('.s0-u-card')) throw new Error('not rendered'); });
      const cards = readCards(container);
      writeFileSync(join(out, file), JSON.stringify({ slug: run.slug, run: run.run, language: run.language, recordName: run.recordName, cards }, null, 1));
      cleanup();
    }
  }, 120_000);
});
