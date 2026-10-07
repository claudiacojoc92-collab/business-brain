#!/usr/bin/env node
// UserPromptSubmit hook: the ONLY writer of .claude/state/approvals.json. Approvals come from the
// operator's own typed message and last until their next message (each prompt replaces the set).
//   "approve push"            opens the push gate
//   "approve deploy, commit"  opens several
//   a request to commit ("commit the changes", "approve commit") opens the whole ship flow:
//   commit + push + merge (commit → push branch → PR to main → merge). See agent-sop.md §2.6.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { GATES } from './rules.mjs';

export function parseApprovals(prompt) {
  const gates = new Set();
  const text = String(prompt || '');
  for (const m of text.matchAll(/\bapprove[ds]?\s*:?\s*((?:[a-z-]+\s*(?:,|and|&)?\s*)+)/gi)) {
    for (const word of m[1].toLowerCase().split(/[\s,&]+|\band\b/)) if (GATES[word]) gates.add(word);
  }
  // Negations and hypotheticals ("don't commit", "if I say commit ...") are not requests.
  const negated = /\b(don'?t|do\s+not|no|never|without|not\s+yet|stop|if|when|whenever)\b[^.!?\n]{0,25}\bcommit/i.test(text);
  if (!negated && /\bcommit\b/i.test(text)) gates.add('commit');
  if (gates.has('commit')) { gates.add('push'); gates.add('merge'); }
  return [...gates];
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  const gates = parseApprovals(input.prompt);
  const dir = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude', 'state');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'approvals.json'),
    JSON.stringify({ session_id: input.session_id, gates, at: new Date().toISOString() }, null, 2));
  if (gates.length) process.stdout.write(`[guard] Operator approved for this turn only: ${gates.join(', ')}.`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main();
