import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseFixture } from '../../understanding';

function repoRel(rel: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, rel);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`could not locate "${rel}" walking up from ${process.cwd()}`);
}

const FIXTURE_PATH = repoRel('fixtures/physio-movement/corpus.json');
const RAW = readFileSync(FIXTURE_PATH, 'utf8');

const ALLOWED_POST_KEYS = new Set(['externalId', 'caption', 'mediaType', 'occurredAt', 'capturedAt']);
const ALLOWED_TOP_KEYS = new Set(['businessRef', 'source', 'bio', 'posts']);

describe('physio/movement fixture', () => {
  it('parses successfully', () => {
    expect(() => parseFixture(JSON.parse(RAW))).not.toThrow();
  });

  const corpus = parseFixture(JSON.parse(RAW));
  const captions = corpus.posts.map((p) => p.caption.toLowerCase());

  it('external IDs are unique', () => {
    const ids = corpus.posts.map((p) => p.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('post count falls in the normal corpus band (> 7)', () => {
    expect(corpus.posts.length).toBeGreaterThan(7);
  });

  it('contains at least two distinct offers', () => {
    const offerPatterns: Array<[string, RegExp]> = [
      ['assessment', /\bassessment\b/],
      ['program', /\bprogram\b/],
      ['one_to_one', /\b1:1\b/],
      ['session', /\bsession(s)?\b/],
    ];
    const present = offerPatterns.filter(([, re]) => captions.some((c) => re.test(c)));
    expect(present.length).toBeGreaterThanOrEqual(2);
  });

  it('contains rehabilitation and mobility/stretching signals', () => {
    expect(captions.some((c) => /rehab|rehabilitation|recover|injury/.test(c))).toBe(true);
    expect(captions.some((c) => /mobility|stretch|range of motion/.test(c))).toBe(true);
  });

  it('contains one or two intentionally ambiguous yoga-like signals', () => {
    const yogaLike = captions.filter((c) => /yoga|flow/.test(c));
    expect(yogaLike.length).toBeGreaterThanOrEqual(1);
    expect(yogaLike.length).toBeLessThanOrEqual(2);
  });

  it('mentions physiotherapy and a bio identifying physiotherapy', () => {
    expect(captions.some((c) => /physiotherapy|physio/.test(c))).toBe(true);
    expect((corpus.bio ?? '').toLowerCase()).toMatch(/physiotherapy|physio/);
  });

  it('contains no customer-reception or performance evidence (fields)', () => {
    const parsed = JSON.parse(RAW) as { posts: Array<Record<string, unknown>> } & Record<string, unknown>;
    expect(Object.keys(parsed).every((k) => ALLOWED_TOP_KEYS.has(k))).toBe(true);
    for (const post of parsed.posts) {
      expect(Object.keys(post).every((k) => ALLOWED_POST_KEYS.has(k))).toBe(true);
    }
  });

  it('parses deterministically (stable under repeated parsing)', () => {
    const a = parseFixture(JSON.parse(RAW));
    const b = parseFixture(JSON.parse(RAW));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
