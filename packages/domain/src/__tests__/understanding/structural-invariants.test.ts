import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type {
  SnapshotStatement,
  BusinessSnapshotVersion,
  RecognitionResponse,
} from '../../understanding';

/* ── Compile-time structural invariants (enforced by `tsc --noEmit`, erased at runtime) ── */
type Assert<T extends true> = T;
type LacksKey<K extends string, T> = K extends keyof T ? false : true;

// If any assertion is false, `Assert<false>` fails type-checking.
export type StructuralInvariants = [
  Assert<LacksKey<'rendered', SnapshotStatement>>,
  Assert<LacksKey<'renderVersion', SnapshotStatement>>,
  Assert<LacksKey<'recognition', SnapshotStatement>>,
  Assert<LacksKey<'review', SnapshotStatement>>,
  Assert<LacksKey<'status', SnapshotStatement>>,
  Assert<LacksKey<'review', BusinessSnapshotVersion>>,
  Assert<LacksKey<'latestReview', BusinessSnapshotVersion>>,
  Assert<LacksKey<'status', BusinessSnapshotVersion>>,
  Assert<LacksKey<'statementRecognitions', BusinessSnapshotVersion>>,
  // RecognitionEvent response can never be 'unconfirmed'
  Assert<'unconfirmed' extends RecognitionResponse ? false : true>,
];

/* ── Runtime source-scan invariants ── */
function repoRel(rel: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, rel);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`could not locate "${rel}" walking up from ${process.cwd()}`);
}

const UNDERSTANDING_DIR = repoRel('packages/domain/src/understanding');

function allTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allTsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('structural invariants (source scan)', () => {
  const files = allTsFiles(UNDERSTANDING_DIR);

  it('the retired identifier "profileRevision" appears nowhere in the Understanding code', () => {
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('profileRevision'));
    expect(offenders).toEqual([]);
  });

  it('domain understanding imports neither infrastructure nor presentation', () => {
    const banned = [
      '@bb/infrastructure',
      '@bb/application',
      '@bb/api',
      'fastify',
      'kysely',
      'react',
    ];
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const b of banned) {
        if (src.includes(`'${b}'`) || src.includes(`"${b}"`)) offenders.push(`${f} -> ${b}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every business-owned repository method accepts businessRef', () => {
    // Ports that touch business-owned state. RenderedSnapshotRepository is intentionally excluded:
    // it is keyed by the content-hash statementVersionId (globally unique), not business-owned state.
    const portFiles = [
      'ingestion/raw-capture.ts',
      'observations/observation.repository.ts',
      'facets/facet.repository.ts',
      'declarations/declaration.repository.ts',
      'revisions/revision.repository.ts',
      'snapshot/snapshot.repository.ts',
      'snapshot/recognition-event.ts',
    ];
    const offenders: string[] = [];
    for (const rel of portFiles) {
      const src = readFileSync(join(UNDERSTANDING_DIR, rel), 'utf8').replace(/\s+/g, ' ');
      const methodRe = /(\w+)\s*\(([^)]*)\)\s*:\s*Promise/g;
      let m: RegExpExecArray | null;
      while ((m = methodRe.exec(src)) !== null) {
        const name = m[1] ?? '';
        const params = m[2] ?? '';
        if (!params.includes('businessRef')) offenders.push(`${rel}:${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('found and scanned the understanding source tree', () => {
    expect(files.length).toBeGreaterThan(10);
  });
});
