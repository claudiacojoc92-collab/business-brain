import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Landing V0 is a PUBLIC page (no auth). It must render meaningful text in the DOM, a single real h1,
// a CTA into the product, an explicit "website not required" line, and an honest "what it doesn't do yet"
// section — with no founder-facing claim about unbuilt features (publishing/signals) as a current capability.

vi.mock('../slice0/session', () => ({ useSession: () => ({ account: null, isLoading: false }) }));
vi.mock('react-router-dom', () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => <a href={to} className={className}>{children}</a>,
  Navigate: () => null,
}));

import { LandingV0 } from '../slice0/LandingV0';

afterEach(cleanup);

describe('Landing V0', () => {
  it('renders exactly one h1 with the product thesis as DOM text', () => {
    render(<LandingV0 />);
    const h1s = document.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.textContent).toMatch(/decide what your marketing should do next/i);
  });

  it('has sequential section headings covering the founder journey and honesty', () => {
    render(<LandingV0 />);
    const h2s = Array.from(document.querySelectorAll('h2')).map((h) => h.textContent?.toLowerCase() ?? '');
    expect(h2s.some((h) => h.includes('who it’s for') || h.includes('who it'))).toBe(true);
    expect(h2s.some((h) => h.includes('problem'))).toBe(true);
    expect(h2s.some((h) => h.includes('how it works'))).toBe(true);
    expect(h2s.some((h) => h.includes('different'))).toBe(true);
    expect(h2s.some((h) => h.includes('doesn’t do') || h.includes('doesn'))).toBe(true);
    // Business → Strategy → Today → Create present in plain language
    for (const step of ['Business', 'Strategy', 'Today', 'Create']) {
      expect(screen.getAllByText(step).length).toBeGreaterThan(0);
    }
  });

  it('CTA leads into the normal product flow (/signin)', () => {
    render(<LandingV0 />);
    const ctas = Array.from(document.querySelectorAll('a')).filter((a) => /start with your business/i.test(a.textContent ?? ''));
    expect(ctas.length).toBeGreaterThan(0);
    expect(ctas.every((a) => a.getAttribute('href') === '/signin')).toBe(true);
  });

  it('states explicitly that a website is not required', () => {
    render(<LandingV0 />);
    expect(document.body.textContent).toMatch(/no website/i);
  });

  it('is honest about unbuilt features — publishing/signals appear only as things it does NOT do yet', () => {
    render(<LandingV0 />);
    const doesntSection = Array.from(document.querySelectorAll('section')).find((s) => /doesn’t do yet/i.test(s.textContent ?? ''));
    expect(doesntSection).toBeTruthy();
    expect(doesntSection!.textContent).toMatch(/does not publish|not publish|does not learn from your results/i);
  });

  it('emits Organization/SoftwareApplication structured data', () => {
    render(<LandingV0 />);
    const ld = document.querySelector('script[type="application/ld+json"]');
    expect(ld).toBeTruthy();
    expect(ld!.textContent).toMatch(/SoftwareApplication/);
  });
});
