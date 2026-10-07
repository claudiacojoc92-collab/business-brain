#!/usr/bin/env node
// SessionStart hook: tells Claude which guardrails are live, so it asks instead of hitting walls.
import { GATES } from './rules.mjs';

const lines = Object.entries(GATES).map(([g, what]) => `  approve ${g.padEnd(16)} ${what}`);
process.stdout.write([
  '[guard] Enforced hooks are active (.claude/hooks/rules.mjs). Bypass mode does not skip them.',
  'Always blocked: printing/sourcing secrets, bare `railway domain`, force push, api restart without',
  '`bash tools/preflight-env-key.sh &&`, editing committed migrations, touching .claude/state.',
  'Blocked until the operator types the phrase in their message (valid for that turn only):',
  ...lines,
  'When blocked: stop, say exactly what you want to run and why, and ask for the phrase. Never work around a block.',
  'Orient first: git status, then the active intent/<date>-<slug>/plan.md status log.',
].join('\n'));
