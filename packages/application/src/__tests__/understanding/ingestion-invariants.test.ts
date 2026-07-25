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

// Ingestion (Commit 2) must not pull in any later-slice concern.
const INGESTION_FILES = [
  'packages/application/src/understanding/ports.ts',
  'packages/application/src/understanding/fixture-ingestion.service.ts',
  'packages/application/src/understanding/index.ts',
  'packages/infrastructure/src/understanding/kysely-ingestion-unit-of-work.ts',
  'packages/infrastructure/src/understanding/shared-clock-adapter.ts',
  'packages/infrastructure/src/understanding/logging-ingestion-event-sink.ts',
  'packages/infrastructure/src/database/repositories/pg-raw-capture.repository.ts',
  'packages/infrastructure/src/database/repositories/pg-observation.repository.ts',
  'packages/infrastructure/src/database/repositories/pg-understanding-revision.repository.ts',
  'packages/infrastructure/src/database/repositories/pg-ingestion-idempotency.repository.ts',
];

// Symbols specific enough that they never appear incidentally in ingestion code.
const BANNED_SYMBOLS = [
  'SnapshotStatement',
  'BusinessSnapshot',
  'RenderedSnapshot',
  'SnapshotReview',
  'RecognitionEvent',
  'RecognitionState',
  'EffectiveFacetResolver',
  'FacetRepository',
  'ClaimDefinition',
  'Bearing',
];

describe('ingestion import boundary (Commit 2 exclusions)', () => {
  it('imports no Snapshot / Audit / recognition / rendering / facet-extraction logic', () => {
    const offenders: string[] = [];
    for (const rel of INGESTION_FILES) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      const importLines = src.split('\n').filter((l) => l.includes('import ') || l.includes('from '));
      for (const line of importLines) {
        for (const sym of BANNED_SYMBOLS) {
          if (line.includes(sym)) offenders.push(`${rel}: ${sym}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
