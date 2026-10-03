// Run: node --test .claude/hooks/
// Every rule in rules.mjs needs at least one BLOCK case and, where false positives are likely, an ALLOW case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from './guard.mjs';
import { parseApprovals } from './approvals.mjs';

const SCRATCH = '/private/tmp/claude-501/proj/sess/scratchpad';
const bash = (command, extra = {}) => ({ tool_name: 'Bash', tool_input: { command }, scratchpad_dir: SCRATCH, session_id: 's', ...extra });
const file = (tool, file_path, extra = {}) => ({ tool_name: tool, tool_input: { file_path }, session_id: 's', ...extra });
const ruleOf = (input, approvals) => decide(input, new Set(approvals))?.rule.id ?? null;
const blocked = (input, approvals = []) => decide(input, new Set(approvals))?.decision === 'deny';

const BLOCK = [
  // secrets
  ['cat .env', 'secret-shell-read'],
  ['head -5 apps/api/.env', 'secret-shell-read'],
  ['cat jwt-dev-private.pem', 'secret-shell-read'],
  ['cat ~/.config/business-brain/google_oauth_encryption_key', 'secret-shell-read'],
  ['grep KEY .env', 'secret-shell-read'],
  ['source .env', 'secret-source'],
  ['set -a; . ./.env; set +a', 'secret-source'],
  ['echo $ANTHROPIC_API_KEY', 'secret-echo'],
  ['printenv', 'secret-env-dump'],
  ['railway variables --service api', 'railway-variables-read'],
  // preflight
  ['docker compose up -d api', 'api-restart-needs-preflight'],
  ['docker compose --profile app up -d', 'api-restart-needs-preflight'],
  ['docker compose restart api', 'api-restart-needs-preflight'],
  ['railway up --service api --detach', 'api-restart-needs-preflight'],
  // git
  ['git push', 'git-push'],
  ['git push -u origin feature/x', 'git-push'],
  ['git push --force', 'git-force-push'],
  ['git push -f origin main', 'git-force-push'],
  ['git push origin +main', 'git-force-push'],
  ['git push origin --delete old', 'git-remote-branch-delete'],
  ['git reset --hard HEAD~1', 'git-destructive'],
  ['git clean -fd', 'git-destructive'],
  ['git branch -D meta/reviewer-shell', 'git-destructive'],
  ['git stash drop', 'git-destructive'],
  ['git worktree remove ../x', 'git-destructive'],
  ['git checkout -- .', 'git-destructive'],
  ['git commit -m "x"', 'git-commit'],
  // deletion
  ['rm -rf apps/web/dist', 'rm-outside-scratchpad'],
  ['rm -r ~/Desktop/foo', 'rm-outside-scratchpad'],
  ['rm *.log', 'rm-outside-scratchpad'],
  ['find . -name "*.tmp" -delete', 'rm-outside-scratchpad'],
  ['docker volume rm bb_pg', 'docker-destructive'],
  ['docker compose down -v', 'docker-destructive'],
  ['make db-reset', 'docker-destructive'],
  // prod
  ['railway domain', 'railway-domain-bare'],
  ['railway domain --service web', 'railway-domain-bare'],
  ['railway up --service web --detach', 'railway-infra-change'],
  ['railway redeploy --service web --yes', 'railway-infra-change'],
  ['railway variables --set FOO=1', 'railway-infra-change'],
  [`railway connect Postgres-WbaE <<'SQL'\nDELETE FROM founders WHERE id='x';\nSQL`, 'prod-sql-write'],
  ['railway ssh --service api "psql $DATABASE_URL -c \'update plans set x=1\'"', 'prod-sql-write'],
  // self-protection
  ['echo "{}" > .claude/state/approvals.json', 'approval-state-protected-bash'],
  ['rm .claude/state/approvals.json', 'approval-state-protected-bash'],
  ["node -e \"require('fs').writeFileSync('.claude/state/approvals.json','{}')\"", 'approval-state-protected-bash'],
  ["sed -i '' 's/deny/allow/' .claude/hooks/rules.mjs", 'hook-config-protected-bash'],
  ['cp /tmp/x.json .claude/settings.local.json', 'hook-config-protected-bash'],
  ['echo "{}" > ~/.claude/settings.json', 'hook-config-protected-bash'],
];

for (const [cmd, rule] of BLOCK) {
  test(`BLOCK ${rule}: ${cmd.split('\n')[0]}`, () => {
    assert.equal(ruleOf(bash(cmd)), rule);
    assert.ok(blocked(bash(cmd)));
  });
}

const ALLOW = [
  'git status --short && git log --oneline -5',
  'git diff HEAD~1',
  'npx vitest run packages/application/src/plan',
  'npx tsc --noEmit -p apps/api/tsconfig.json',
  'cat .env.example',
  '[ -f .env ] && echo present',
  "grep -q '^GOOGLE_OAUTH_ENCRYPTION_KEY=' .env && echo set",
  'git check-ignore -v .env',
  '[ -n "$ANTHROPIC_API_KEY" ] && echo set',
  'env FOO=1 node script.mjs',
  'bash tools/preflight-env-key.sh && docker compose up -d api',
  'bash tools/preflight-env-key.sh && railway up --service api --detach', // still deploy-gated, see below
  `rm -rf ${SCRATCH}/tmpdir`,
  'rm file.txt',
  'railway logs --service api --since 60m',
  'railway status',
  'railway connect Postgres-WbaE <<< "SELECT count(*) FROM founders"',
  'railway up --help',
  'git push --help'.replace('push --help', 'log'), // plain git log
  'docker compose ps',
  'docker compose up -d postgres redis',
  'cat .claude/hooks/rules.mjs',
  'node --test .claude/hooks/',
  // regressions: mentions/reads of protected paths must not be blocked
  "node -e \"import('./.claude/hooks/rules.mjs').then(m=>console.log(m.RULES.length))\"",
  'git status --short -uall .claude',
  'tail -20 .claude/state/hook-log.jsonl',
  'cd /repo && grep -c deny .claude/state/hook-log.jsonl',
];

for (const cmd of ALLOW) {
  test(`ALLOW: ${cmd.split('\n')[0]}`, () => {
    const r = decide(bash(cmd), new Set(['deploy']));
    assert.equal(r?.decision === 'deny', false, r?.message);
  });
}

test('gate opens only with the matching approval', () => {
  assert.ok(blocked(bash('git push'), ['commit']));
  assert.equal(decide(bash('git push'), new Set(['push'])).decision, 'approved');
  assert.ok(blocked(bash('railway up --service web --detach'), ['push']));
  assert.equal(decide(bash('railway up --service web --detach'), new Set(['deploy'])).decision, 'approved');
});

test('preflight rule has no approval path', () => {
  assert.ok(blocked(bash('docker compose up -d api'), ['deploy', 'delete', 'push']));
});

test('sub-agents can never commit, push, or deploy, even when approved', () => {
  assert.ok(blocked(bash('git push', { agent_id: 'a1' }), ['push']));
  assert.ok(blocked(bash('git commit -m x', { agent_id: 'a1' }), ['commit']));
  // deploy grant is the parent's, not the sub-agent's: railway up stays blocked inside a sub-agent
  assert.ok(blocked(bash('railway up --service web --detach', { agent_id: 'a1' }), ['deploy']));
  assert.equal(decide(bash('rm -r build', { agent_id: 'a1' }), new Set(['delete'])).decision, 'approved');
});

test('file tools: secrets, frozen slices, migrations, hook config', () => {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const f = (tool, p) => file(tool, `${cwd}/${p}`, { cwd });
  assert.equal(ruleOf(f('Read', '.env')), 'secret-file-read');
  assert.equal(ruleOf(f('Read', 'jwt-dev-private.pem')), 'secret-file-read');
  assert.equal(ruleOf(f('Read', '.env.example')), null);
  assert.equal(ruleOf(f('Write', '.env')), 'secret-file-write');
  assert.equal(ruleOf(f('Edit', 'packages/application/src/carousel/carousel.service.ts')), 'frozen-slice');
  assert.equal(ruleOf(f('Edit', 'packages/application/src/voice/voice.service.ts')), 'frozen-slice');
  assert.equal(ruleOf(f('Edit', 'apps/web/src/slice0/ReelCreatePage.tsx')), 'frozen-slice');
  assert.equal(ruleOf(f('Edit', 'packages/application/src/plan/plan.service.ts')), null);
  assert.equal(decide(f('Edit', 'packages/application/src/carousel/carousel.service.ts'), new Set(['frozen'])).decision, 'approved');
  assert.equal(ruleOf(f('Edit', 'database/migrations/V001__create_schemas.sql')), 'migration-edit-applied');
  assert.ok(blocked(f('Edit', 'database/migrations/V001__create_schemas.sql'), ['migration']));
  assert.equal(ruleOf(f('Write', 'database/migrations/V999__new_thing.sql')), 'migration-new');
  assert.equal(ruleOf(f('Edit', '.claude/hooks/rules.mjs')), 'hook-config-protected');
  assert.equal(ruleOf(f('Edit', '.claude/settings.json')), 'hook-config-protected');
  assert.equal(ruleOf(f('Write', '.claude/state/approvals.json')), 'approval-state-protected');
  assert.ok(blocked(f('Write', '.claude/state/approvals.json'), ['rules']));
});

test('approval parsing', () => {
  assert.deepEqual(parseApprovals('looks good, approve push'), ['push']);
  assert.deepEqual(parseApprovals('Approve deploy, commit').sort(), ['commit', 'deploy']);
  assert.deepEqual(parseApprovals('approve: frozen and migration').sort(), ['frozen', 'migration']);
  assert.deepEqual(parseApprovals('please commit this'), ['commit']);
  assert.deepEqual(parseApprovals("don't commit yet"), []);
  assert.deepEqual(parseApprovals('do not push or commit anything'), []);
  assert.deepEqual(parseApprovals('push it'), []); // push needs the explicit phrase
  assert.deepEqual(parseApprovals('approve everything'), []);
});
