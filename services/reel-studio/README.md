# Reel Studio (internal)

Reproduce a target reel's structure (cuts, captions, layout, pacing, effects) with our own media.
Built on [Hypit](https://github.com/hypit-ai/hypit), pinned to `@hypit/hypit@0.2.16`.
Work record: `intent/2026-09-30-reel-studio-hypit/`.

## License boundary (read first)
Hypit uses a **modified Apache 2.0** license (`node_modules/@hypit/hypit/LICENSE`):

| Allowed without a commercial license | Needs a commercial license from Hypit.AI |
|---|---|
| Our own organization's use, including commercial work and work for clients | Offering Hypit's functionality to third parties as a hosted / SaaS service |
| Single-tenant deployments run by and for us | Any multi-tenant setup (2+ outside parties with separate workspaces), paid or free |
| Internal tooling | Selling or bundling Hypit or a derivative into a product for third parties |

Business Brain serves many founders, so **founder-facing use is multi-tenant and needs a commercial
license**. Until one is signed, this service stays internal: not imported by `apps/*`, not deployed,
not reachable by founders. Output videos are ours (license section 3). Hypit's name and logo in its CLI
and reports must not be removed.

## What it is
- A separate service with its own `package.json` and lockfile. Hypit needs Node >= 22.15 and the
  monorepo is Node 20, so it is **not** an npm workspace and nothing in `apps/*` or `packages/*`
  depends on it.
- `bin/reel-studio.mjs`: Business Brain's stable CLI over Hypit (see `--help`).
- `runtime/local.json`: the local-only Runtime Profile (media processing, WhisperX transcription,
  headless-Chromium rendering). **No paid model calls.**
- `workspace/<project>/`: one Hypit project per job (git-ignored).
- Claude skills: `.claude/skills/reel-studio/` (how to drive it safely) and `.claude/skills/hypit/`
  (Hypit's own production guide, pinned to the same version, see its `UPSTREAM.txt`).

## Setup
```bash
brew install ffmpeg uv                 # no global yt-dlp: Hypit installs its pinned copy via uv
cd services/reel-studio && npm ci
node bin/reel-studio.mjs doctor
```
The first `prepare` downloads a headless Chromium and a WhisperX Python environment with its model
(several GB, one time, stored in `~/Library/Application Support/Hypit`).

## Use
```bash
RS="node services/reel-studio/bin/reel-studio.mjs"
$RS new studio-hook                       # workspace/studio-hook
$RS fetch studio-hook https://www.tiktok.com/@user/video/123   # or: $RS add studio-hook ~/Downloads/reel.mp4
cp ~/clips/*.mp4 services/reel-studio/workspace/studio-hook/media/
$RS inspect studio-hook --language en     # boundaries, contact sheet, word-timed transcript
# Claude: ANALYSIS.md + TIMELINE.md + new composition (reel-studio skill)
$RS prepare studio-hook
$RS build studio-hook main.svrun
```
In Claude Code, just ask: "Use Reel Studio to make one like this: <link>, with the clips in <folder>."

## Links from TikTok, Instagram, YouTube
`fetch` uses Hypit's pinned yt-dlp (best stream up to 1080p, H.264 preferred, no playlists).
- **TikTok, YouTube Shorts:** public posts usually work.
- **Instagram Reels:** often need a logged-in session, so fetches fail or get rate-limited. We don't
  pass personal cookies. Download the reel and use `add` instead.
- Downloading other creators' posts may breach platform terms. Use targets as reference evidence only
  and never republish their footage, audio, logos or likeness.

## What "reproduce the style" means
Fetching only downloads the file. The style comes from the analysis step: Claude reads the target
through scene boundaries, time-labeled contact sheets, frame-by-frame grids and word-level transcript
timing, then writes an analysis and timeline and rebuilds the piece as an editable composition.
- **Reproduces well:** cut rhythm, caption treatment and timing (anchored to words, not seconds),
  layout, on-screen text, B-roll slots, pacing, sound cues.
- **Approximate:** exact fonts, colors, motion curves. Output is not deterministic.
- **Local-only limit:** without paid generation, shots we don't have become code-rendered graphics
  or gaps to film.

## Tests
`npm test` runs the wrapper tests (no network).
