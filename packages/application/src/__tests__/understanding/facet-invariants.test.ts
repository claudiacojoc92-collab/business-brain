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

const FACET_FILES = [
  'packages/domain/src/understanding/facets/rules.ts',
  'packages/domain/src/understanding/facets/extract.ts',
  'packages/domain/src/understanding/facets/effective.ts',
  'packages/application/src/understanding/facet-ports.ts',
  'packages/application/src/understanding/facet-extraction.service.ts',
  'packages/application/src/understanding/effective-facet-resolver.ts',
  'packages/infrastructure/src/database/repositories/pg-facet.repository.ts',
  'packages/infrastructure/src/database/repositories/pg-facet-correction.repository.ts',
  'packages/infrastructure/src/database/repositories/pg-facet-extraction-run.repository.ts',
  'packages/infrastructure/src/understanding/kysely-facet-extraction-unit-of-work.ts',
  'packages/infrastructure/src/understanding/logging-facet-extraction-event-sink.ts',
];

// Symbols specific enough that they never appear incidentally in facet code.
const BANNED = [
  'SnapshotStatement',
  'BusinessSnapshot',
  'RenderedSnapshot',
  'SnapshotReview',
  'RecognitionEvent',
  'RecognitionState',
  'ClaimDefinition',
  'FounderDeclaration',
  'DeclaredContext',
  'ExaminerRun',
];

describe('facet extraction invariants (Commit 3 exclusions)', () => {
  const contents = new Map(FACET_FILES.map((rel) => [rel, readFileSync(join(ROOT, rel), 'utf8')]));

  it('imports no Snapshot / Audit / Claim / recognition / rendering / declaration logic', () => {
    const offenders: string[] = [];
    for (const [rel, src] of contents) {
      for (const line of src.split('\n')) {
        if (!line.includes('import ') && !line.includes('from ')) continue;
        for (const sym of BANNED) if (line.includes(sym)) offenders.push(`${rel}: ${sym}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the retired identifier "profileRevision" appears nowhere in facet code', () => {
    const offenders = [...contents.entries()].filter(([, src]) => src.includes('profileRevision')).map(([rel]) => rel);
    expect(offenders).toEqual([]);
  });

  it('effective resolution is a projection (no mutation of stored base facets)', () => {
    // The resolver reads (listRaw/listByCorpus/listActive) and composes; it never writes facets.
    const resolver = contents.get('packages/application/src/understanding/effective-facet-resolver.ts') ?? '';
    expect(resolver.includes('appendResults')).toBe(false);
    expect(resolver.includes('.append(')).toBe(false);
  });
});
