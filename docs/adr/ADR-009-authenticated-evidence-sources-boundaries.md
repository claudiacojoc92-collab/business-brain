# ADR-009 — Authenticated Evidence Sources: Architectural Boundaries

**Type:** Product Governance / Architecture Decision Record
**Status:** 🔒 LOCKED
**Date:** 3 July 2026
**Owner:** Claudia Cojoc (Founder / Head of Product)
**Applies to:** Capability A (Connect Your World) — the authenticated evidence sources within it
**Relationship to prior records:** Governed by and consistent with ADR-007 (Connect Your World Nucleus, LOCKED) and ADR-008 (Product Capability Roadmap, LOCKED). Elaborates the internal structure of Capability A that ADR-008 froze; does not modify ADR-007 or ADR-008.
**Location:** Business Brain — Product Governance / Architecture Decisions

---

## 0. Why this record exists

Authenticated infrastructure is not a product capability. It is architecture in service of evidence sources — and this document exists to freeze the permanent boundaries that keep it that way.

Capability A (Connect Your World) is Business Brain's perception organ, and per ADR-008 it continuously gains evidence sources without ever being "finished." Some of those sources require authentication (an OAuth handshake, a stored credential) and some do not. Website and Upload — the two production sources today — require none.

As authenticated sources arrive, they introduce concerns the unauthenticated sources never did: credentials, live external APIs, and the temptation to build shared machinery. This ADR does **not** introduce a new capability. It defines the **permanent architectural boundaries** for authenticated evidence sources inside Capability A — the rules that keep the authenticated infrastructure from eroding the architecture, coupling to the engine, leaking credentials, or growing into something with a life of its own.

This record governs *boundaries*, not *implementation*. It contains no OAuth design, no provider registry, no credential-vault architecture, no Google-specific detail, no synchronization design. Those are the province of the code and the per-provider Capability Specs written under this ADR. What follows is only what must be true **forever**, regardless of which providers exist or how they are built.

All honesty semantics — evidence typing, the three-layer gate, provenance, fail-closed resolution, the epistemic ceiling — remain governed by **ADR-007** and the **Evidence & Trust Model**, unchanged. This ADR references them; it does not restate or extend them.

---

## 1. Framing principle

**The authenticated infrastructure exists solely in service of evidence sources.**

It has no independent purpose, roadmap, product surface, or scope of its own. Every capability it gains must be demanded by an actual evidence source — never by the infrastructure's own ambition.

This is the lens through which the invariants below are read. It is not itself an invariant about providers or build process; it is a constraint on the *nature* of the infrastructure. Its purpose is permanent: to prevent the authenticated layer from accreting responsibilities, abstractions, or scope that no real provider requires, and thereby drifting into a standalone "platform" disconnected from Capability A. Infrastructure that grows only from real provider demand stays architecture in service of perception. Infrastructure that grows from its own ambition becomes an empire, and this framing principle forbids that permanently.

---

## 2. Permanent invariants

The following five invariants are permanent architectural boundaries for authenticated evidence sources. Each is governance because each is cross-provider and durable: it constrains every authenticated source that will ever exist, and it would remain necessary even if the honesty model (ADR-007) were removed — because each is a rule of *architecture, credential safety, autonomy, or build discipline*, not of honesty.

### Invariant 1 — Both kinds of source are first-class

Authenticated and unauthenticated evidence sources are both **first-class members of Capability A**. Neither is a special case of the other. Requiring authentication does not make a source more central; requiring none does not make a source lesser. Capability A is evidence sources; some authenticate and some do not.

### Invariant 2 — Bypass

Unauthenticated sources (Website, Upload, and any future unauthenticated source) **permanently do not depend on authenticated infrastructure.** They do not route through it, are not blocked by it, and are unaffected by its presence, absence, or failure. The authenticated infrastructure serves *only* the sources that authenticate; it is never in the path of a source that does not.

### Invariant 3 — Authenticated providers are connectors under the existing contract

Authenticated providers are connectors under the **existing connector contract**. They extend it — the contract's authorization step becomes a real authenticated handshake rather than a no-op — and they obey it in full: **a connector's only output is typed evidence.** An authenticated provider never calls the engine, never computes the Business Model, and never reaches downstream of the evidence store. It emits evidence and nothing else.

This boundary is inherited (it governs every connector, per the connector architecture), and it is restated here for one reason: authenticated providers hold credentials and speak to live APIs that return structured, business-shaped responses, and are therefore uniquely tempted to violate it. That temptation is exactly why the boundary must be permanent governance for this class. No authenticated provider invents a parallel provider framework; every authenticated provider is a connector.

### Invariant 4 — Credential containment

Credentials are **access, not information.** A credential (an OAuth token, a refresh token, any secret used to reach an external source) never becomes evidence, never enters the evidence store, never appears in provenance or any founder-facing output, and is never logged or echoed. Credentials live only in credential storage and cross into no other plane of the system.

This invariant governs a thing that did not exist before authenticated sources — there was no token to contain until a source required one — which is why it can live in no earlier record. It is the clearest reason this ADR must exist.

### Invariant 5 — Autonomy boundary

Authenticated read happens **on a founder's action or an explicit refresh only.** Background synchronization, scheduling, and autonomous re-perception are **excluded** from authenticated-read and are **not** part of the boundaries this ADR permits.

They are excluded because autonomous re-perception — Business Brain reading a source without the founder present — edges toward the autonomous-action frontier that **ADR-008 gates as Capability D.** Autonomous synchronization is therefore available only through a **future, separately-gated sub-capability**, opened deliberately under its own governance. It is never introduced by a provider quietly adding a scheduler, and it never enters authenticated-read by attrition. The escape valve exists (open the gated sub-capability); the erosion path does not.

### Invariant 6 — Emergence, with commitment to extract

Shared authenticated infrastructure **emerges incrementally from real providers, beginning with Google as the first proving provider.** It is built minimally — only what a real provider actually requires — and no shared abstraction is designed against providers that do not yet exist.

This is a permanent build-discipline rule, and it carries an obligation: once multiple real providers (the second and third) have revealed what is genuinely reusable, the shared infrastructure **must be extracted** into shared form. Extraction is deferred until real providers prove the shape — it is **not optional.** Emergence is not a license for permanent duplication; it is a discipline that defers generalization until it is evidence-based, and then requires it.

*(Google is named here as the historical first instance, not as the subject of the rule. The permanent principle is emergence from real providers; Google is where that sequence begins. The rule survives Google's eventual irrelevance because its subject is the principle, not the provider.)*

---

## 3. Governed elsewhere — by reference, not restatement

The following are **not** restated in this ADR because they are already permanent governance, and duplicating them would create drift:

- **All honesty semantics** — evidence typing (`observed` / `declared` / `inferred`), the three-layer honesty gate, provenance, fail-closed resolution, and the epistemic ceiling — are governed by **ADR-007** and the **Evidence & Trust Model**, unchanged. Authenticated sources are bound by them identically to unauthenticated sources. An authenticated source asserts nothing that an unauthenticated source could not; the honesty plane does not change because a source authenticates. This ADR **references** that governance and adds nothing to it.
- **The capability roadmap and the loop model** — the four arcs, the loop-not-pipeline principle, and the demand-pulled ordering of evidence sources — are governed by **ADR-008**, unchanged. This ADR does not reorder providers, does not prioritize sources, and does not freeze which authenticated source comes when; source ordering remains demand-pulled per ADR-008.
- **The connector contract itself** — the standard connector methods and the connector→evidence boundary — is the existing connector architecture. This ADR extends its *scope* to authenticated providers (Invariant 3); it does not redefine the contract.

---

## 4. What this record freezes, and what remains intentionally emergent

**Frozen (permanent):**
- The framing principle: authenticated infrastructure exists solely in service of evidence sources, with no independent purpose, roadmap, product surface, or scope.
- The six invariants: both-kinds-first-class, bypass, connectors-under-the-existing-contract, credential containment, autonomy boundary, and emergence-with-commitment-to-extract.
- The cession of all honesty semantics to ADR-007 by reference.

**Intentionally NOT frozen (emergent — by design):**
- The **shape of the shared authenticated infrastructure** — its internal structure, any registry, any credential-storage design, any capability model. These are extracted from real providers (Invariant 6) and frozen, if ever, only after they have been proven across multiple providers. Freezing them now would be designing against providers that do not yet exist.
- **Any provider's specifics** — Google's (or any provider's) scopes, authorization details, evidence extraction, and internal risk gates belong in that provider's **Capability Spec**, not here.
- **The autonomous-synchronization sub-capability** — its scope and design are deferred to its own future gated governance (Invariant 5); this ADR only excludes it from authenticated-read and names where it must be decided.
- **Provider order and priority** — which authenticated source is built when remains demand-pulled per ADR-008.

---

## 5. Lock

This record is the frozen set of permanent architectural boundaries for authenticated evidence sources inside Capability A. Future authenticated-source work is built within these boundaries and within the honesty governance of ADR-007.

Reopening the boundaries or the framing principle requires a superseding record (ADR-010+). Building an authenticated provider under these boundaries, extracting the shared infrastructure once real providers reveal its shape, and opening the autonomous-synchronization sub-capability through its own gate are the **normal operation** of this frozen ADR — they do not require reopening it.

The immediate next step, when initiated, is the first authenticated provider's **Capability Spec** — Google as the proving provider — written under this ADR and run through the frozen capability process. That spec, not this record, is where implementation begins. No implementation is planned or authorized by this ADR.

---

*Governed by ADR-007 (LOCKED) and ADR-008 (LOCKED). Boundaries, not implementation. Infrastructure in service of evidence sources; credentials contained; autonomy gated; the shape emergent; honesty unchanged and referenced, never restated.*
