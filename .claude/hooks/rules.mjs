// Enforced rules for Claude Code in this repo. Source of truth for CLAUDE.md "Hard rules" and
// docs/operations/agent-sop.md "Safety protocols". ADD RULES HERE as the SOP grows, then add a case to
// guard.test.mjs and run: node --test .claude/hooks/
//
// Rule shape:
//   id      unique kebab id (shown to Claude and written to .claude/state/hook-log.jsonl)
//   tools   tool names the rule applies to ("Bash", "Edit", "Write", "Read", ...)
//   match   RegExp tested against the Bash command, or against the repo-relative file path
//   unless  optional RegExp; if it also matches, the rule does not fire
//   check   optional name of a builtin check in guard.mjs (for logic a regex can't express)
//   action  "deny" = always blocked. "gate" = blocked unless the operator typed `approve <gate>`
//           in their latest message (see approvals.mjs)
//   gate    gate name for action "gate"
//   reason  one line: why, and what to do instead
//
// Permission mode is bypass, so ONLY these hooks can stop an action. A hook "ask" is ignored in
// bypass mode; that's why approval-required actions are gates (deny until approved), not asks.

const FILE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const READ_TOOLS = ['Read', 'Grep', 'Glob'];
// A shell segment that writes/moves/deletes something at `pathRe` (mentions alone, e.g. cat/ls/import, are fine).
const shellWriteTo = (pathRe) => new RegExp(
  `(>>?|\\btee\\b|\\bmv\\b|\\bcp\\b|\\brm\\b|\\bsed\\s+-i|\\bperl\\s+-\\w*i|\\bchmod\\b|\\bln\\b|\\btouch\\b|\\btruncate\\b|\\bwriteFileSync\\b|\\bunlinkSync\\b)[^;&|]*${pathRe}`);
const SECRET_PATH =/(^|\/)\.env(?!\.example|\.sample|\.template)(\.[\w-]+)?$|\.pem$|\.config\/business-brain(\/|$)/;

export const GATES = {
  push: 'git push (any remote/branch)',
  commit: 'git commit (also opened by a plain request to commit)',
  'destructive-git': 'reset --hard, clean -f, branch -D, stash drop/clear, worktree remove, remote branch delete',
  delete: 'rm -r outside the scratchpad, docker volume/image removal, make db-reset',
  deploy: 'railway up/redeploy/add/variables --set/domain <name> and other prod infra changes',
  prod: 'reading prod config that can contain secrets (railway variables)',
  'prod-write': 'SQL writes against the prod DB via railway connect/ssh/run',
  migration: 'creating a new Flyway migration',
  frozen: 'editing frozen slices (Slice 4 voice, 6/6.1 carousel, 7 V1/V2 reels)',
  rules: 'editing hooks, rules, or Claude settings (these files enforce everything else)',
};

export const RULES = [
  // ── Self-protection ────────────────────────────────────────────────────────────────────────
  // Reading .claude/state (e.g. hook-log.jsonl) is fine; writing it never is.
  { id: 'approval-state-protected', tools: FILE_TOOLS, match: /(^|\/)\.claude\/state(\/|$)/,
    action: 'deny', reason: 'Approvals are created only from the operator\'s own message. Never write .claude/state.' },
  { id: 'approval-state-protected-bash', tools: ['Bash'], match: shellWriteTo('\\.claude/state'),
    action: 'deny', reason: 'Approvals are created only from the operator\'s own message. Never write .claude/state.' },
  { id: 'hook-config-protected', tools: FILE_TOOLS,
    match: /(^|\/)\.claude\/(hooks\/|settings(\.local)?\.json$)/, action: 'gate', gate: 'rules',
    reason: 'Hooks/settings enforce every other rule. Changing them needs operator approval.' },
  { id: 'hook-config-protected-bash', tools: ['Bash'], match: shellWriteTo('\\.claude/(hooks|settings)'),
    action: 'gate', gate: 'rules', reason: 'Writing to hooks/settings from the shell needs operator approval.' },

  // ── Secrets (CLAUDE.md: never print, interpolate, or source secrets) ────────────────────────
  { id: 'secret-file-read', tools: READ_TOOLS, match: SECRET_PATH, action: 'deny',
    reason: 'Secret file. Check presence only (grep -q \'^KEY=\' .env) and read .env.example instead.' },
  { id: 'secret-file-write', tools: FILE_TOOLS, match: SECRET_PATH, action: 'deny',
    reason: 'Never write secret files with an agent. The operator edits .env / keys by hand.' },
  { id: 'secret-shell-read', tools: ['Bash'], check: 'secretRead', action: 'deny',
    reason: 'That prints a secret file. Use presence checks only: [ -f .env ], grep -q \'^KEY=\' .env.' },
  { id: 'secret-source', tools: ['Bash'],
    match: /(^|[;&|(]\s*|\bset\s+-a\s*;?\s*)(source|\.)\s+["']?[^\s;&|]*\.env(?!\.example)\b/, action: 'deny',
    reason: 'Never shell-source .env. Compose injects it; use a non-shell loader if needed.' },
  { id: 'secret-echo', tools: ['Bash'],
    match: /\b(echo|printf)\b[^;&|]*\$\{?[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL)[A-Z_]*/, action: 'deny',
    reason: 'Never print a secret value. Use [ -n "$VAR" ] && echo set.' },
  { id: 'secret-env-dump', tools: ['Bash'], match: /(^|[;&|]\s*)(printenv|env|export\s+-p|set)\s*($|[;&|>])/,
    action: 'deny', reason: 'Dumping the environment prints secrets. Check a single var with [ -n "$VAR" ].' },
  { id: 'railway-variables-read', tools: ['Bash'], match: /\brailway\s+variables?\b(?![^;&|]*(--set|\bset\b))/,
    action: 'gate', gate: 'prod', reason: 'railway variables prints prod secret values.' },

  // ── Env-key preflight (CLAUDE.md: before ANY api restart/rebuild) ──────────────────────────
  { id: 'api-restart-needs-preflight', tools: ['Bash'],
    match: /docker(-|\s+)compose\b(?=[^;&|]*\b(up|restart|build|create|start)\b)(?=[^;&|]*(\bapi\b|--profile\s+app))|\bdocker\s+(restart|start)\b[^;&|]*\bapi\b|\brailway\s+(up|redeploy|restart)\b[^;&|]*(--service|-s)\s+api\b/,
    unless: /preflight-env-key\.sh[^;|]*&&/, action: 'deny',
    reason: 'Run `bash tools/preflight-env-key.sh && <command>` in the same command. A restart into a missing GOOGLE_OAUTH_ENCRYPTION_KEY orphans every encrypted credential.' },

  // ── Git ────────────────────────────────────────────────────────────────────────────────────
  { id: 'git-force-push', tools: ['Bash'],
    match: /\bgit\s+push\b[^;&|]*(\s-f\b|\s-[a-zA-Z]*f[a-zA-Z]*\b|--force(?!-with-lease)|\s\+[\w/.-]+)/,
    action: 'deny', reason: 'Force push is never done by an agent. The operator runs it by hand if ever needed.' },
  { id: 'git-remote-branch-delete', tools: ['Bash'], match: /\bgit\s+push\b[^;&|]*(--delete|\s:[\w/.-]+)/,
    action: 'gate', gate: 'destructive-git', reason: 'Deleting a remote branch.' },
  { id: 'git-push', tools: ['Bash'], match: /\bgit\s+push\b/, action: 'gate', gate: 'push',
    reason: 'Never push without the operator\'s approval in this conversation.' },
  { id: 'git-destructive', tools: ['Bash'],
    match: /\bgit\s+(reset\s+[^;&|]*--hard|clean\s+-[a-zA-Z]*f|branch\s+[^;&|]*-D\b|checkout\s+(--\s+)?\.\s*($|[;&|])|restore\s+[^;&|]*(\.|--worktree)\s*($|[;&|])|stash\s+(drop|clear)|worktree\s+remove|filter-branch|update-ref\s+-d)/,
    action: 'gate', gate: 'destructive-git', reason: 'Discards work or history. Confirm nothing unique is lost first.' },
  { id: 'git-commit', tools: ['Bash'], match: /\bgit\s+commit\b/, action: 'gate', gate: 'commit',
    reason: 'Commit only when the operator asks for it.' },

  // ── Deletion ───────────────────────────────────────────────────────────────────────────────
  { id: 'rm-outside-scratchpad', tools: ['Bash'], check: 'rmOutsideScratch', action: 'gate', gate: 'delete',
    reason: 'Recursive/bulk delete outside the session scratchpad. Look at the target and prove nothing unique is lost.' },
  { id: 'docker-destructive', tools: ['Bash'],
    match: /\bdocker\s+(volume\s+(rm|prune)|rmi\b|image\s+(rm|prune)|system\s+prune|container\s+prune)|docker(-|\s+)compose\b[^;&|]*\bdown\b[^;&|]*\s(-v|--volumes)\b|\bmake\s+db-reset\b/,
    action: 'gate', gate: 'delete', reason: 'Destroys local images/volumes/data.' },

  // ── Production ─────────────────────────────────────────────────────────────────────────────
  { id: 'railway-domain-bare', tools: ['Bash'], match: /\brailway\s+domain\b(?![^;&|]*\s[a-z0-9-]+(\.[a-z0-9-]+)+\b)/,
    action: 'deny', reason: 'Bare `railway domain` creates a public domain. Never run it.' },
  { id: 'railway-infra-change', tools: ['Bash'],
    match: /\brailway\s+(up|redeploy|restart|down|add|delete|domain|volume|link|unlink|environment\s+(new|delete)|service\s+delete|variables?\s+[^;&|]*(--set|\bset\b))/,
    unless: /\s--help\b/, action: 'gate', gate: 'deploy', reason: 'Changes production. Deploy only when the operator asks.' },
  { id: 'prod-sql-write', tools: ['Bash'],
    match: /\brailway\s+(connect|ssh|run)\b[\s\S]*\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+|TRUNCATE\s|ALTER\s+TABLE|CREATE\s+(TABLE|INDEX|SCHEMA))/i,
    action: 'gate', gate: 'prod-write', reason: 'Writes to the prod database. Prod is SELECT-only unless the operator approves.' },

  // ── Database migrations (Flyway, append-only) ──────────────────────────────────────────────
  { id: 'migration-edit-applied', tools: FILE_TOOLS, check: 'trackedMigration', action: 'deny',
    reason: 'Committed migrations are immutable (Flyway checksums). Add a new V###__*.sql instead.' },
  { id: 'migration-new', tools: FILE_TOOLS, match: /^database\/migrations\/V\d+__[^/]+\.sql$/,
    action: 'gate', gate: 'migration', reason: 'New migrations are append-only and permanent once applied to prod.' },

  // ── Frozen slices (CLAUDE.md: modify only to fix a regression) ─────────────────────────────
  { id: 'frozen-slice', tools: FILE_TOOLS,
    match: new RegExp([
      '^packages/application/src/(voice|carousel|photocarousel|reel|reel-shoot)/',
      '^packages/application/src/__tests__/(voice|carousel|photocarousel|reel|reel-shoot)/',
      '^packages/infrastructure/src/(reel|render)/',
      '(^|/)anthropic-(voice|carousel|photoled|reel)\\.model\\.ts$',
      '(^|/)pg-(voice|carousel|photoled|reel)\\.repository\\.ts$',
      '^apps/api/src/routes/(voice|carousel|photoled|reel)\\.routes\\.ts$',
      '^apps/web/src/slice0/(CarouselPage|PhotoCreatePage|ReelCreatePage)\\.tsx$',
      '^apps/workers/src/reel/',
      '^packages/infrastructure/assets/(fonts|reel-fonts)/',
    ].join('|')),
    action: 'gate', gate: 'frozen', reason: 'Frozen slice. Change only to fix a regression, with operator approval.' },
];
