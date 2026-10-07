import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'packages/application/src/understanding'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('repo root not found');
}
const ROOT = repoRoot();
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const CLAIM_FILES = [
  'packages/application/src/understanding/claim-ports.ts',
  'packages/application/src/understanding/claim-append.service.ts',
  'packages/application/src/understanding/claim-read.service.ts',
  'packages/infrastructure/src/database/repositories/pg-claim.repository.ts',
  'packages/infrastructure/src/understanding/kysely-claim-unit-of-work.ts',
  'packages/infrastructure/src/understanding/logging-claim-event-sink.ts',
];

// Out-of-scope machinery that must never be imported by the claim slice.
const BANNED_IMPORTS = [
  'RenderedSnapshot',
  'SnapshotPresentedEvent',
  'RecognitionEvent',
  'SnapshotReview',
  'FounderDeclaration',
  'ExaminerRun',
  'PolishPort',
  'FacetCorrection',
];

// Evaluation vocabulary / forbidden scope that must not appear in claim CODE.
const BANNED_TOKENS = ['profileRevision', 'lineage', 'deriveSnapshotStatus', 'projectRecognition', 'examiner', 'evidence', 'confidence', 'verdict', 'ClaimKind', 'ClaimBasis', 'ClaimOrigin'];

describe('claim slice invariants (Commit 9 exclusions)', () => {
  const contents = new Map(CLAIM_FILES.map((rel) => [rel, readFileSync(join(ROOT, rel), 'utf8')]));

  it('imports no rendering / recognition / review / presentation / declaration / examiner machinery', () => {
    const offenders: string[] = [];
    for (const [rel, src] of contents) {
      for (const line of src.split('\n')) {
        if (!line.includes('import ') && !line.includes('from ')) continue;
        for (const sym of BANNED_IMPORTS) if (line.includes(sym)) offenders.push(`${rel}: ${sym}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('introduces no evaluation vocabulary or rejected classification in code', () => {
    const offenders: string[] = [];
    for (const [rel, src] of contents) {
      const code = stripComments(src);
      for (const token of BANNED_TOKENS) if (code.includes(token)) offenders.push(`${rel}: ${token}`);
    }
    expect(offenders).toEqual([]);
  });

  it('touches only claim tables (no other lifecycle table)', () => {
    const offenders: string[] = [];
    for (const [rel, src] of contents) {
      const code = stripComments(src);
      for (const banned of ['recognition_event', 'snapshot_review', 'snapshot_presented', 'founder_declaration', 'snapshot_status', 'snapshot_version']) {
        if (code.includes(banned)) offenders.push(`${rel}: ${banned}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
