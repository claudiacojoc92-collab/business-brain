#!/usr/bin/env node
/**
 * M1.5 synthesis validation harness (standalone, disposable).
 *
 *   node tools/m15-validation/run.mjs [inputPath] [outPath]
 *
 * Reasons over a labeled real-content set for ONE founder as a SINGLE business and emits
 * a synthesis-first, evidence-grounded report. Reuses the Anthropic SDK directly (same
 * construction as packages/infrastructure/src/llm/anthropic-client.ts). No DB, no registry,
 * no weekly pipeline, no route, no persistence beyond the written report file.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadInputSet } from './adapter.mjs';
import { buildSystemPrompt, buildUserMessage } from './prompt.mjs';
import { validateOutput } from './schema.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const MODEL = process.env.M15_MODEL || 'claude-sonnet-4-6';

const SUCCESS_CRITERION =
  'Success is NOT sources read, observations extracted, or smart-sounding prose. Success is ' +
  'at least ONE insight that is BOTH grounded in real evidence AND non-obvious enough to make ' +
  "the founder think 'I hadn't seen my business that way.' A surprising insight with no real " +
  'evidence chain is the worst outcome, not a partial win.';

function readApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const envPath = join(REPO_ROOT, '.env');
  if (existsSync(envPath)) {
    const line = readFileSync(envPath, 'utf8').split('\n').find((l) => l.startsWith('ANTHROPIC_API_KEY='));
    if (line) return line.slice('ANTHROPIC_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('ANTHROPIC_API_KEY not found (checked env and repo .env).');
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in model response.');
  return JSON.parse(body.slice(start, end + 1));
}

function renderReport({ inputPath, sourceNames, result }) {
  const L = [];
  L.push('# M1.5 Synthesis Validation — Report', '');
  L.push('> ' + SUCCESS_CRITERION, '');
  L.push(`- run: ${new Date().toISOString()}`);
  L.push(`- model: ${MODEL}`);
  L.push(`- input: ${inputPath}`);
  L.push(`- sources provided: ${sourceNames.join(', ')}`, '');

  L.push('## Insights (synthesis-first — the lead)', '');
  if (result.insights.length === 0) {
    L.push('_No insight survived validation. See Excluded below — this is a finding, not a pass._', '');
  }
  result.insights.forEach((ins, i) => {
    L.push(`### Insight ${i + 1}  ·  [${ins.confidenceKind}]`);
    L.push(ins.synthesis, '');
    L.push('Evidence chain:');
    ins.evidenceChain.forEach((e) => L.push(`- (${e.source}) “${e.quote}”\n  ↳ ${e.why}`));
    L.push('', 'Founder scoring:  [ grounded? Y / N ]   [ non-obvious? Y / Somewhat / N ]', '');
  });

  L.push('## Observations (grounded single-source facts)', '');
  if (result.observations.length === 0) L.push('_None._', '');
  result.observations.forEach((o) => L.push(`- (${o.source}) ${o.text}\n  ↳ “${o.quote}”`));
  if (result.observations.length) L.push('');

  L.push('## Hypotheses (i-suspect — interpretive, kept separate)', '');
  if (result.hypotheses.length === 0) L.push('_None._', '');
  result.hypotheses.forEach((h) => L.push(`- ${h.text}`));
  if (result.hypotheses.length) L.push('');

  const excluded = [
    ...result.excludedInsights.map((x) => ({ kind: 'insight', ...x })),
    ...result.excludedObservations.map((x) => ({ kind: 'observation', ...x })),
    ...result.excludedHypotheses.map((x) => ({ kind: 'hypothesis', ...x })),
  ];
  L.push('## Excluded (findings — ungrounded / fabricated provenance blocked)', '');
  if (excluded.length === 0) L.push('_None excluded._', '');
  excluded.forEach((x) => {
    const label = x.item?.synthesis || x.item?.text || JSON.stringify(x.item).slice(0, 80);
    L.push(`- [${x.kind}] ${label}\n  ↳ reason: ${x.reason}`);
  });
  L.push('');

  L.push('## Summary');
  L.push(`- insights kept: ${result.insights.length}  ·  excluded: ${result.excludedInsights.length}`);
  L.push(`- observations kept: ${result.observations.length}  ·  excluded: ${result.excludedObservations.length}`);
  L.push(`- hypotheses kept: ${result.hypotheses.length}  ·  excluded: ${result.excludedHypotheses.length}`);
  L.push('');
  L.push('Verdict is the founder\'s: at least one insight scored [grounded=Y] AND [non-obvious=Y] = success.');
  return L.join('\n');
}

async function main() {
  const inputPath = process.argv[2] ? resolve(process.argv[2]) : join(HERE, 'input.example.json');
  const outPath = process.argv[3] ? resolve(process.argv[3]) : join(HERE, 'report.md');

  const { pieces, sourceNames } = loadInputSet(inputPath);
  console.log(`[m15] ${pieces.length} source(s): ${sourceNames.join(', ')} — model ${MODEL}`);

  const client = new Anthropic({ apiKey: readApiKey() }); // mirrors createAnthropicClient()
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: buildSystemPrompt(sourceNames),
    messages: [{ role: 'user', content: buildUserMessage(pieces) }],
  });

  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const raw = extractJson(text);
  const parsedTop = { insights: raw.insights ?? [], observations: raw.observations ?? [], hypotheses: raw.hypotheses ?? [] };
  const result = validateOutput(parsedTop, sourceNames);

  const report = renderReport({ inputPath, sourceNames, result });
  writeFileSync(outPath, report + '\n', 'utf8');
  console.log(report);
  console.log(`\n[m15] report written to ${outPath}`);
}

main().catch((e) => { console.error('[m15] FAILED:', e.message); process.exit(1); });
