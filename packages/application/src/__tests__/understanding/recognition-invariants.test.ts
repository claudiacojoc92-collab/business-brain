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

const RECOGNITION_FILES = [
  'packages/domain/src/understanding/snapshot/recognition-projection.ts',
  'packages/application/src/understanding/recognition-ports.ts',
  'packages/application/src/understanding/recognition-append.service.ts',
  'packages/application/src/understanding/snapshot-view.service.ts',
  'packages/infrastructure/src/database/repositories/pg-recognition-event.repository.ts',
  'packages/infrastructure/src/understanding/kysely-recognition-unit-of-work.ts',
  'packages/infrastructure/src/understanding/logging-recognition-event-sink.ts',
];

// Out-of-scope machinery that must never be imported by the recognition/view slice.
const BANNED_IMPORTS = [
  'RenderedSnapshot',
  'SnapshotPresentedEvent',
  'ClaimDefinition',
  'ExaminerRun',
  'FounderDeclaration',
  'DeclaredContextView',
  'PolishPort',
];

// Fields the binding amendment forbids the carry-forward projection from loading or comparing.
const FORBIDDEN_IN_PROJECTION = [
  'confidence',
  'scope',
  'corpusRevision',
  'corpusSize',
  'understandingContextRevision',
  'generationProfileVersion',
  'observationIds',
  'supersedes',
];

describe('recognition slice invariants (Commit 5 exclusions)', () => {
  const contents = new Map(RECOGNITION_FILES.map((rel) => [rel, readFileSync(join(ROOT, rel), 'utf8')]));

  it('imports no rendering / presented-event / Claims / examiner / declaration machinery', () => {
    const offenders: string[] = [];
    for (const [rel, src] of contents) {
      for (const line of src.split('\n')) {
        if (!line.includes('import ') && !line.includes('from ')) continue;
        for (const sym of BANNED_IMPORTS) if (line.includes(sym)) offenders.push(`${rel}: ${sym}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the projection compares no prior-version confidence / scope / corpus / context / provenance', () => {
    const src = contents.get('packages/domain/src/understanding/snapshot/recognition-projection.ts')!;
    const code = stripComments(src); // the ban is on CODE, not on prose describing what is forbidden
    const offenders = FORBIDDEN_IN_PROJECTION.filter((token) => code.includes(token));
    expect(offenders).toEqual([]);
  });

  it('the recognition slice never writes reviews, declarations, or presented events', () => {
    const offenders: string[] = [];
    for (const [rel, src] of contents) {
      // A recognition append writes ONLY recognition_event / recognition_seq rows.
      for (const banned of ['snapshot_presented', 'founder_declaration', 'insertInto(\'understanding.snapshot_version']) {
        if (src.includes(banned)) offenders.push(`${rel}: ${banned}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
