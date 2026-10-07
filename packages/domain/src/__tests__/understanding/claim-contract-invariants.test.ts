import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

/** Freeze guards for the Claim domain contract (ADR-010). Source-scanning, so the ban survives refactors. */
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'packages/domain/src/understanding'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('repo root not found');
}
const ROOT = repoRoot();
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}
const CLAIMS_DIR = join(ROOT, 'packages/domain/src/understanding/claims');
const claimSrc = stripComments(readFileSync(join(CLAIMS_DIR, 'claim.ts'), 'utf8'));
const repoSrc = stripComments(readFileSync(join(CLAIMS_DIR, 'claim.repository.ts'), 'utf8'));
const indexSrc = stripComments(readFileSync(join(ROOT, 'packages/domain/src/understanding/index.ts'), 'utf8'));

describe('Claim domain freeze — a Claim is a proposition, never an evaluation (ADR-010)', () => {
  it('the Claim type carries no evaluative / truth / confidence field', () => {
    const banned = ['status', 'confidence', 'certainty', 'verified', 'accepted', 'rejected', 'score', 'verdict', 'truth', 'strength', 'weight'];
    const offenders = banned.filter((t) => new RegExp(`\\breadonly\\s+${t}\\b`, 'i').test(claimSrc));
    expect(offenders).toEqual([]);
  });

  it('the Claim type carries no supersession / lineage field (no resolution semantics)', () => {
    const banned = ['supersedes', 'supersede', 'replaces', 'parent', 'lineage', 'version'];
    const offenders = banned.filter((t) => new RegExp(`\\breadonly\\s+${t}\\b`, 'i').test(claimSrc));
    expect(offenders).toEqual([]);
  });

  it('the Claim type carries no Evidence / Examiner coupling', () => {
    const banned = ['evidence', 'examiner', 'audit', 'basis'];
    const offenders = banned.filter((t) => new RegExp(`\\breadonly\\s+${t}`, 'i').test(claimSrc));
    expect(offenders).toEqual([]);
  });

  it('the ClaimRepository has no mutate or evaluative-read method', () => {
    const banned = ['update', 'delete', 'remove', 'supersede', 'resolve', 'latest', 'effective', 'active', 'current', 'accepted', 'strongest', 'verified', 'supported', 'contradicted'];
    const offenders = banned.filter((t) => new RegExp(`\\b${t}\\s*\\(`, 'i').test(repoSrc));
    expect(offenders).toEqual([]);
  });

  it('rejected classifications (ClaimKind, ClaimBasis, ClaimOrigin) and deferred links are NOT exported', () => {
    // Only the review comment may mention the rejected names; the export statements must not.
    const exportLines = indexSrc.split('\n').filter((l) => l.trimStart().startsWith('export') && l.includes('claims/'));
    const exported = ['ClaimKind', 'ClaimBasis', 'ClaimOrigin', 'ClaimDeclarationLink', 'ClaimEvidenceLink'].filter((t) =>
      exportLines.some((l) => new RegExp(`\\b${t}\\b`).test(l)),
    );
    expect(exported).toEqual([]);
    // The frozen surface IS exported.
    expect(exportLines.some((l) => /\bClaim\b/.test(l) && /\bClaimObject\b/.test(l))).toBe(true);
  });

  it('the Claim type has no origin / authorship / source / provenance / derivation field', () => {
    const banned = ['origin', 'author', 'source', 'provenance', 'basis', 'derivation', 'derived', 'declaredBy'];
    const offenders = banned.filter((t) => new RegExp(`\\breadonly\\s+${t}`, 'i').test(claimSrc));
    expect(offenders).toEqual([]);
    expect(claimSrc).not.toMatch(/\bClaimOrigin\b/); // the type itself is gone
  });

  it('ClaimObject excludes null', () => {
    const body = claimSrc.match(/export type ClaimObject\s*=\s*([^;]+);/)?.[1] ?? '';
    expect(body).not.toBe('');
    expect(body).not.toMatch(/\bnull\b/);
  });
});
