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

const SNAPSHOT_FILES = [
  'packages/domain/src/understanding/snapshot/generation.ts',
  'packages/application/src/understanding/snapshot-ports.ts',
  'packages/application/src/understanding/snapshot-generation.service.ts',
  'packages/infrastructure/src/database/repositories/pg-snapshot.repository.ts',
  'packages/infrastructure/src/understanding/kysely-snapshot-unit-of-work.ts',
  'packages/infrastructure/src/understanding/logging-snapshot-generation-event-sink.ts',
];

// Symbols specific enough that they never appear incidentally in snapshot-generation code.
const BANNED = [
  'RenderedSnapshot',
  'SnapshotReview',
  'RecognitionEvent',
  'RecognitionState',
  'BusinessSnapshotView',
  'ClaimDefinition',
  'ExaminerRun',
  'FounderDeclaration',
];

describe('snapshot generation invariants (Commit 4 exclusions)', () => {
  const contents = new Map(SNAPSHOT_FILES.map((rel) => [rel, readFileSync(join(ROOT, rel), 'utf8')]));

  it('imports no rendering / review / recognition / status-view / Claims / declarations logic', () => {
    const offenders: string[] = [];
    for (const [rel, src] of contents) {
      for (const line of src.split('\n')) {
        if (!line.includes('import ') && !line.includes('from ')) continue;
        for (const sym of BANNED) if (line.includes(sym)) offenders.push(`${rel}: ${sym}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the retired identifier "profileRevision" appears nowhere in snapshot code', () => {
    const offenders = [...contents.entries()].filter(([, src]) => src.includes('profileRevision')).map(([rel]) => rel);
    expect(offenders).toEqual([]);
  });
});
