# ADR-010 — The Two-Layer Architecture: Truth Engine and Product Primitives

**Status:** Accepted — permanent architectural decision.
**Relationship to prior ADRs:** Establishes the layer that ADR-007 (Honesty) sits within. Does not modify ADR-007. Governs how ADR-008 (Roadmap) capabilities are expressed.

---

## Context

Business Brain must protect truth absolutely and must grow in founder-facing capability for years. These two needs pull in opposite directions: protecting truth wants a small, frozen, unchanging core; growing capability wants freedom to add new behaviors. Attempting to satisfy both inside a single layer forces the honesty model to absorb every new behavior, and it erodes.

This ADR resolves that by separating the two needs into two layers, with a strict rule binding them.

---

## Decision

Business Brain consists of two architectural layers.

### Layer 1 — The Truth Engine

Layer 1 is defined by ADR-007. It is responsible only for epistemology: the truth status of every claim.

Its concepts are exactly: **observed**, **declared**, **inferred**, and the **epistemic ceiling** that binds them.

Layer 1 exists solely to protect truth. It remains as small and as stable as possible. It does not describe founder-facing behavior. New founder-facing needs never justify a change to Layer 1.

### Layer 2 — Product Primitives

Layer 2 is responsible for founder-facing behavior — what Business Brain does with the founder. Its members are **product primitives**: Observation, Question, Challenge, Recommendation, Experiment, and future primitives including Action.

Every product primitive is **composed from Layer 1** and may add a **behavioral contract** — obligations on how it behaves (for example: mandatory disclosure, a measurable outcome, a reversibility gate). A product primitive is defined by which epistemic kinds it composes plus the behavioral contract it adds.

### The rule binding the layers

A product primitive **may** compose Layer 1 epistemic kinds and **may** add behavioral contracts.

A product primitive **may never** introduce a new epistemic kind, and **may never** weaken the honesty model.

Therefore **honesty is inherited by construction**: a product primitive can be no looser than the epistemic kinds it is built from, and those never loosen. A primitive is honest because the layer beneath it is, and because it adds only duties, never exemptions.

---

## Recommendation — the first product primitive

Recommendation demonstrates the architecture.

- **Internal (Layer 1):** it is inference — an `inferred` claim, governed by ADR-007 like all inference.
- **External (Layer 2):** it is the Recommendation primitive: inference drawing on external business patterns, under a behavioral contract of **mandatory disclosure** — it must declare, in the founder's language, what it rests on, what it assumes, and its confidence.

This is how a recommendation remains honest: it is inference (Layer 1) plus a disclosure duty (Layer 2). It is never voiced as observed or declared fact. Its honesty is inherited from the inference it composes; its disclosure duty is added, not subtracted from the truth layer.

Recommendation is not special. It is the first primitive to prove that Layer 2 can deliver a new founder-facing behavior — the ability to advise, resolving the tension between honesty and building — without touching Layer 1.

---

## Consequences

The Truth Engine is frozen. ADR-007's four concepts do not grow. Because founder-facing behavior lives in Layer 2, product pressure never forces a change to the truth layer.

Product capability grows freely. New primitives are added at Layer 2 as compositions of the fixed epistemic kinds plus behavioral contracts. Future capabilities — including Action (Capability D) — enter as product primitives, not as changes to epistemology; an Action is a Recommendation composed with execution and a reversibility gate, honesty inherited throughout.

Honesty cannot erode. There is no place at Layer 2 to weaken Layer 1, because primitives may only add duties, never remove the guarantees they inherit. The dangerous layer is frozen; the evolving layer is sealed against weakening the frozen one.

Compositions are auditable. A primitive is honest if it composes only from honest primitives and adds only behavioral duties. Honesty is verifiable by construction rather than by inspection of each new behavior.

---

## Invariants (permanent)

1. Layer 1 is ADR-007 and contains only: observed, declared, inferred, epistemic ceiling.
2. Layer 1 does not grow to accommodate founder-facing behavior.
3. Every product primitive is composed from Layer 1 and may add behavioral contracts.
4. No product primitive may introduce a new epistemic kind.
5. No product primitive may weaken the honesty model; primitives add duties, never exemptions.
6. Honesty is inherited by construction, from Layer 1 upward.
7. Recommendation is a product primitive: inference + external patterns + mandatory disclosure. Its truth status is `inferred`; it is never voiced as fact.

---

*ADR-010 establishes the two-layer architecture: a frozen Truth Engine (ADR-007) beneath a growing set of Product Primitives composed from it. Truth is protected by being small and stable; capability grows by composition above it; honesty is inherited and cannot erode. This is the structure within which every future capability is expressed.*
