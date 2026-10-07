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

const DECLARATION_FILES = [
  'packages/application/src/understanding/declaration-ports.ts',
  'packages/application/src/understanding/declaration-append.service.ts',
  'packages/application/src/understanding/declaration-read.service.ts',
  'packages/infrastructure/src/database/repositories/pg-declaration.repository.ts',
  'packages/infrastructure/src/understanding/kysely-declaration-unit-of-work.ts',
  'packages/infrastructure/src/understanding/logging-declaration-event-sink.ts',
];

// Out-of-scope machinery that must never be imported by the declaration slice.
const BANNED_IMPORTS = [
  'RenderedSnapshot',
  'SnapshotPresentedEvent',
  'ClaimDefinition',
  'ExaminerRun',
  'PolishPort',
  'RecognitionEvent',
  'SnapshotReview',
  'FacetCorrection',
];

// Tokens that would signal the declaration slice bleeding into another lifecycle or forbidden scope.
const BANNED_TOKENS = ['profileRevision', 'lineage', 'deriveSnapshotStatus', 'projectRecognition', 'recognition_event', 'snapshot_review', 'snapshot_presented', 'snapshot_status'];

describe('declaration slice invariants (Commit 8 exclusions)', () => {
  const contents = new Map(DECLARATION_FILES.map((rel) => [rel, readFileSync(join(ROOT, rel), 'utf8')]));

  it('imports no rendering / presentation / recognition / review / claims / examiner / correction machinery', () => {
    const offenders: string[] = [];
    for (const [rel, src] of contents) {
      for (const line of src.split('\n')) {
        if (!line.includes('import ') && !line.includes('from ')) continue;
        for (const sym of BANNED_IMPORTS) if (line.includes(sym)) offenders.push(`${rel}: ${sym}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('does not derive status, project recognition, or touch another lifecycle table', () => {
    const offenders: string[] = [];
    for (const [rel, src] of contents) {
      const code = stripComments(src);
      for (const token of BANNED_TOKENS) if (code.includes(token)) offenders.push(`${rel}: ${token}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the founder `supersedes` pointer is recorded but never resolved (no traversal / no marking)', () => {
    const service = contents.get('packages/application/src/understanding/declaration-append.service.ts')!;
    const code = stripComments(service);
    // The service must not READ back a superseded declaration or mutate it.
    expect(code).not.toMatch(/findById|byId|markSuperseded|revoke|resolveSupersed/);
  });
});
