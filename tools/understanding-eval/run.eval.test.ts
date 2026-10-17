/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * UNDERSTANDING EVAL — STAGE A (2026-10-17). Runs the PRODUCTION understanding chain on the seven fixture businesses:
 * the real `LearnBusinessService.bridgePourIn` (fragments → observations → synthesis → governance) and the real
 * `ArcService.view` at the understanding moment (theses + founder projection), with in-memory stores instead of the
 * database. Only the model calls are real. Writes one JSON per business and run to .eval/understanding/runs/<label>/.
 *
 * Env-gated: it makes paid model calls, so it is skipped unless BB_UNDERSTANDING_EVAL=1. Fixtures are client material
 * and live in the git-ignored .eval/understanding/fixtures/ (export: tools/understanding-eval/README.md).
 *   BB_UNDERSTANDING_EVAL=1 BB_EVAL_LABEL=baseline BB_EVAL_RUNS=3 npx vitest run tools/understanding-eval/run.eval.test.ts
 * Optional: BB_EVAL_ONLY=bodymove,qufi limits the businesses.
 */
import { describe, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LearnBusinessService } from '../../packages/application/src/bi/learn-business.use-case';
import { ArcService } from '../../packages/application/src/arc/arc.service';
import { AnthropicUnderstandingModel } from '../../packages/infrastructure/src/business-intelligence/anthropic-understanding.model';
import { AnthropicThesisModel } from '../../packages/infrastructure/src/business-intelligence/anthropic-theses.model';
import { BUSINESSES } from './businesses';

const ROOT = join(__dirname, '..', '..');
const EVAL = join(ROOT, '.eval', 'understanding');
const ENABLED = process.env['BB_UNDERSTANDING_EVAL'] === '1';

/** The API key from the operator's .env, read as data (never printed, never shell-sourced). */
function apiKey(): string {
  if (process.env['ANTHROPIC_API_KEY']) return process.env['ANTHROPIC_API_KEY'];
  const candidates = [join(ROOT, '.env'), '/Users/claudiacojoc/Desktop/business_brain/.env'];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const m = readFileSync(p, 'utf8').match(/^ANTHROPIC_API_KEY=(.*)$/m);
    if (m) return m[1]!.trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

async function runOne(slug: string, run: number, label: string, key: string): Promise<void> {
  const fx = JSON.parse(readFileSync(join(EVAL, 'fixtures', `${slug}.json`), 'utf8'));
  const businessId: string = fx.businessId;
  const fragments: any[] = fx.fragments.map((f: any) => ({ ...f, capturedAt: f.capturedAt }));
  let language: string | null = fx.contentLanguage ?? null;
  let saved: any = null;
  let aha: any = null;
  const started = Date.now();

  const learn = new LearnBusinessService({
    contentLanguage: {
      get: async () => language,
      setIfUnset: async (_id: string, l: string) => { if (!language) language = l; },
    } as any,
    evidenceRepo: { findByFounder: async () => fragments } as any,
    links: { listFragmentIds: async () => fragments.map((f) => f.id) } as any,
    model: new AnthropicUnderstandingModel(key),
    understanding: { save: async (s: any) => { saved = s; return s; } } as any,
    aha: { save: async (a: any) => { aha = a; return a; } } as any,
    ingestion: {} as any, discovery: {} as any, profiles: {} as any, website: {} as any,
    rawCaptures: {} as any, observations: {} as any, revisions: {} as any,
    clock: { now: () => new Date() } as any,
  });
  const result = await learn.bridgePourIn({ businessId, founderId: 'eval', businessName: fx.recordName, interfaceLanguage: 'en' });
  const synthMs = Date.now() - started;
  if (!saved) {
    writeOut(label, slug, run, { slug, run, error: `no snapshot (${result.state})`, synthMs });
    return;
  }

  const arc = new ArcService({
    understanding: { latest: async () => ({ id: saved.id, understanding: saved.understanding, sourceLanguage: saved.sourceLanguage }) },
    aha1: { latest: async () => (aha ? { findings: aha.findings } : null) },
    conversation: {
      status: async () => null, turns: async () => [], hasGoal: async () => false, goalCandidate: async () => null,
      awaitingGoal: async () => false, coverage: async () => [],
    },
    mirror: { build: async () => { throw new Error('not used at the understanding moment'); } },
    strategy: { getCurrent: async () => null, proposalOrGenerate: async () => { throw new Error('not used'); } },
    plan: { getActive: async () => null, proposalOrGenerate: async () => null },
    theses: new AnthropicThesisModel(key),
  } as any);
  const flags = { pourInDone: true, understandingConfirmed: false, mirrorSeen: false, emailExported: false, containerSeen: false } as any;
  const view: any = await arc.view(businessId, fx.recordName, language ?? 'en', flags, [], null);
  const theses = view.internal?.theses ?? null;
  delete view.internal;
  writeOut(label, slug, run, {
    slug, run, label, businessId, recordName: fx.recordName, language, synthMs, totalMs: Date.now() - started,
    snapshot: { id: saved.id, understanding: saved.understanding, sourceLanguage: saved.sourceLanguage },
    theses, view,
  });
}

function writeOut(label: string, slug: string, run: number, data: unknown): void {
  const dir = join(EVAL, 'runs', label);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${slug}-r${run}.json`), JSON.stringify(data, null, 1));
}

describe.skipIf(!ENABLED)('understanding eval — stage A (paid model calls)', () => {
  it('runs the production chain on every fixture business', async () => {
    const key = apiKey();
    if (!key) throw new Error('No ANTHROPIC_API_KEY available');
    const label = process.env['BB_EVAL_LABEL'] ?? 'adhoc';
    const runs = Number(process.env['BB_EVAL_RUNS'] ?? '3');
    const only = (process.env['BB_EVAL_ONLY'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    // Resumable: a run that already wrote a view is kept (BB_EVAL_FRESH=1 redoes everything).
    const done = (slug: string, run: number): boolean => {
      const p = join(EVAL, 'runs', label, `${slug}-r${run}.json`);
      return process.env['BB_EVAL_FRESH'] !== '1' && existsSync(p) && Boolean(JSON.parse(readFileSync(p, 'utf8')).view);
    };
    const jobs = BUSINESSES.filter((b) => !only.length || only.includes(b.slug))
      .flatMap((b) => Array.from({ length: runs }, (_, i) => ({ slug: b.slug, run: i + 1 })))
      .filter((j) => !done(j.slug, j.run));
    // At most four at a time: seven in parallel slowed every run 2-3x and timed requests out (measured 2026-10-17).
    const queue = [...jobs];
    const errors: string[] = [];
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (let j = queue.shift(); j; j = queue.shift()) {
        try { await runOne(j.slug, j.run, label, key); }
        catch (e) { errors.push(`${j.slug} r${j.run}: ${e instanceof Error ? e.message : String(e)}`); writeOut(label, j.slug, j.run, { slug: j.slug, run: j.run, error: String(e) }); }
      }
    }));
    if (errors.length) throw new Error(`Some runs failed:\n${errors.join('\n')}`);
  }, 60 * 60_000);
});
