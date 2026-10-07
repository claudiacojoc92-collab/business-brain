#!/usr/bin/env node
// Reel Studio: Business Brain's internal wrapper over Hypit (@hypit/hypit, pinned in package.json).
// INTERNAL USE ONLY. Hypit's license forbids offering it to third parties (founders) as a hosted or
// multi-tenant service without a commercial license from Hypit.AI. See README.md "License boundary".
//
// Projects live in services/reel-studio/workspace/<name>/ (git-ignored). Each is its own Hypit project.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = path.join(ROOT, 'workspace');
const HYPIT = path.join(ROOT, 'node_modules', '.bin', 'hypit');
const PROFILE_TEMPLATE = path.join(ROOT, 'runtime', 'local.json');
// Service-local tools (uv) from `npm run setup`, so nothing needs installing machine-wide.
const TOOLS_BIN = path.join(ROOT, '.tools', 'venv', 'bin');
process.env.PATH = `${TOOLS_BIN}${path.delimiter}${process.env.PATH}`;

const USAGE = `reel-studio <command> [args]   (INTERNAL USE ONLY — see README "License boundary")

  doctor                          check local prerequisites and the pinned Hypit install
  new <project>                   create workspace/<project> with the local-only runtime profile
  fetch <project> <url>           download a target video (TikTok/Shorts/Reel link) to references/source.mp4
  add <project> <file.mp4>        use a local/uploaded target video as references/source.mp4
  inspect <project> [--language en] [--no-transcribe]
                                  probe, scene boundaries, overview contact sheet, word-timed transcript
  prepare <project> [endpoint]    prepare local services (media.local, whisperx.local, hyperframes.local)
  build <project> <run-source>    render the composition (hypit build <run-source> --follow)
  hypit <project> -- <args...>    run any hypit command inside the project

Creative steps (ANALYSIS.md, TIMELINE.md, the new composition) are done by Claude following the
Hypit skill; this CLI provides the deterministic tools around them.`;

const projectDir = (name) => {
  if (!name || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) fail('project name must be kebab-case (a-z, 0-9, -)');
  return path.join(WORKSPACE, name);
};

function fail(msg) { process.stderr.write(`reel-studio: ${msg}\n`); process.exit(1); }

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8', ...opts });
  if (r.error) return { ok: false, out: '', err: r.error.message };
  return { ok: r.status === 0, out: r.stdout || '', err: r.stderr || '' };
}

function hypit(dir, args, opts) {
  if (!existsSync(HYPIT)) fail('Hypit is not installed. Run: (cd services/reel-studio && npm ci)');
  const r = run(HYPIT, args, { cwd: dir, ...opts });
  if (!r.ok && !opts?.allowFail) fail(`hypit ${args.join(' ')} failed${r.err ? `:\n${r.err}` : ''}`);
  return r;
}

function requireProject(name) {
  const dir = projectDir(name);
  if (!existsSync(path.join(dir, 'package.json'))) fail(`no project "${name}". Run: reel-studio new ${name}`);
  return dir;
}

const commands = {
  doctor() {
    const [major, minor] = process.versions.node.split('.').map(Number);
    const checks = [
      ['node >= 22.15', major > 22 || (major === 22 && minor >= 15), process.versions.node],
      ['hypit (pinned)', existsSync(HYPIT), existsSync(HYPIT) ? run(HYPIT, ['--version'], { capture: true }).out.trim() : 'run npm ci'],
    ];
    // No global yt-dlp needed: `media prepare-fetch` installs Hypit's pinned copy through uv.
    for (const tool of ['ffmpeg', 'ffprobe', 'uv']) {
      const r = run(tool, [tool.startsWith('ff') ? '-version' : '--version'], { capture: true });
      checks.push([tool, r.ok, r.ok ? r.out.split('\n')[0].slice(0, 60) : 'missing (brew install ' + (tool.startsWith('ff') ? 'ffmpeg' : tool) + ')']);
    }
    for (const [name, ok, detail] of checks) process.stdout.write(`${ok ? 'ok  ' : 'MISS'}  ${name.padEnd(16)} ${detail}\n`);
    process.stdout.write('\nLicense boundary: internal use only. Not for founder-facing/multi-tenant use without a Hypit.AI commercial license.\n');
    if (checks.some(([, ok]) => !ok)) process.exit(1);
  },

  new(name) {
    const dir = projectDir(name);
    if (existsSync(dir)) fail(`workspace/${name} already exists`);
    for (const sub of ['references', 'media', 'evidence']) mkdirSync(path.join(dir, sub), { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `reel-${name}`, private: true, type: 'module' }, null, 2) + '\n');
    writeFileSync(path.join(dir, 'BRIEF.md'), `# Brief: ${name}\n\n- Target: references/source.mp4 (see references/SOURCE.md)\n- Our media: media/\n- What to keep from the target:\n- What to change:\n- License: internal use only.\n`);
    hypit(dir, ['runtime', 'init']);
    copyFileSync(PROFILE_TEMPLATE, path.join(dir, 'hypit.runtime.json'));
    process.stdout.write(`Created workspace/${name} (local-only profile: no paid model calls).\nNext: reel-studio fetch ${name} <url>  or  reel-studio add ${name} <file.mp4>\n`);
  },

  fetch(name, url) {
    const dir = requireProject(name);
    if (!/^https?:\/\//.test(url || '')) fail('fetch needs an http(s) URL');
    const target = path.join(dir, 'references', 'source.mp4');
    if (existsSync(target)) fail('references/source.mp4 already exists (one target per project)');
    hypit(dir, ['media', 'prepare-fetch']);
    const r = hypit(dir, ['media', 'fetch', url, '--to', 'references/source.mp4', '--json'], { capture: true, allowFail: true });
    if (!r.ok) {
      const hint = /instagram\.com/.test(url)
        ? '\nInstagram often requires a logged-in session. Download the reel yourself and use: reel-studio add'
        : '';
      fail(`fetch failed:\n${r.err || r.out}${hint}`);
    }
    writeFileSync(path.join(dir, 'references', 'SOURCE.md'),
      `# Source\n\n- URL: ${url}\n- Fetched: ${new Date().toISOString()}\n- Use: reference analysis only. Never republish this footage, audio, logos or likeness.\n\n\`\`\`json\n${r.out.trim()}\n\`\`\`\n`);
    process.stdout.write(r.out);
  },

  add(name, file) {
    const dir = requireProject(name);
    if (!file || !existsSync(file)) fail(`file not found: ${file}`);
    const target = path.join(dir, 'references', 'source.mp4');
    if (existsSync(target)) fail('references/source.mp4 already exists (one target per project)');
    copyFileSync(file, target);
    writeFileSync(path.join(dir, 'references', 'SOURCE.md'), `# Source\n\n- File: ${path.basename(file)}\n- Added: ${new Date().toISOString()}\n`);
    hypit(dir, ['media', 'probe', 'references/source.mp4']);
  },

  inspect(name, ...rest) {
    const dir = requireProject(name);
    const src = 'references/source.mp4';
    if (!existsSync(path.join(dir, src))) fail(`no ${src}. Use fetch or add first.`);
    const lang = rest.includes('--language') ? rest[rest.indexOf('--language') + 1] : 'en';
    hypit(dir, ['media', 'probe', src]);
    const b = hypit(dir, ['media', 'boundaries', src], { capture: true, allowFail: true });
    if (b.ok) writeFileSync(path.join(dir, 'evidence', 'boundaries.txt'), b.out);
    const transcript = 'references/transcript.json';
    if (!rest.includes('--no-transcribe') && !existsSync(path.join(dir, transcript))) {
      // Prepared != running: start the warm WhisperX helper (idempotent) before transcribing.
      hypit(dir, ['programs', 'up', '--endpoint', 'whisperx.local'], { allowFail: true });
      const t = hypit(dir, ['transcribe', src, '--language', lang, '--to', transcript], { allowFail: true });
      if (!t.ok) process.stderr.write('Transcription unavailable (run: reel-studio prepare <project> whisperx.local). Continuing without it.\n');
    }
    // Hypit never overwrites; keep earlier sheets and write the next free name.
    let sheet = 'evidence/overview.jpg';
    for (let n = 2; existsSync(path.join(dir, sheet)); n++) sheet = `evidence/overview-${n}.jpg`;
    const tileArgs = ['media', 'tile', src, '--frames', '16', '--columns', '4', '--cell', '360', '--to', sheet];
    if (existsSync(path.join(dir, transcript))) tileArgs.push('--transcript', transcript);
    hypit(dir, tileArgs, { allowFail: true });
    process.stdout.write(`\nEvidence in workspace/${name}/evidence/. Next: Claude writes ANALYSIS.md and TIMELINE.md (Hypit skill, creation/reference-video.md).\n`);
  },

  prepare(name, endpoint) {
    const dir = requireProject(name);
    const endpoints = endpoint ? [endpoint] : ['media.local', 'hyperframes.local', 'whisperx.local'];
    for (const e of endpoints) hypit(dir, ['programs', 'prepare', '--endpoint', e], { allowFail: true });
    hypit(dir, ['runtime', 'up', '--endpoint', 'media.local'], { allowFail: true });
    hypit(dir, ['runtime', 'status'], { allowFail: true });
  },

  build(name, runSource) {
    const dir = requireProject(name);
    if (!runSource || !existsSync(path.join(dir, runSource))) fail('build needs the project\'s run source, e.g. reel-studio build <project> main.svrun');
    hypit(dir, ['build', runSource, '--follow']);
  },

  hypit(name, ...rest) {
    const args = rest[0] === '--' ? rest.slice(1) : rest;
    const r = hypit(requireProject(name), args, { allowFail: true });
    process.exit(r.ok ? 0 : 1);
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || cmd === '--help' || cmd === '-h' || !commands[cmd]) {
  process.stdout.write(USAGE + '\n');
  process.exit(cmd && !commands[cmd] && cmd !== '--help' && cmd !== '-h' ? 1 : 0);
}
commands[cmd](...args);
