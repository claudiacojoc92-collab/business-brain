#!/usr/bin/env node
/**
 * M1.5 Business Model validation harness (standalone, disposable).
 *
 *   node tools/m15-validation/run.mjs [inputPath] [outPath]
 *
 * Reasons over a labeled real-content set for ONE founder as a SINGLE business and emits
 * the frozen Business Model artifact (registers + relational insights), synthesis-first and
 * evidence-grounded. Reuses the Anthropic SDK directly (same construction as
 * packages/infrastructure/src/llm/anthropic-client.ts). No DB/registry, no weekly pipeline,
 * no route/UI/persistence beyond the written report file.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadInputSet } from './adapter.mjs';
import { buildSystemPrompt, buildUserMessage } from './prompt.mjs';
import { validateModel, DECLARED_PATTERN, SINGLE_FIELDS, ARRAY_FIELDS, INSIGHT_FIELDS } from './schema.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const MODEL = process.env.M15_MODEL || 'claude-sonnet-4-6';

const SUCCESS_CRITERION =
  'Success is NOT registers filled or smart-sounding prose. Success is at least ONE relational ' +
  "insight that is BOTH grounded in real evidence AND non-obvious enough to make the founder think " +
  "'I hadn't seen my business that way.' Recognition alone is not success; a surprising insight with " +
  'no real evidence chain is the worst outcome, not a partial win.';

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

const REGISTERS = [
  { title: '1. CLAIM — what the business says it is', fields: ['claimedPositioning', 'claimedOffer', 'founderClaimedIdentity'] },
  { title: '2. BELIEF — what the founder actually believes (declared only)', fields: ['coreBeliefs'] },
  { title: '3. BEHAVIOR — what the founder repeatedly does', fields: ['observedPositioning', 'recurringThemes'] },
  { title: '4. MARKET RESPONSE — what the market reflects back', fields: ['audiencePerception', 'whatMarketRewards', 'audienceLanguage'] },
];
const INSIGHT_TITLES = {
  contradictions: 'Contradictions', blindSpots: 'Blind spots', hiddenStrengths: 'Hidden strengths',
  hiddenWeaknesses: 'Hidden weaknesses', positioningOpportunities: 'Positioning opportunities',
};
const SCORING = 'Founder scoring:  [ accurate? Y/N ]  [ grounded? Y/N ]  [ non-obvious? Y/Somewhat/N ]  [ told-me-something-I-hadn\'t-articulated? Y/N ]';

function fieldBlock(f) {
  const refs = f.evidenceRefs.map((r) => `    · (${r.source}) “${r.fragment}”`).join('\n');
  return `${f.value}   [${f.confidenceKind}]\n${refs}`;
}

function renderReport({ inputPath, sourceNames, declaredNames, model, excluded }) {
  const L = [];
  L.push('# M1.5 Business Model — Validation Report', '');
  L.push('> ' + SUCCESS_CRITERION, '');
  L.push(`- run: ${new Date().toISOString()}`);
  L.push(`- model: ${MODEL}`);
  L.push(`- input: ${inputPath}`);
  L.push(`- sources provided: ${sourceNames.join(', ')}`);
  L.push(`- declared/spoken sources: ${declaredNames.length ? declaredNames.join(', ') : '(none — belief register will be empty)'}`);
  L.push(`- model confidence: ${model.modelConfidence}`, '');

  L.push('## Registers (observed)', '');
  for (const reg of REGISTERS) {
    L.push(`### ${reg.title}`);
    for (const key of reg.fields) {
      if (ARRAY_FIELDS.includes(key)) {
        const arr = model[key] || [];
        if (arr.length === 0) { L.push(`- ${key}: unpopulated — no supporting source.`); continue; }
        arr.forEach((f) => L.push(`- ${key}: ${fieldBlock(f)}`));
      } else {
        L.push(model[key] ? `- ${key}: ${fieldBlock(model[key])}` : `- ${key}: unpopulated — no supporting source.`);
      }
    }
    L.push('');
  }

  L.push('## Relational insights (the product — synthesis-first)', '');
  let anyInsight = false;
  for (const key of INSIGHT_FIELDS) {
    const arr = model[key] || [];
    if (arr.length === 0) continue;
    L.push(`### ${INSIGHT_TITLES[key]}`);
    arr.forEach((ins) => {
      anyInsight = true;
      L.push(`- ${ins.statement}`);
      L.push(`  connects: ${ins.contributingFields.join(' × ')}`);
      ins.evidenceChain.forEach((r) => L.push(`  · (${r.source}) “${r.fragment}”`));
      L.push('  ' + SCORING, '');
    });
  }
  if (!anyInsight) L.push('_No relational insight survived validation — see Excluded. This is a finding, not a pass._', '');

  L.push('## Market context (prior knowledge — NOT about this founder)', '');
  if ((model.marketContext || []).length === 0) L.push('_None._', '');
  (model.marketContext || []).forEach((c) => L.push(`- [${c.contextKind}] ${c.statement}`));
  L.push('');

  L.push('## Excluded (findings — ungrounded / fabricated provenance blocked)', '');
  if (excluded.length === 0) L.push('_None excluded._', '');
  excluded.forEach((x) => L.push(`- [${x.kind}] ${x.label}\n  ↳ reason: ${x.reason}`));
  L.push('');

  const nSingle = SINGLE_FIELDS.filter((k) => model[k]).length;
  const nArray = ARRAY_FIELDS.reduce((n, k) => n + (model[k]?.length || 0), 0);
  const nInsights = INSIGHT_FIELDS.reduce((n, k) => n + (model[k]?.length || 0), 0);
  L.push('## Summary');
  L.push(`- register fields populated: ${nSingle + nArray} (single ${nSingle}, list-items ${nArray})`);
  L.push(`- relational insights kept: ${nInsights}`);
  L.push(`- market-context items: ${model.marketContext?.length || 0}`);
  L.push(`- excluded (findings): ${excluded.length}`);
  L.push('');
  L.push("Verdict is the founder's: at least one insight scored [grounded=Y] AND [non-obvious=Y] = success.");
  return L.join('\n');
}

async function main() {
  const inputPath = process.argv[2] ? resolve(process.argv[2]) : join(HERE, 'input.example.json');
  const outPath = process.argv[3] ? resolve(process.argv[3]) : join(HERE, 'report.md');

  const { pieces, sourceNames } = loadInputSet(inputPath);
  const declaredNames = sourceNames.filter((s) => DECLARED_PATTERN.test(s));
  console.log(`[m15] ${pieces.length} source(s): ${sourceNames.join(', ')} — declared: ${declaredNames.join(', ') || 'none'} — model ${MODEL}`);

  const client = new Anthropic({ apiKey: readApiKey() }); // mirrors createAnthropicClient()
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 6000,
    system: buildSystemPrompt(sourceNames, declaredNames),
    messages: [{ role: 'user', content: buildUserMessage(pieces) }],
  });

  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const raw = extractJson(text);
  const { model, excluded } = validateModel(raw, sourceNames);

  const report = renderReport({ inputPath, sourceNames, declaredNames, model, excluded });
  writeFileSync(outPath, report + '\n', 'utf8');
  console.log(report);
  console.log(`\n[m15] report written to ${outPath}`);
}

main().catch((e) => { console.error('[m15] FAILED:', e.message); process.exit(1); });
