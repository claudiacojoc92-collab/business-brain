import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * THE HARD WALL. V081 reach-report data is reflective-only: it must NEVER become a licensed proposition and
 * must NEVER reach any asset generator (carousel / reel / voice). A comment is not a wall. This test fails
 * LOUDLY if a future change opens either back door — the one the operator named: "in six weeks someone wires
 * this in without noticing and an attribution gets laundered into a published carousel as a performance claim."
 *
 * Two independent guards:
 *  1. TYPE WALL — `PropositionSource` (the only `source` a licensed proposition may carry) must never gain a
 *     reach/attribution member. Reach data literally cannot be TYPED as licensed without tripping this.
 *  2. COMPOSITION WALL — in composition-root, the entire asset-authority region (where `licensedPropositions`
 *     is assembled and every asset service is constructed) sits ABOVE the `WALL-END:asset-authority` marker.
 *     The reach store is wired only BELOW it. So no asset-authority code may even reference `reach`.
 */

// Resolve sibling source files relative to THIS test file. __dirname is provided by the test runner (CJS build
// + Vitest), avoiding import.meta (which the application package's CommonJS target forbids).
const read = (rel: string): string => readFileSync(path.resolve(__dirname, rel), 'utf8');

describe('V081 reach_report — HARD WALL against the asset-authority back door', () => {
  it('TYPE WALL: PropositionSource has no reach / attribution member', () => {
    const src = read('../voice/contracts.ts');
    const m = src.match(/export type PropositionSource\s*=([^;]+);/);
    if (!m) throw new Error('PropositionSource declaration not found — the wall anchor moved; fix this test deliberately');
    const decl = (m[1] ?? '').toLowerCase();
    for (const forbidden of ['reach', 'attribution', 'walk', 'referr', 'heard', 'how_they_found']) {
      expect(
        decl.includes(forbidden),
        `PropositionSource gained a '${forbidden}'-like member. Founder-reported attribution is REFLECTIVE-ONLY and may never be a licensed proposition. Remove it.`,
      ).toBe(false);
    }
  });

  it('COMPOSITION WALL: nothing in the asset-authority region references reach', () => {
    const src = read('../../../composition/src/composition-root.ts');
    const startMarker = '// WALL-START:asset-authority';
    const endMarker = '// WALL-END:asset-authority';
    const start = src.indexOf(startMarker);
    const end = src.indexOf(endMarker);
    expect(
      start,
      'The `// WALL-START:asset-authority` marker is missing from composition-root.ts. It opens the asset-authority region where reach must never appear. Do NOT remove it.',
    ).toBeGreaterThan(-1);
    expect(
      end,
      'The `// WALL-END:asset-authority` marker is missing from composition-root.ts. It closes the asset-authority region; reach is wired only below it. Do NOT remove it.',
    ).toBeGreaterThan(start);
    // The region BETWEEN the markers (the marker lines themselves excluded) is every licensedPropositions
    // assembly and every publishing asset-service construction. Reach data may not be referenced here.
    const region = src.slice(start + startMarker.length, end);
    expect(
      /reach/i.test(region),
      'reach_report data was referenced inside the asset-authority region of composition-root.ts (licensedPropositions / carousel / reel / voice). It is REFLECTIVE-ONLY. If you are reading this because the test failed, you just tried to let a founder-reported attribution become a publishable claim — the exact back door the claim-safety kernel exists to prevent. Wire reach only below the WALL-END marker.',
    ).toBe(false);
  });
});
