/* eslint-disable no-console -- the labeled-set numbers ARE the Phase-1 gate proof (§14) */
import { describe, it, expect } from 'vitest';
import { classifyUnits, overlapFraction, REDUNDANCY_THRESHOLD } from '../../../connectors/upload/classify';
import type { ExtractedUnit } from '../../../connectors/upload/types';
import { WEBSITE_TEXT } from './fixtures';

const unit = (text: string): ExtractedUnit => ({ text, anchor: { kind: 'document', label: 'x' }, blocks: [] });

// LABELED SET — connected reality already held = the website (WEBSITE_TEXT).
// Positives: content retyped FROM the website (the reconstruction vector we must catch).
const RETYPED = WEBSITE_TEXT.map(unit); // verbatim copies of the website
// Negatives: genuine documents the founder possesses — must NOT be false-flagged.
const GENUINE = [
  'Our Q3 roadmap prioritizes the mobile application and a new onboarding flow for enterprise accounts.',
  'The leadership team believes our real differentiation is speed of implementation, not headline price.',
  'Internal note: churn rose in the SMB segment last quarter; we suspect activation friction in week one.',
  // theme-echo: mentions calm/organized/projects but shares NO verbatim 5-word run with the site
  'We help teams stay calm and organized while managing their own projects together.',
].map(unit);

describe('redundancy classification — labeled-set proof (§14 gate)', () => {
  it('catches retyped-website content and does NOT false-flag genuine documents', () => {
    const onRetyped = classifyUnits(RETYPED, WEBSITE_TEXT);
    const onGenuine = classifyUnits(GENUINE, WEBSITE_TEXT);

    const caught = onRetyped.filter((c) => c.provenanceType === 'redundant').length;
    const falseFlags = onGenuine.filter((c) => c.provenanceType === 'redundant').length;

    console.log(`\n  REDUNDANCY PROOF (threshold=${REDUNDANCY_THRESHOLD}):`);
    console.log(`    retyped-website caught:   ${caught}/${RETYPED.length}`);
    console.log(`    genuine false-flagged:    ${falseFlags}/${GENUINE.length}`);
    console.log(`    retyped overlaps: ${onRetyped.map((c) => c.overlap.toFixed(2)).join(', ')}`);
    console.log(`    genuine overlaps: ${onGenuine.map((c) => c.overlap.toFixed(2)).join(', ')}`);

    expect(caught).toBe(RETYPED.length);   // 100% of retyped caught
    expect(falseFlags).toBe(0);            // 0% genuine false-flagged
  });

  it('a partly-redundant document keeps its genuinely-new units (§11)', () => {
    const mixed = [unit(WEBSITE_TEXT[0]!), GENUINE[0]!]; // one retyped page + one genuine page
    const out = classifyUnits(mixed, WEBSITE_TEXT);
    expect(out[0]!.provenanceType).toBe('redundant');
    expect(out[1]!.provenanceType).toBe('observed-artifact'); // new content still lands
  });

  it('overlap is exact word-sequence (not fuzzy): near-paraphrase is not redundant', () => {
    // reworded, not retyped — no 5-word verbatim run → low overlap → genuine
    const paraphrase = unit('The calm and tidy method for running projects and talking to your clients across the whole company.');
    const [c] = classifyUnits([paraphrase], WEBSITE_TEXT);
    expect(c!.provenanceType).toBe('observed-artifact');
    expect(c!.overlap).toBeLessThan(REDUNDANCY_THRESHOLD);
  });

  it('overlapFraction is 1.0 for a verbatim copy and ~0 for unrelated text', () => {
    const reality = WEBSITE_TEXT.join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    expect(overlapFraction(WEBSITE_TEXT[0]!, reality)).toBe(1);
    expect(overlapFraction('completely unrelated sentence about astrophysics and telescopes', reality)).toBe(0);
  });
});
