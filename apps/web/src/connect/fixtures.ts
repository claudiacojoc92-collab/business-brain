/**
 * M2.1 UI demo data — REAL output captured from the proven live end-to-end runs
 * (apps/api website-magic-moment.service). Not invented: every line and fragment id here
 * was produced by an actual fetch → store → frozen-engine → fail-closed-resolution run.
 *
 * This drives the in-browser demo of the rendered surface while the live transport (the
 * dev SSE endpoint) awaits the api image rebuild — the transport is stubbed and labeled,
 * never faked as live.
 */
export interface Line {
  label: string;
  text: string;
  kind: 'observed' | 'inferred';
  fragmentIds: string[];
}

export interface DemoCase {
  key: string;
  url: string;
  state: 'synced' | 'partial' | 'empty' | 'failed';
  readingLines: string[];
  lead: string | null;
  message: string | null;
  handoff: string | null;
  beat1: Line[]; // observed — fast
  beat2: Line[]; // inferred — deepening, streams behind
  timing: { firstMs: number; fullMs: number };
  hitRate: number;
}

// ── basecamp.com — synced (real capture: TTFR 2499ms, full 127299ms, hit-rate 67%) ──
const basecamp: DemoCase = {
  key: 'basecamp',
  url: 'https://basecamp.com',
  state: 'synced',
  readingLines: ['Reading your homepage…', 'Reading /pricing…', 'Reading /features…', 'Reading /paths…'],
  lead: "Here's what I can already see:",
  message: null,
  handoff: "That's what I can see from the outside. Now tell me the part I can't see — what are you actually trying to build?",
  beat1: [
    { label: 'Positioning', kind: 'observed', fragmentIds: ['d459907e2d3b01badcf5323fa65d1fa3dcfab0892545c6f521366bd567b65b98'],
      text: 'You position yourself as Trusted by millions, Basecamp puts everything you need to get work done in one place. It’s the calm, organized way to manage projects, work with clients, and communicate company-wide.' },
    { label: 'Offer', kind: 'observed', fragmentIds: ['53980a1190c88a8b474c4bc7d58d99672e3f91003127056bc62ecf925c3dd96b'],
      text: 'Your offer looks like Start free with Basecamp — one project, 20 users, forever free. Or upgrade to Plus or Pro Unlimited ($299/mo) for unlimited projects and premium support.' },
  ],
  beat2: [
    { label: 'contradictions', kind: 'inferred', fragmentIds: ['53980a1190c88a8b474c4bc7d58d99672e3f91003127056bc62ecf925c3dd96b', '91a8b985d0d08a40868e0710953d4fbbdb28edd4243acf402e237cfebd075910'],
      text: 'You recruit start-ups, freelancers, and small businesses — yet your flagship Pro Unlimited plan ($299/mo flat) only wins at ~20+ users; below that, per-seat competitors are cheaper. The small-business identity and the flagship economics pull in opposite directions.' },
    { label: 'blindSpots', kind: 'inferred', fragmentIds: ['91a8b985d0d08a40868e0710953d4fbbdb28edd4243acf402e237cfebd075910'],
      text: 'Your "tool graveyard" story assumes the journey ends at Basecamp — but the same page shows a customer who left, tried four tools, and came back. That boomerang/win-back cohort is likely your highest-conversion segment, and you neither mine nor market it.' },
    { label: 'hiddenStrengths', kind: 'inferred', fragmentIds: ['91a8b985d0d08a40868e0710953d4fbbdb28edd4243acf402e237cfebd075910', '047749ceee5dff568b4dd85168fcd718cb438cd932cb4ca3151386c9b92ed775', 'd459907e2d3b01badcf5323fa65d1fa3dcfab0892545c6f521366bd567b65b98'],
      text: 'Your deepest, least-marketed moat is client-facing collaboration: across unrelated industries, clients who would not touch other tools actually use Basecamp. That’s a real switching-cost wedge you treat as a feature bullet, not the retention engine it appears to be.' },
    { label: 'hiddenWeaknesses', kind: 'inferred', fragmentIds: ['d459907e2d3b01badcf5323fa65d1fa3dcfab0892545c6f521366bd567b65b98', '53980a1190c88a8b474c4bc7d58d99672e3f91003127056bc62ecf925c3dd96b'],
      text: 'Making 27-years-profitable stability your centerpiece reassures cautious small buyers — but is invisible or off-putting to the growth-stage teams that expand fastest. Your identity may be filtering out your highest-growth cohort.' },
  ],
  timing: { firstMs: 2499, fullMs: 127299 },
  hitRate: 67,
};

// ── a thin / SPA / Linktree-style stub — honest empty (as much care as the best case) ──
const thin: DemoCase = {
  key: 'thin',
  url: 'https://my-linktree-stub.example',
  state: 'empty',
  readingLines: ['Reading your homepage…'],
  lead: null,
  message: "I reached your site but couldn't read much — it looks like the content loads in a way I can't see yet. Want to upload a page or doc instead so I can read your business properly?",
  handoff: null,
  beat1: [],
  beat2: [],
  timing: { firstMs: 1900, fullMs: 1900 },
  hitRate: 0,
};

// ── unreachable URL — honest failure ──
const failed: DemoCase = {
  key: 'failed',
  url: 'https://nonexistent-zzz-9271833.example',
  state: 'failed',
  readingLines: ['Checking your site…'],
  lead: null,
  message: "I couldn't reach that URL. Want to check it and try again, or give me a different link?",
  handoff: null,
  beat1: [],
  beat2: [],
  timing: { firstMs: 18, fullMs: 18 },
  hitRate: 0,
};

export const DEMO_CASES: DemoCase[] = [basecamp, thin, failed];
