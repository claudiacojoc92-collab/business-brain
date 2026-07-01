/**
 * M2.1 LIVE end-to-end runner (opt-in). Real fetch + real LLM + real dev DB.
 * Excluded from normal CI (guarded by M21_LIVE). Run:
 *   M21_LIVE=1 npx vitest run apps/api/src/__tests__/__integration__/website-magic-moment.live.test.ts
 */
/* eslint-disable no-console -- diagnostic opt-in runner: the console output IS the report */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { runWebsiteMagicMoment } from '../../business-model/website-magic-moment.service';

function fromEnvFile(key: string): string {
  if (process.env[key]) return process.env[key] as string;
  const env = readFileSync(join(process.cwd(), '.env'), 'utf8');
  const line = env.split('\n').find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} not found`);
  return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
}

const FOUNDER = 'M21_LIVE_DEMO';
const URLS = [
  'https://basecamp.com',
  'https://www.paulgraham.com',
  'https://nonexistent-zzz-9271833.example',
];

describe.runIf(process.env.M21_LIVE === '1')('M2.1 live end-to-end', () => {
  it('runs the slice against real URLs and reports deliverables', async () => {
    const db = createKyselyClient(fromEnvFile('DATABASE_URL'));
    const repo = new PgEvidenceRepository(db);
    const apiKey = fromEnvFile('ANTHROPIC_API_KEY');
    const totals: number[] = [];

    for (const url of URLS) {
      await repo.deleteBySource(FOUNDER, 'website');
      await repo.deleteBySource(FOUNDER, 'business-model');

      const progress: string[] = [];
      const r = await runWebsiteMagicMoment({
        founderId: FOUNDER, url, repo, anthropicApiKey: apiKey,
        onProgress: (e) => progress.push(e.message),
      });

      console.log(`\n===== ${url} =====`);
      console.log(`state=${r.state}  pagesRead=${r.pagesRead}  fragmentsStored=${r.fragmentsStored}  gaps=${r.gaps.length}`);
      console.log(`TIME-TO-FIRST-REFLECTION=${r.timing.timeToFirstReflectionMs}ms (budget 30000ms)  |  full-synthesis=${r.timing.fullSynthesisMs}ms (fetch=${r.timing.fetchMs} recompute=${r.timing.recomputeMs})`);
      console.log(`resolution: insights=${r.resolution.insightsTotal} resolved=${r.resolution.resolved} rejected=${r.resolution.rejected} hitRate=${(r.resolution.hitRate * 100).toFixed(0)}%`);
      console.log(`enginePages: ${r.diagnostics.enginePages.join(' | ')}`);
      if (r.diagnostics.rejectedSample.length) console.log(`REJECTED refs:\n  - ${r.diagnostics.rejectedSample.join('\n  - ')}`);
      console.log(`reading progress: ${progress.slice(0, 6).join(' | ')}`);
      if (r.observedReflection.message) console.log(`message: ${r.observedReflection.message}`);
      if (r.observedReflection.lead) console.log(`\nBEAT 1 (observed, ${r.timing.timeToFirstReflectionMs}ms): ${r.observedReflection.lead}`);
      for (const line of r.observedReflection.lines) {
        console.log(`  • [${line.kind}] ${line.text}`);
        console.log(`      ↳ evidence: ${line.fragmentIds.join(', ')}`);
      }
      if (r.inferredLines.length) console.log(`\nBEAT 2 (inferred, streams behind at ${r.timing.fullSynthesisMs}ms):`);
      for (const line of r.inferredLines) {
        console.log(`  • [${line.kind}] ${line.text}`);
        console.log(`      ↳ evidence: ${line.fragmentIds.join(', ')}`);
      }
      if (r.observedReflection.handoff) console.log(`\n${r.observedReflection.handoff}`);
      if (r.state === 'synced' || r.state === 'partial') totals.push(r.timing.timeToFirstReflectionMs);

      await repo.deleteBySource(FOUNDER, 'website');
      await repo.deleteBySource(FOUNDER, 'business-model');
    }

    if (totals.length) {
      const sorted = [...totals].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
      console.log(`\n===== TIME-TO-FIRST-REFLECTION (Beat 1, successful reads, n=${totals.length}) =====`);
      console.log(`p50=${p50}ms  p95=${p95}ms  vs budget=30000ms`);
    }
    await db.destroy();
  }, 300_000);
});
