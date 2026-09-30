#!/usr/bin/env node
// PreToolUse hook: enforces .claude/hooks/rules.mjs. Deny = exit 0 with a JSON "deny" decision
// (the only decision that blocks in bypass mode). No output = the tool call proceeds.
import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { RULES, GATES } from './rules.mjs';

export const projectDir = () => process.env.CLAUDE_PROJECT_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const stateDir = () => path.join(projectDir(), '.claude', 'state');

// ── Builtin checks (logic a single regex can't express) ────────────────────────────────────
const CHECKS = {
  // cat/head/grep/... of .env, *.pem, or the key backup. `grep -q` / `grep -c` presence checks are fine.
  secretRead(cmd) {
    const target = /(\.env(?!\.example|\.sample|\.template)\b|\.pem\b|\.config\/business-brain)/;
    return cmd.split(/&&|\|\||;|\|/).some((seg) => {
      const s = seg.trim();
      if (!target.test(s)) return false;
      if (/^(\[|test\b|ls\b|stat\b|git\s+(check-ignore|ls-files|status)|grep\s+(-\w*[qcl]\w*\s+|--quiet\b|--count\b))/.test(s)) return false;
      return /^(cat|head|tail|less|more|bat|strings|xxd|od|hexdump|grep|rg|awk|sed|cut|sort|uniq|diff|cp|base64|python3?|node|openssl|jq|nl|tac)\b/.test(s)
        || /(^|\s)<\s*\S*\.env\b/.test(s);
    });
  },
  // rm -r / rm with a glob / find -delete, where any target is outside the scratchpad or /tmp scratch.
  rmOutsideScratch(cmd, input) {
    const scratch = [input.scratchpad_dir, '/private/tmp/claude-', '/tmp/claude-'].filter(Boolean);
    const segs = cmd.split(/&&|\|\||;|\|/).map((s) => s.trim());
    return segs.some((s) => {
      let targets = [];
      const rm = s.match(/^(sudo\s+)?rm\s+(.*)$/);
      if (rm) {
        const args = rm[2].split(/\s+/).filter(Boolean);
        const flags = args.filter((a) => a.startsWith('-')).join('');
        targets = args.filter((a) => !a.startsWith('-'));
        if (!/[rR]/.test(flags) && !targets.some((t) => /[*?]/.test(t))) return false;
      } else if (/^find\s/.test(s) && /(\s-delete\b|-exec\s+rm\b)/.test(s)) {
        targets = [s.split(/\s+/)[1]];
      } else return false;
      return targets.length === 0 || targets.some((t) => !scratch.some((p) => t.replace(/^["']/, '').startsWith(p)));
    });
  },
  // Editing a migration that git already tracks (i.e. committed, possibly applied).
  trackedMigration(_cmd, _input, rel) {
    if (!/^database\/migrations\/V\d+__[^/]+\.sql$/.test(rel || '')) return false;
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', rel], { cwd: projectDir(), stdio: 'ignore' });
      return true;
    } catch { return false; }
  },
};

export function readApprovals(sessionId) {
  try {
    const a = JSON.parse(readFileSync(path.join(stateDir(), 'approvals.json'), 'utf8'));
    return a.session_id === sessionId ? new Set(a.gates) : new Set();
  } catch { return new Set(); }
}

function targetsOf(input) {
  const t = input.tool_input || {};
  if (input.tool_name === 'Bash') return { cmd: t.command || '', rel: null };
  const p = t.file_path || t.notebook_path || t.path || '';
  if (!p) return { cmd: '', rel: '' };
  const abs = path.resolve(input.cwd || projectDir(), p);
  const rel = path.relative(projectDir(), abs);
  return { cmd: '', rel: rel.startsWith('..') ? abs : rel };
}

// Pure decision function (exported for tests). Returns null (allow) or { rule, decision, message }.
export function decide(input, approvals = new Set()) {
  const { cmd, rel } = targetsOf(input);
  const subject = input.tool_name === 'Bash' ? cmd : rel;
  for (const rule of RULES) {
    if (!rule.tools.includes(input.tool_name)) continue;
    const hit = rule.check ? CHECKS[rule.check](cmd, input, rel) : rule.match.test(subject);
    if (!hit || (rule.unless && rule.unless.test(subject))) continue;
    if (rule.action === 'gate') {
      const isSubagent = Boolean(input.agent_id);
      const subagentBlocked = isSubagent && (rule.gate === 'push' || rule.gate === 'commit' || rule.gate === 'rules');
      if (approvals.has(rule.gate) && !subagentBlocked) return { rule, decision: 'approved' };
      const how = subagentBlocked
        ? 'Sub-agents never commit, push, or edit hook rules. Report back to the main session instead.'
        : `Blocked until the operator types "approve ${rule.gate}" in their next message (${GATES[rule.gate]}). Stop, explain exactly what you want to run and why, and ask.`;
      return { rule, decision: 'deny', message: `[${rule.id}] ${rule.reason} ${how}` };
    }
    return { rule, decision: 'deny', message: `[${rule.id}] ${rule.reason} This rule has no approval path; tell the operator if you believe it is wrong.` };
  }
  return null;
}

function log(input, result) {
  try {
    mkdirSync(stateDir(), { recursive: true });
    const { cmd, rel } = targetsOf(input);
    appendFileSync(path.join(stateDir(), 'hook-log.jsonl'), JSON.stringify({
      at: new Date().toISOString(), session: input.session_id, agent: input.agent_id || null,
      tool: input.tool_name, rule: result.rule.id, decision: result.decision,
      subject: (cmd || rel || '').slice(0, 300),
    }) + '\n');
  } catch { /* logging must never break a tool call */ }
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  const result = decide(input, readApprovals(input.session_id));
  if (!result) return;
  log(input, result);
  if (result.decision === 'deny') {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: {
      hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: result.message,
    } }));
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  main().catch(() => {
    // Fail closed: if the guard itself crashes, block rather than silently allow.
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse',
      permissionDecision: 'deny', permissionDecisionReason: 'guard.mjs crashed; blocked for safety. Run node --test .claude/hooks/' } }));
  });
}
