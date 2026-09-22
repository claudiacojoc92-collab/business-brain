# Arc streaming refactor — scoped, NOT built

Status: **proposal only.** Captured for after MVP validation. Do not implement without an explicit go.

## Goal

Replace the current "wait, then the whole moment appears" experience with **token-by-token streaming**
(ChatGPT-style) for the moments whose output is prose, so the founder watches BB's answer form in real time.
This is a *perceived-latency* and *quality* improvement, layered on top of the progress-state fix already
shipped (`68ad9ee` — animated "BB is working…" + a "still working…" escalation). Streaming does **not** reduce
actual model latency.

## Current architecture (why streaming isn't a small change)

- The web calls **one synchronous `GET /v1/businesses/:id/arc`**. `viewFor` → `arcService.view` runs the model
  for the current moment *inside that GET* and returns a **complete view object**. The UI renders it statically.
- The models return **JSON** (`client.messages.create`, not `.stream`). The arc parses the JSON into typed
  fields and renders sections/bullets/cards.
- There is no streaming channel between api and web.

So streaming requires a new transport, streaming model calls, and a UI that renders incrementally — none of
which exist today. That's why it's a separate batch, not a tweak.

## Which moments can actually stream

Streamability depends on whether the *final rendered content* is prose or structured JSON. (Note: this differs
slightly from a first guess — the email is the **most** streamable, and the understanding is **not**, because of
how each renders.)

| Moment | Output shape | Streams well? | Notes |
|---|---|---|---|
| M3 understanding | structured JSON (tensions/confident/inferring/unanswered) | **No** (final render) | Could stream a prose "reading…" trace while the structured result computes. |
| M4 conversation | prose (interpretation + question) | **Yes** | The turn text forms live; the opener is structured JSON (`__arcOpener`) so the opener itself would not stream, but subsequent replies would. |
| M5 mirror | prose (you-said / I-saw / tension) | **Yes** | Three short prose fields; can stream the tension. |
| M6 strategy | structured JSON (bet/trade-offs/not-now/reconsider) | **No** | Multi-call (generate + judge + repair); nothing coherent to stream token-by-token. |
| M7 plan | structured JSON (week + today) | **No** | Same as strategy. |
| M8 email | prose (subject + body) | **Yes — best fit** | A letter; streams exactly like ChatGPT. |
| M9 container | deterministic projection (no model) | **N/A** | Already instant; no model call to stream. |

So the streamable set is **M4 (replies), M5, M8**. The structured moments (M3, M6, M7) keep the current
static render — with the option of a streamed *thinking trace* rather than the final content. M9 needs nothing.

## What the refactor involves

1. **SSE transport (server-sent events).** New streaming endpoints (e.g. `POST /v1/businesses/:id/arc/email/stream`)
   that hold the connection open and emit `text/event-stream` chunks. Fastify supports SSE via a raw reply
   stream. One endpoint per streamable moment (or one generic `/arc/:moment/stream`).
2. **Streaming model calls.** For the streamable moments, switch `client.messages.create` → `client.messages.stream`
   and forward `text` deltas to the SSE response as they arrive. (These models emit prose, so no JSON-assembly
   problem.) The existing non-stream path stays for the structured moments.
3. **Move generation out of `GET /arc`.** This is the paired refactor from the Phase-1 audit: `GET /arc` becomes a
   fast **read** of persisted state only; generation moves to **POST-triggered** flows (the streaming endpoints
   above, or a background job that writes the result and the SSE/poll delivers it). This also removes the
   in-GET-failure surface entirely (today it's *isolated* per moment; then it wouldn't exist).
   - Option A (lighter): POST starts a streamed generation; the client consumes the stream and, on completion,
     the result is persisted (as it is today) so refresh reads it.
   - Option B (fuller): a background worker (BullMQ already in the stack) generates; the client subscribes via SSE
     or short-poll. Better for very slow moments (strategy/plan) and for surviving a dropped connection.
4. **UI: streaming text rendering.** New component that appends deltas to a growing text node (for M4 reply / M5
   tension / M8 body), with a caret/cursor. The current static render stays for structured moments. The
   "BB is working…" state becomes the *pre-first-token* state; once tokens arrive, it flips to the streaming text.

## Effort & risk

- **Effort:** medium-large. ~SSE endpoint(s) + streaming model wrappers + move-generation-out-of-GET + a UI
  streaming renderer + tests. Realistically a multi-day batch. Option B (background worker) adds queue wiring.
- **Risk:** moderate. New transport (SSE) has its own failure modes (dropped connections, proxy buffering —
  nginx must not buffer `text/event-stream`; needs `proxy_buffering off` on those routes). Moving generation out
  of GET changes the arc's control flow (well-understood now, but the biggest structural change). Mitigated by
  keeping the structured moments on the current path and shipping streamable moments incrementally (M8 email
  first — smallest, highest "wow", lowest risk).

## What stays the same

- **No model changes** — the prompts, temperature, one-language rules, and JSON discipline are untouched
  (streaming just reads the same models' output as it forms; structured moments keep `create` + JSON parse).
- **No data-model changes** — the same persisted artifacts (understanding snapshot, turns, `arc_mirror_built`,
  strategy/plan proposals, `arc_email_saved`); streaming only changes *how the result is delivered*, not what is
  stored. Refresh/return still reads persisted state.
- The moment machine, per-moment error isolation, caching, and content-language chrome all stay as-is.

## Suggested sequencing (when it's time)

1. M8 email streaming over SSE (smallest, best demo, isolated).
2. M4 conversation replies + M5 mirror.
3. Move generation for M3/M6/M7 out of GET into POST/background (no token streaming; a streamed "thinking" trace
   is optional), retiring the in-GET generation entirely.
