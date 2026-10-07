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

const PRESENTATION_FILES = [
  'packages/application/src/understanding/presentation-ports.ts',
  'packages/application/src/understanding/presentation-append.service.ts',
  'packages/application/src/understanding/presentation-view.service.ts',
  'packages/infrastructure/src/database/repositories/pg-presented-event.repository.ts',
  'packages/infrastructure/src/understanding/kysely-presentation-unit-of-work.ts',
  'packages/infrastructure/src/understanding/logging-presentation-event-sink.ts',
];

// Out-of-scope machinery that must never be imported by the presentation slice.
const BANNED_IMPORTS = ['RenderedSnapshot', 'FounderDeclaration', 'ClaimDefinition', 'ExaminerRun', 'PolishPort', 'DeclaredContextView'];

// Tokens that would signal reintroduced/forbidden scope in presentation CODE.
const BANNED_TOKENS = ['profileRevision', 'lineage', 'supersede', 'deriveSnapshotStatus'];

describe('presentation slice invariants (Commit 7 exclusions)', () => {
  const contents = new Map(PRESENTATION_FILES.map((rel) => [rel, readFileSync(join(ROOT, rel), 'utf8')]));

  it('imports no rendering / declarations / examiner / claims / polish machinery', () => {
    const offenders: string[] = [];
    for (const [rel, src] of contents) {
      for (const line of src.split('\n')) {
        if (!line.includes('import ') && !line.includes('from ')) continue;
        for (const sym of BANNED_IMPORTS) if (line.includes(sym)) offenders.push(`${rel}: ${sym}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('introduces no supersedes / lineage / profileRevision code and does NOT re-derive status', () => {
    const offenders: string[] = [];
    for (const [rel, src] of contents) {
      const code = stripComments(src);
      for (const token of BANNED_TOKENS) if (code.includes(token)) offenders.push(`${rel}: ${token}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the presentation slice does not persist status/view and touches only presented-event rows', () => {
    const offenders: string[] = [];
    for (const [rel, src] of contents) {
      const code = stripComments(src);
      for (const banned of ['snapshot_status', 'snapshot_review', 'recognition_event', 'business_snapshot_view']) {
        if (code.includes(banned)) offenders.push(`${rel}: ${banned}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
