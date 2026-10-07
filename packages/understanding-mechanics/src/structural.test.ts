import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { MoveOutcome, OfferExistence, OfferEvaluationResult } from './model';

/* ── Compile-time structural invariants (enforced by `tsc`, erased at runtime) ── */
type Assert<T extends true> = T;

export type StructuralInvariants = [
  // `moved` / `eligible_for_review` are unrepresentable in the public Move union.
  Assert<'moved' extends MoveOutcome ? false : true>,
  Assert<'eligible_for_review' extends MoveOutcome ? false : true>,
  // OfferExistence known:true can ONLY carry value:false (present offer unrepresentable in R1).
  Assert<Extract<OfferExistence, { known: true }>['value'] extends false ? true : false>,
  // No diagnosis / current-truth placeholder keys on the R1 result.
  Assert<'latestDiagnosisVersionRef' extends keyof OfferEvaluationResult ? false : true>,
  Assert<'currentUnderstanding' extends keyof OfferEvaluationResult ? false : true>,
  Assert<'currentTruth' extends keyof OfferEvaluationResult ? false : true>,
];

/* ── Runtime source-scan: the package imports nothing outside its allowed surface ── */
function repoRel(rel: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, rel);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`could not locate "${rel}" walking up from ${process.cwd()}`);
}

const SRC_DIR = repoRel('packages/understanding-mechanics/src');

function allTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allTsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('understanding-mechanics — structural isolation', () => {
  // Scan the shippable domain source only. Test files legitimately import vitest and
  // (in this very file) enumerate the banned tokens as string literals to search for.
  const files = allTsFiles(SRC_DIR).filter((f) => !f.endsWith('.test.ts'));

  it('imports no application/infrastructure/domain/app/HTTP/DB/LLM/UI module', () => {
    const banned = [
      '@bb/application',
      '@bb/domain',
      '@bb/infrastructure',
      '@bb/api',
      'apps/',
      'fastify',
      'kysely',
      'pg',
      'react',
      'ioredis',
      'bullmq',
      '@anthropic-ai/sdk',
      'anthropic',
      'openai',
    ];
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const b of banned) {
        if (src.includes(`'${b}`) || src.includes(`"${b}`)) offenders.push(`${f} -> ${b}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('declares zero runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(dirname(SRC_DIR), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});
