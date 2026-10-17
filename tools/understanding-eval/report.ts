/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * UNDERSTANDING EVAL — REPORT (2026-10-17). Scores the rendered cards of one label (and the stored pre-regression
 * output, "old") with the rubric, and writes .eval/understanding/reports/<label>.md: the summary table, the cross-business
 * repeats, then per business the OLD text and every run's card text, with the operator's column left blank.
 * Also refreshes tools/understanding-eval/manifest.json (fixture hashes; committed, the fixtures are not).
 *   npx vite-node tools/understanding-eval/report.ts baseline
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { businessEntities } from '../../packages/application/src/bi/understanding-governance';
import { BUSINESSES } from './businesses';
import { crossBusinessRepeats, meetsBar, score, type Rendered, type Scored } from './rubric';

const ROOT = join(__dirname, '..', '..');
const EVAL = join(ROOT, '.eval', 'understanding');
const label = process.argv[2] ?? 'baseline';

const fixture = (slug: string): any => JSON.parse(readFileSync(join(EVAL, 'fixtures', `${slug}.json`), 'utf8'));
const sourceTextOf = (fx: any): string => fx.fragments.map((f: any) => (typeof f.payload?.text === 'string' ? f.payload.text : '')).join('\n');

/** The stored pre-regression understanding as the card of its era showed it: constraint, stage, tensions, questions. */
function oldRendered(slug: string, language: string): { rendered: Rendered; constraint: any; entities: string[] } {
  const o = JSON.parse(readFileSync(join(EVAL, 'old', `${slug}.json`), 'utf8'));
  const u = o.understanding;
  const cards: { label: string; lines: string[] }[] = [];
  if (u.constraint?.decided && u.constraint.statement) cards.push({ label: 'Your real constraint', lines: [u.constraint.statement, ...(u.constraint.why ? [u.constraint.why] : [])] });
  if (u.stage?.stage) cards.push({ label: 'Stage', lines: [`Stage: ${u.stage.stage}.`, ...(u.stage.evidence ?? [])] });
  if (u.capabilityCheck?.insight) cards.push({ label: 'Capability', lines: [u.capabilityCheck.insight, ...(u.capabilityCheck.soWhat ? [u.capabilityCheck.soWhat] : [])] });
  cards.push({ label: u.constraint?.decided ? 'Also on my mind' : 'What stood out', lines: (u.contradictions ?? []).map((c: any) => [c.tension, c.soWhat].filter(Boolean).join(' ')) });
  cards.push({ label: 'What I need to know next', lines: (u.unknowns ?? []).map(String) });
  cards.push({ label: 'Offer', lines: [u.offer?.summary ?? '', u.positioning?.summary ?? ''].filter(Boolean) });
  return {
    rendered: { slug, run: 0, language, recordName: o.recordName, cards },
    constraint: u.constraint?.decided ? { decided: true, text: u.constraint.statement } : { decided: false },
    entities: businessEntities(u),
  };
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

function main(): void {
  // Manifest: what each fixture was, so a run is reproducible and a changed input is visible.
  const manifest = BUSINESSES.map((b) => {
    const fx = fixture(b.slug);
    const ids = fx.fragments.map((f: any) => f.id).sort();
    return { slug: b.slug, businessId: b.businessId, recordName: fx.recordName, contentLanguage: fx.contentLanguage, exportedAt: fx.exportedAt,
      fragments: ids.length, fragmentIdsSha256: sha(ids.join('\n')), contentSha256: sha(JSON.stringify(fx.fragments.map((f: any) => [f.id, f.payload?.text ?? '']).sort())) };
  });
  writeFileSync(join(__dirname, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const dir = join(EVAL, 'rendered', label);
  const runsDir = join(EVAL, 'runs', label);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  const rows: { b: (typeof BUSINESSES)[number]; s: Scored; text: string }[] = [];
  const rendered: Rendered[] = [];
  const errors: string[] = [];
  for (const f of files) {
    const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const run = JSON.parse(readFileSync(join(runsDir, f), 'utf8'));
    const b = BUSINESSES.find((x) => x.slug === r.slug)!;
    if (r.error || !run.view) { errors.push(`${r.slug} r${r.run}: ${r.error ?? run.error}`); continue; }
    const fx = fixture(b.slug);
    const c = run.view.understanding?.constraint;
    const s = score(r, { constraint: c?.decided ? { decided: true, text: c.text } : { decided: false }, entities: businessEntities(run.snapshot.understanding), sourceText: sourceTextOf(fx) });
    rendered.push(r);
    rows.push({ b, s, text: r.cards.map((k: any) => `**${k.label}**\n${k.lines.map((l: string) => `- ${l}`).join('\n')}`).join('\n\n') });
  }

  const yes = (x: boolean): string => (x ? 'yes' : '**no**');
  const fmt = (s: Scored): string => `| ${s.slug} | ${s.run || 'old'} | ${yes(s.constraintShown)} | ${s.constraintShown ? (s.constraintRestatesTension ? '**restates**' : 'no') : '—'} | ${s.tensionCount} (${s.tensionsConcrete} concrete) | ${yes(s.stageShown)} | ${s.housekeeping.length || '0'} | ${s.behaviour.length || '0'} | ${s.wrongLanguage.length || '0'} | ${s.recordNameMisused ? '**yes**' : 'no'} | ${s.repeatsWithin.length || '0'} | ${meetsBar(s) ? 'PASS' : 'fail'} |  |`;
  const head = '| Business | Run | Constraint shown | Restates a tension | Tensions | Stage shown | Housekeeping | Behaviour | Wrong language | Record name misused | Repeats within | Bar | Would she send it to a paying client? |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|';

  const out: string[] = [`# Understanding eval — ${label}`, '', `Generated ${new Date().toISOString()}. Deterministic columns from tools/understanding-eval/rubric.ts; the last column is the operator's: would she send this card to a paying client.`, ''];
  out.push('## Summary', '', head);
  const olds: Record<string, { s: Scored; text: string }> = {};
  for (const b of BUSINESSES) {
    const o = oldRendered(b.slug, b.language);
    const s = score(o.rendered, { constraint: o.constraint, entities: o.entities, sourceText: sourceTextOf(fixture(b.slug)) });
    olds[b.slug] = { s, text: o.rendered.cards.map((k) => `**${k.label}**\n${k.lines.map((l) => `- ${l}`).join('\n')}`).join('\n\n') };
    out.push(fmt(s));
    for (const r of rows.filter((x) => x.b.slug === b.slug).sort((x, y) => x.s.run - y.s.run)) out.push(fmt(r.s));
  }
  if (errors.length) out.push('', '**Failed runs:**', ...errors.map((e) => `- ${e}`));

  const repeats = crossBusinessRepeats(rendered);
  out.push('', '## Sentences on the cards of more than one business', '');
  out.push(...(repeats.length ? repeats.map((x) => `- (${x.businesses.join(', ')}) ${x.sentence}`) : ['None.']));

  for (const b of BUSINESSES) {
    out.push('', `## ${b.slug} — ${b.kind} (${b.language})`, '', `### Old (${b.oldEra}, stored snapshot ${b.oldSnapshotId})`, '', olds[b.slug]!.text);
    for (const r of rows.filter((x) => x.b.slug === b.slug).sort((x, y) => x.s.run - y.s.run)) {
      out.push('', `### ${label} — run ${r.s.run}`, '', r.text);
      const flags = [...r.s.housekeeping.map((x) => `housekeeping: ${x}`), ...r.s.behaviour.map((x) => `behaviour: ${x}`), ...r.s.wrongLanguage.map((x) => `language: ${x}`), ...r.s.repeatsWithin.map((x) => `repeated: ${x}`)];
      if (flags.length) out.push('', '_Flags:_', ...flags.map((x) => `- ${x}`));
    }
  }
  mkdirSync(join(EVAL, 'reports'), { recursive: true });
  const path = join(EVAL, 'reports', `${label}.md`);
  writeFileSync(path, `${out.join('\n')}\n`);
  console.log(`wrote ${path}: ${rows.length} runs, ${errors.length} failed, ${repeats.length} cross-business repeats`);
}

main();
