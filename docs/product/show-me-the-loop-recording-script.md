# Show Me the Loop — Screen-Recording Script (3–5 min)

Goal: demonstrate the complete founder journey **without explaining internal architecture**. No hashes, IDs, or schema talk. Everything below is visible in the rendered product; the demo loop is seeded by the dev-only `POST /dev/demo/strategy-loop` for the signed-in founder.

**Setup (off-camera):** API on :3000, vite (with `/api` + `/dev` proxy) on :5177, dev DB up, Redis flushed. Sign up/in as a demo founder, then `POST /dev/demo/strategy-loop`.

| Time | On screen | Say (plain language) |
|------|-----------|----------------------|
| 0:00 | `/strategy` history list, "See the whole thread →" | "Every priority question I've worked through is here. Let's follow one all the way." |
| 0:15 | Click "See the whole thread →" → thread page top | "This is the whole thread — one line of reasoning, read back from my own records." |
| 0:30 | **1 Recommendation** | "It started as a recommendation: validate one narrow segment before adding features." |
| 0:55 | **2 Decision** (↑ from recommendation) | "I made a decision on it — and it shows what it came from." |
| 1:15 | **3 Commitment** (↑ from decision) | "That became a commitment: interview five founders, run three sessions." |
| 1:35 | **4 Plan → Execution** (Completed / Attempted) | "Here's the plan and what actually happened — five interviews done, sessions only partly. It doesn't pretend." |
| 2:00 | **Outcome review** (Partly as intended + named unknown) | "The review is honest: partly as intended, with a named unknown." |
| 2:20 | **Possible learning → Kept** | "A possible learning surfaced — and I kept it." |
| 2:40 | **5 Strategic learning → Promotion** | "It became a strategic learning, and I promoted it into my standing context." |
| 3:05 | **6 What it shaped next** (bounded disclosure) | "Later, a new recommendation was generated with a snapshot that included this learning. Not 'caused by' — included." |
| 3:25 | Click **"Trace it back…"** → lineage highlights | "And I can walk it backward — from that later recommendation, to the learning, to the review, to the plan, to where it began." |
| 3:50 | Scroll: the whole thread in one view | "One continuous loop. Nothing invented — where a source can't be shown, it says so." |
| 4:10 | "Back to strategy" | "Read-only. It stores nothing and changes nothing. That's the loop." |

**Do not** open the "Generation reference" disclosure on camera unless asked — the point is that the founder never needs it to follow the story.
