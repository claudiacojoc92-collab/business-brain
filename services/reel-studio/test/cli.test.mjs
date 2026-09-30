// Wrapper tests: no network, no Hypit runtime. Run: npm test (from services/reel-studio)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'bin/reel-studio.mjs'), ...args], { encoding: 'utf8', cwd: ROOT });

test('help lists every command and states the license boundary', () => {
  const r = cli('--help');
  assert.equal(r.status, 0);
  for (const c of ['doctor', 'new', 'fetch', 'add', 'inspect', 'prepare', 'build', 'hypit']) assert.match(r.stdout, new RegExp(`\\b${c}\\b`));
  assert.match(r.stdout, /INTERNAL USE ONLY/);
});

test('unknown command exits non-zero', () => {
  assert.notEqual(cli('explode').status, 0);
});

test('project names must be kebab-case (no path traversal)', () => {
  for (const bad of ['../etc', 'Foo', 'a/b', '']) {
    const r = cli('inspect', bad);
    assert.notEqual(r.status, 0, bad);
    assert.match(r.stderr, /kebab-case/);
  }
});

test('fetch rejects non-http targets', () => {
  const r = cli('fetch', 'does-not-exist', 'file:///etc/passwd');
  assert.notEqual(r.status, 0);
});

test('local runtime profile declares no credentials and no hosted endpoints', () => {
  const profile = JSON.parse(readFileSync(path.join(ROOT, 'runtime/local.json'), 'utf8'));
  assert.deepEqual(profile.credentials, {});
  for (const [name, ep] of Object.entries(profile.endpoints)) {
    assert.match(name, /\.local$/, name);
    assert.match(ep.use, /-local$/, ep.use);
  }
});

test('Hypit is pinned to an exact version', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.dependencies['@hypit/hypit'], /^\d+\.\d+\.\d+$/);
});
