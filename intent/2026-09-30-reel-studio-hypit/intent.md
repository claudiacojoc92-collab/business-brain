# Intent: Reel Studio (Hypit) service

- **Date:** 2026-09-30
- **Originator:** Claudia
- **Approved by:** Claudia on 2026-09-30
- **Status:** in-build

## Problem
Founders (and we) see a reel or short that works and want one "like that" with their own media. Today
Business Brain can render reels from founder clips (Slice 7 V1) and tell founders what to film (V2), but
it can't take a *target* video and reproduce its structure: cut rhythm, caption style, layout, B-roll
slots, effects, timing.

## Outcome
A self-contained **Reel Studio** service inside the repo, built on Hypit, that can:
1. take a target video (uploaded MP4, or a TikTok / YouTube Shorts / Instagram Reel URL),
2. break it down into an editable composition (Hypit SVML), and
3. render a new MP4 using our own media swapped in.

Check: from one sample target + a folder of our clips, the service returns an MP4 whose structure
visibly matches the target, and a re-runnable composition file.

## Affected users and systems
- New folder `services/reel-studio/` with its own runtime (Node 24, pnpm, uv/Python, ffmpeg, Chromium).
- Our team, internally. **Not founder-facing** in this intent (see Constraints).
- No changes to `apps/*`, `packages/*`, the DB, or prod.

## Constraints
- **License (Hypit modified Apache 2.0):** free for our own organization's use and single-tenant
  deployments. Offering it to founders as part of Business Brain (a multi-tenant SaaS) requires a
  **commercial license from Hypit.AI**. Until one is signed, the service stays internal-only.
- Hypit needs Node >= 22.15; the monorepo is Node 20. So it's a separate service (own lockfile and
  Docker image), not an npm workspace package.
- Frozen Slice 7 V1/V2 code is not touched. Any future product integration goes through its own intent.
- Style is reproducible; other creators' footage, music, logos and likeness are not copied into output.
- Paid model calls (HypiHub / Seedance / GPT Image, about $1 per video) only with a spend cap set
  by the operator.

## Out of scope
- Founder-facing UI or API routes.
- Deploying to Railway.
- Auto-publishing to Instagram/TikTok.

## Decisions (answered 2026-09-30)
1. Internal-only now. Contact Hypit.AI about a commercial license separately before any founder-facing use.
2. Local-only first: no paid model calls. Our clips + code-rendered captions/graphics.
3. Install pnpm, uv, yt-dlp with Homebrew.
