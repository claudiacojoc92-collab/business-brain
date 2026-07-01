ADR-007 — Connect Your World Nucleus
Status: 🔒 LOCKED Type: Product / Technical Architecture Decision Record Decision date: 1 July 2026 Owner: Claudia Cojoc (Founder / Head of Product) Applies to: Business Brain — Product Build Mode Supersedes roadmap position of: M1.5 (manual input) — demoted to internal validation harness Location: Business Brain — Product Governance / Architecture Decisions

0. Context
M1 and M1.5 proved the Business Model engine runs on real-shaped input. They also proved, by way of a trust violation (fabricated channel observations), that honesty must be enforced structurally rather than by prompt discipline. Manual text input was useful as an engine harness but is not the founder experience and must not drive the roadmap.
This record freezes the next architecture phase. It defines the single product principle, the smallest honest build that preserves the five-year architecture, and the explicit boundaries — deferred, forbidden, and locked — that protect the team from over-building the machine before the asset it manages has been validated.
The five-year architecture (event-sourced understanding system: an append-only evidence log fusing observed reality and declared intent, over which every capability is a rebuildable projection) is accepted as a destination. This record deliberately does not build it now. It builds its honest nucleus and forbids the surrounding scaffolding until real usage demands it.

1. Frozen principle
Business Brain learns from connected reality and declared intent. It never asks founders to reconstruct what it can fetch.
This principle is frozen. It is not subject to reinterpretation, softening under connector failure, or exception "just this once."
Definitions (frozen):
Term	Definition	Status
Connected reality	Observed evidence pulled from sources the founder authorizes (website, Instagram, Google, uploads-of-real-artifacts).	observed
Declared intent	Founder goals, constraints, priorities, decisions, fears, pivots, and corrections. Exists in no connectable source. Captured via conversation.	declared
Reconstruction	Founder manually retyping, rewriting, or summarizing what already exists somewhere connectable.	FORBIDDEN
Inferred	A conclusion derived from evidence. Never invented. Structurally required to carry the evidence it was derived from.	derived
The load-bearing distinction: declaration is not reconstruction. Declaration is strategic evidence and the product's most defensible asset. Reconstruction is founder labor doing the machine's job. The first is essential and central. The second is forbidden. This distinction is frozen and must not be re-merged.

2. Approved nucleus for build
Build only the smallest version that preserves the core idea. The core idea is: typed, provenance-bearing evidence — observed and declared — is captured, never reconstructed, and a recomputed model is always traceable back to it.
Approved for build:
1. Append-only evidence store — a store the team agrees never to update in place. Not a framework. A disciplined table.
2. Minimum evidence schema, per fragment:
    * id (content-addressed)
    * source / platform
    * source_url (permalink where applicable)
    * confidence_kind: observed | declared | inferred
    * occurred_at (when it happened in the world)
    * captured_at (when Business Brain saw it)
    * visibility: public | private | founder_only
    * payload (normalized content)
    * derived_from (nullable; non-null required when confidence_kind = inferred)
3. Website-fetch connector — no auth, real data, no review gate. First to build.
4. Upload connector — no auth, real artifacts only (not reconstruction).
5. Conversation → declared evidence path — the conversation writes declared fragments into the same store. This is the moat and it is cheap.
6. Recompute-on-read Business Model function — evidence[] → model. Recomputed on read. No reducer framework.
7. Per-belief provenance — every belief in the model cites the fragment IDs it was computed from. A belief with no cited evidence is invalid.
This is NOT full event-sourcing. This is the honest nucleus: append-only + provenance + observed/declared fusion + structural honesty, without the doctrine, orchestration, or reactivity that event-sourcing implies.
Structural honesty guarantee: an inferred fragment with an empty derived_from is schema-invalid. Fabrication is not discouraged by policy; it is unrepresentable by construction. This closes the M1 fabrication class at the type level.

3. Deferred items
Each is correct at scale and dead weight now. Each is deferred until a specific usage signal makes it necessary.
Item	Why deferred	Unlock signal	Risk if built too early
Full Source Orchestrator (scheduling, dedupe, backoff, idempotency workers)	Inline sequential connector calls suffice at single-digit connector count.	Connector count or sync frequency makes inline calls unreliable or slow.	Elaborate infrastructure managing three connectors; complexity with no payoff.
Incremental sync	Full sync of one founder (one site, hundreds of posts, one calendar) costs milliseconds and cents.	Full sync becomes measurably slow or expensive per founder.	A reducer/watermark framework to avoid a cost that doesn't exist yet.
Event-driven webhooks / reactivity	Founders sync roughly daily and won't notice a full rebuild.	A founder complains about latency, or a real-time use case is validated.	Reactive plumbing for updates nobody is waiting on.
Formal projection/reducer framework	The model is a cheap recomputed function; it doesn't need to be a formal projection yet.	Full recompute becomes a real, measured cost.	Freezing the softest concept (what evidence is) in the hardest-to-mutate substrate before it's understood.
Relational evidence graph (supersedes, corroborates, contradicts, cascades)	Not enough evidence yet for relationships to carry signal.	A real strategic feature needs a specific edge type.	A graph engine with too little data to reason over; premature schema lock-in.
Plugin SDK	An interface abstracted before the first connector is guesswork.	Extract from the third connector, not before.	Designing an SDK against imagined connectors, not real ones.
Large connector marketplace	Every connector is a permanent maintenance liability. Breadth before depth multiplies the maintenance war.	Real founder demand proves a specific source is where their business lives.	N-front maintenance war for one operator; connector rot with no usage.
Publishing / write-back actions	Business Brain must prove it understands before it acts.	Read-side understanding has earned demonstrated founder trust.	Acting on the world before understanding it; trust destroyed on first wrong action.
Instagram OAuth beyond starting app review	Read of founders' accounts needs Advanced Access + App Review (4–6 weeks). Building the full flow before approval is speculative.	Meta App Review approval clears.	Complete integration blocked behind a review queue; wasted build against an unapproved permission set.
Google / Drive / Calendar beyond minimal scopes	Broad Drive read is a restricted scope requiring an annual CASA security assessment.	A validated feature genuinely needs broader scope than drive.file + calendar.readonly.	Triggering a paid annual security audit and heavier review for access not yet proven necessary.
4. Forbidden items
Forbidden. Not deferred. These do not have an unlock signal (except where noted, publishing is deferred-with-approval, listed here for emphasis on the approval gate).
* Manual reconstruction as a founder workflow — permanently forbidden. This is the frozen principle, not a deferral.
* Intake questionnaires that ask founders to describe existing public content.
* Paste boxes for captions / posts as product UX.
* Third-party scraped-data resellers for LinkedIn / Instagram (e.g. resold-data APIs) — forbidden on honesty-brand grounds regardless of convenience.
* Fake "connected" states that render as connected but return no real data. Connection state must be honest: available → connecting → reading → empty/failed.
* Observed claims without source evidence — an observed fragment with no source is invalid.
* Inferred claims without derived_from evidence — schema-invalid.
* Founder psychology inferred from marketing outputs — a founder's fears, motives, or mental state must not be inferred from their public marketing. Marketing is what they broadcast, not who they are. Declared intent is the only valid source of founder psychology.
* Publishing / posting without explicit founder approval — no write-back action without a per-action, in-session founder yes.

5. Product consequence
Connect Your World becomes the first real product capability after authentication. Onboarding is authorization, not elicitation.
Founder-facing flow (frozen):


Account
  ↓
Connect Your World          (authorize real sources)
  ↓
Read connected sources      (honest connection states)
  ↓
Evidence store              (typed, provenance-bearing fragments)
  ↓
Business Model              (recomputed, traceable to evidence)
  ↓
Conversation                (surfaces model + captures declared intent)
  ↓
Gift / Week                 (first strategic value delivered)
The manual M1.5 harness remains internal only — a validation and testing tool. It is never surfaced as a founder workflow.

6. Technical consequence
The engine no longer consumes arbitrary pasted text as the product path. Pasted text survives only inside the internal harness.
Product path (frozen):


Connectors / uploads / conversation
  ↓
Evidence fragments          (typed: observed | declared | inferred)
  ↓
Business Model recompute    (evidence[] → model, per-belief provenance)
  ↓
Strategy
The engine only ever sees evidence. It never sees a connector, and it never sees raw pasted product input. Connectors and the conversation both emit evidence and nothing else.

7. Roadmap consequence
The next real milestone is renamed and scoped.
M2 — Connect Your World Nucleus
In scope:
* Website connector
* Upload connector
* Evidence store (append-only, minimum schema)
* Declared-intent capture (conversation → declared evidence)
* Business Model recompute (recompute-on-read, per-belief provenance)
* Meta App Review submission started in parallel (clock running, no dependent build)
Explicitly out of scope for M2:
* No full orchestration
* No persistence beyond the evidence + model storage this flow requires
* No publishing
* No OAuth build beyond starting Meta app review
* No incremental sync, no reactivity, no relational graph, no plugin SDK
Exit criteria: a real founder produces a real Business Model from at least Website + Upload, engages in conversation that writes declared intent back into the store, and the model demonstrably traces to its evidence. Instagram App Review submitted and pending.
Status of M1 / M1.5: complete. Retained as internal validation harness. Removed from the product roadmap.

8. Rationale
Why we are NOT building full event-sourcing now. Event-sourcing pays off when there is history to replay and high-frequency change to process incrementally. There are zero founders and no accumulated history. The headline benefit — re-projecting everyone's past when reasoning improves — is gated behind a founder base that does not yet exist. Meanwhile the costs are immediate: schema evolution becomes archaeology (immutable past events, upcasters, versioned deserializers) at exactly the moment the evidence schema is least understood and most likely to change. Adopting the doctrine now would freeze the softest concept in the hardest substrate.
Why append-only evidence is enough. Append-only + provenance captures every property that matters at this stage — no reconstruction, observed/declared fusion, traceability, and structural honesty (derived_from makes fabrication unrepresentable) — without the doctrine. An append-only, provenance-bearing table is the seed an event-sourced system germinates from. Building it now is not throwaway work; it is the nucleus. The orchestrator, reactivity, incrementalism, and the relational graph grow out of it later without discarding any of it.
Why the graph is retention, but reasoning and first-moment accuracy drive adoption. The evidence graph is a real retention asset: accumulated declared intent, resolved contradictions, and validated inferences cannot be re-derived from a fresh competitor sync. But a moat defends a castle that must first be occupied. Founders do not adopt a data structure — they adopt "this understood me in fifteen seconds and told me what to do." That first moment is the reasoning layer. Perfecting the retention machine for a product nobody adopts is the central failure mode this record guards against. The nucleus is deliberately small so that attention is available for reasoning and the first-moment.
Why this is the smallest build that preserves the five-year architecture without over-building. Every deferred item is correct at scale and dead weight now; each has an explicit unlock signal, so the architecture grows by evidence of need rather than by anticipation. The nucleus preserves all five durable properties of the destination architecture (no reconstruction, observed+declared fusion, provenance, structural honesty, conversation-as-moat) while omitting all the machinery that manages an asset not yet validated. Adopt the properties; refuse the doctrine.

9. Final lock
No further conceptual architecture redesign is permitted until all of the following are true:
* ≥ 10 real founder runs
* ≥ 3 real connected-source runs
* ≥ 1 founder completes Connect Your World → Business Model → Conversation end-to-end
Until those three conditions are met, the team may only implement, test, and learn. Specifically:
* Do not propose new abstractions.
* Do not rename the canonical artifact.
* Do not reopen Founder Model / Business Understanding / Business Graph discussions.
* Do not re-merge the reconstruction/declaration distinction.
* Do not soften the forbidden list under connector failure — a failed connector routes to the upload lane or an honest gap, never to reconstruction.
This record is locked. It is the reference the M2 build phase inherits. Reopening requires the unlock conditions above to be met and a superseding ADR (ADR-008+).

End ADR-007 — Connect Your World Nucleus — LOCKED.
