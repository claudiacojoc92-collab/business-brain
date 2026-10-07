# Plan: Reel Studio (Hypit) service

- **Intent:** ./intent.md
- **Approved by:** Claudia on 2026-09-30 (via decisions in intent.md)

## Approach
Vendor Hypit as a pinned, isolated service in `services/reel-studio/`, with a thin wrapper that gives it
a stable tool surface (CLI + small HTTP API + a project Claude skill). Hypit stays upstream-shaped so we
can update it. Our wrapper owns inputs/outputs, the spend cap, and the licensing notice. An npm
workspace package isn't possible (Node 24 vs our Node 20) and would couple our build to Hypit's.

## Files to change
| File | Change |
|---|---|
| `services/reel-studio/README.md` | what it is, license boundary, setup, usage |
| `services/reel-studio/hypit.lock` | pinned upstream commit + version (currently b00532e / 0.2.16) |
| `services/reel-studio/bin/reel-studio.mjs` | wrapper CLI: `fetch <url>`, `analyze <video>`, `clone <video> --media <dir>`, `render <project>` |
| `services/reel-studio/server.mjs` | optional local HTTP API (localhost only) over the same commands |
| `services/reel-studio/Dockerfile` | Node 24 + pnpm + uv + ffmpeg + Chromium image |
| `services/reel-studio/.env.example` | model-service key names, spend cap (no values) |
| `.claude/skills/reel-studio/SKILL.md` | tells Claude how to drive it safely (needs `approve rules`) |
| `.gitignore` | ignore `services/reel-studio/{vendor,workspace,output}/` |
| `CLAUDE.md` | one line in the monorepo map |

## Work order
1. Install local prerequisites (pnpm, uv, yt-dlp) with Homebrew.
2. Fetch Hypit at the pinned commit into `services/reel-studio/vendor/` (git-ignored; reproducible
   with a setup script, not committed).
3. Run Hypit's own setup and test suite locally (`pnpm install`, `hypit media prepare-fetch`, its tests).
4. Write the wrapper CLI, Dockerfile and README.
5. Test A (no paid calls): an uploaded MP4 → analyze → composition file.
6. Test B: a TikTok URL and an Instagram Reel URL → fetch → analyze (records what works).
7. Test C (local-only: our clips, no paid calls): clone with our media swapped in → MP4.
8. Project skill + CLAUDE.md line, commit on a branch.

## Tests / verification
- Hypit's own suite passes at the pinned commit.
- Each test run's output (composition + MP4 + run report) saved and shown to the operator.

## Risks
- License: internal-only until a commercial license exists (hard boundary, written in the README).
- Instagram fetch often needs a logged-in session (cookies). We won't use personal account cookies
  without explicit approval; uploaded MP4 is the reliable path. Downloading other creators' posts may
  breach platform terms. Use for reference analysis, never republish their footage.
- Heavy dependencies (Chromium, WhisperX/Python) mean a large image and first-run downloads of several GB.
- Output quality: structure (cuts, captions, layout, pacing) reproduces well. Exact fonts, colors and
  motion are approximate. It's not deterministic.

## Status log
- 2026-09-30: Hypit inspected (license, deps, URL fetch via yt-dlp). Intent + plan drafted; awaiting approval.
- 2026-09-30: Approved (internal-only, local-only, brew). Plan changes during build:
  - Pinned npm package `@hypit/hypit@0.2.16` + lockfile instead of vendoring a git checkout.
  - No global yt-dlp/pnpm: Hypit ships a pinned yt-dlp via uv; brew yt-dlp needed an LLVM/Rust source
    build on this macOS. `uv` lives in a service-local venv (`.tools/`, `npm run setup`).
  - No HTTP API or Dockerfile yet (not needed for internal CLI use; add if/when it's deployed).
  - Hypit's skill copied to `.claude/skills/hypit/` (pinned, UPSTREAM.txt) + our `reel-studio` skill.
  Done: wrapper CLI, local profile, README (license boundary), 6 wrapper tests, doctor all green.
  Test A (no transcription): synthetic 3-scene reel → probe, boundaries (cuts found at 3.0 s / 6.0 s),
  contact sheet. In progress: one-time prepare (yt-dlp env, render browser, WhisperX).
- 2026-09-30: One-time prepare done (pinned yt-dlp 2026.8.19, Chrome Headless Shell 152, WhisperX
  small/cpu/int8 with en/ro/it alignment). Wrapper fixes: `inspect` starts the WhisperX helper before
  transcribing; contact sheets never overwrite. **Test A passed end-to-end**: 17 words in 6 passages,
  word-level timings (e.g. "Stop" 0.11–0.43 s). 6/6 wrapper tests. Nothing committed yet.
  Next: Test B needs target links from the operator (a TikTok + an Instagram Reel, ideally our own);
  Test C needs a folder of our clips.
- 2026-09-30: **Test B (Instagram) passed**: public reel fetched with no login (6.2 s, 1080×1920,
  30 fps, audio). Inspect: 3 cuts (1.67 / 2.92 / 5.25 s), no speech (music bed), contact sheet + full
  frames. Claude wrote ANALYSIS.md + TIMELINE.md (ironic POV meme: static serif caption over 2
  alternating framings, loopable). TikTok not yet tested. Next: Test C with operator's clips.
- 2026-10-01: **Test C passed**: operator's single-shot iPhone clip (19.7 s HEVC, rotated) recreated
  as the reference edit. Second framing = digital punch-in (crop 720×1280 @ 200,420, ×1.5); only
  phone-scrolling moments used. Caption in EB Garamond 500 @ 54 px (from Hypit's render bundle), rendered
  to a transparent layer by Hypit's headless Chrome, calibrated to within ~3% of the original width.
  Output cuts verified at 1.667 / 2.917 / 5.25 s = reference. Operator's own ambient audio (original
  music not reused; add the trending audio in Instagram when posting).
  **Gap found:** the final render used ffmpeg + headless Chrome directly, not a Hypit Build (SVML
  authoring not exercised yet). Local ffmpeg 9 has no drawtext; `-filter_complex_script` is now
  `-/filter_complex`. Next: fold this recipe into the wrapper (`reel-studio recut`), or author it as
  Hypit SVML so `build` covers it.
- 2026-10-01: Operator rejected v1: "doesn't look like the original; must show I'm on my phone and
  just click Claude Code while it works". Lesson: copy the **story beats**, not just the cut timings.
  v1 matched timings but dropped the click and aimed the punch-in at hair. v2: 5 shots (wide phone /
  close phone / wide reach / close click on Claude Code / wide back to phone), punch-ins aimed at the
  phone and the hand+screen, caption moved up so it never covers the laptop. Awaiting feedback.
