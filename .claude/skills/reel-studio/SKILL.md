---
name: reel-studio
description: Reproduce a target reel/short's structure (cuts, captions, layout, pacing, effects) with our own media using the internal Reel Studio service (services/reel-studio, built on Hypit). Use when asked to clone, recreate, match or "make one like" a TikTok, Instagram Reel, YouTube Short or MP4. Internal use only.
---

# Reel Studio

Internal tool in `services/reel-studio/`. It wraps Hypit (`@hypit/hypit`, pinned) with a stable CLI.
The deterministic steps are the CLI. The creative steps (reading the target, writing the new
composition) are yours, guided by the `hypit` skill in `.claude/skills/hypit/`.

## Hard boundaries (check before every run)
1. **Internal only.** Hypit's license forbids offering it to third parties (founders) as a hosted or
   multi-tenant service without a commercial license from Hypit.AI. Never wire it into `apps/*`,
   founder-facing routes, or prod. If asked to, stop and point to `services/reel-studio/README.md`.
2. **Local-only profile.** No paid model calls. Never run `hypit auth login`, add hosted Endpoints
   (HypiHub, Seedance, GPT Image...) or edit `hypit.runtime.json` to include them unless the operator
   explicitly asks in this conversation and has set a spend cap.
3. **Style yes, content no.** Reproduce structure and style. Never put the target's footage, music,
   voice, logos or a real person's likeness into our output. The target is evidence only.
4. **Instagram links:** if `fetch` fails, ask the operator to download the reel and use `add`. Never
   use personal browser cookies or account sessions to fetch.

## Workflow
Run from the repo root. `RS="node services/reel-studio/bin/reel-studio.mjs"`.

1. `$RS doctor`: fix anything missing before starting.
2. `$RS new <project>`: creates `services/reel-studio/workspace/<project>/` (git-ignored).
3. Target: `$RS fetch <project> <url>` (TikTok / Shorts / most public links) or
   `$RS add <project> <file.mp4>` (uploads, Instagram).
4. Our media: copy the operator's clips/photos into `workspace/<project>/media/`.
5. `$RS inspect <project> --language en`: probe, scene boundaries, a contact sheet
   (`evidence/overview.jpg`) and a word-timed transcript. Look at the contact sheet.
6. Read `.claude/skills/hypit/references/creation/reference-video.md`, then write `ANALYSIS.md`
   and `TIMELINE.md` in the project. Use `$RS hypit <project> -- media tiles|frames|cut ...` for close
   reads. Share key frames with the operator as you go.
7. Fill in `BRIEF.md` with the operator (what to keep, what to change), then author the new
   composition per the hypit skill (`production/authoring.md`, `script-syntax.md`), using only files in
   `media/` plus code-rendered captions and graphics.
8. `$RS prepare <project>` once (local render browser + WhisperX), then
   `$RS build <project> <run-source>`. Export with `$RS hypit <project> -- get <build-id> --output <name> --to out.mp4`.
9. Show the operator the MP4 next to the target's contact sheet. Iterate on the composition, not by
   re-fetching.

## Honest expectations to set
- Structure (cut rhythm, caption treatment, layout, pacing, B-roll slots) reproduces well.
- Exact fonts, colors and motion curves are approximate. Output is not deterministic.
- Without paid generation, anything the target shows that we don't have in `media/` becomes a
  code-rendered graphic or a gap to film. Say so rather than inventing footage.
