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

/** Strip block + line comments so bans apply to executable code, not prose describing what is forbidden. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const REVIEW_FILES = [
  'packages/application/src/understanding/review-ports.ts',
  'packages/application/src/understanding/review-append.service.ts',
  'packages/infrastructure/src/database/repositories/pg-review.repository.ts',
  'packages/infrastructure/src/understanding/kysely-review-unit-of-work.ts',
  'packages/infrastructure/src/understanding/logging-review-event-sink.ts',
];

// Out-of-scope machinery that must never be imported by the review slice.
const BANNED_IMPORTS = [
  'RenderedSnapshot',
  'SnapshotPresentedEvent',
  'FounderDeclaration',
  'ClaimDefinition',
  'ExaminerRun',
  'PolishPort',
  'DeclaredContextView',
];

// Tokens that would signal reintroduced/forbidden scope in review CODE.
const BANNED_TOKENS = ['profileRevision', 'lineage', 'supersede'];

describe('review slice invariants (Commit 6 exclusions)', () => {
  const contents = new Map(REVIEW_FILES.map((rel) => [rel, readFileSync(join(ROOT, rel), 'utf8')]));

  it('imports no rendering / presentation / declarations / examiner / claims machinery', () => {
    const offenders: string[] = [];
    for (const [rel, src] of contents) {
      for (const line of src.split('\n')) {
        if (!line.includes('import ') && !line.includes('from ')) continue;
        for (const sym of BANNED_IMPORTS) if (line.includes(sym)) offenders.push(`${rel}: ${sym}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('introduces no supersedes / lineage / profileRevision code', () => {
    const offenders: string[] = [];
    for (const [rel, src] of contents) {
      const code = stripComments(src);
      for (const token of BANNED_TOKENS) if (code.includes(token)) offenders.push(`${rel}: ${token}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the review slice does not persist SnapshotStatus and does not change recognition projection', () => {
    const offenders: string[] = [];
    for (const [rel, src] of contents) {
      const code = stripComments(src);
      // Reviews write ONLY snapshot_review / review_seq rows; status is derived, never stored.
      for (const banned of ['snapshot_status', 'projectRecognition', 'recognition_event']) {
        if (code.includes(banned)) offenders.push(`${rel}: ${banned}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
