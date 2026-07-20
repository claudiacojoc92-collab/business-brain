# Recommendation Provenance Integrity — Governance Contract

**Status: FROZEN.** Governs how a Strategic Recommendation's grounded references are produced, validated, persisted,
displayed, and exported. Resolves **KA-1** from [ADR-011](../adr/ADR-011-knowledge-architecture.md) §6/§11. Written and
committed *before* implementation. Companion architecture record:
[`recommendation-provenance-integrity-slice.md`](../architecture/recommendation-provenance-integrity-slice.md).

## Why

A recommendation cites grounded references (business-understanding conclusions, public-positioning findings/entities,
founder-strategic-context items). Today those references are **carried verbatim from model output** — the model's
`refId`/`entityId`/`logicalItemId`/`sourceUrl` are trusted without a write-time check. Before a recommendation can safely
inform a future Strategic Decision, every displayed or persisted grounded reference must be typed, resolvable,
founder-isolated, version-exact where applicable, historically stable, restricted to IDs actually supplied to the model,
and safe for export and historical reconstruction.

## The twelve laws

### Law 1 — Model output is not provenance
A string emitted by the model does not become grounded provenance merely because it *looks* like a valid ID. Grounding
is conferred only by deterministic validation against what the model was actually given.

### Law 2 — Input-bounded references
The model may reference only the entities and **exact versions supplied in the strategy input contract** for that
session (the provenance manifest). A target that exists elsewhere in the founder's account but was **not part of the
assembled input** for this session is invalid.

### Law 3 — Exact historical identity
Where a target is versioned, the recommendation must resolve to the **exact immutable version** used during generation.
A logical id without its version is insufficient unless the id is itself immutable and version-specific. *(Audit result:
business-understanding conclusions, positioning findings/entities, and founder-strategic-context item ids are all
immutable ULIDs; conclusion + finding + entity ids are globally unique; founder-strategic-context references additionally
carry `logicalItemId` + `version`. Business-understanding conclusion references are scoped by the session's snapshotted
`understandingVersion`.)*

### Law 4 — Founder isolation
A reference must never resolve across founder boundaries. A syntactically valid cross-founder id is invalid. The manifest
is built only from the session founder's assembled input, so cross-founder ids are rejected by construction.

### Law 5 — Resolved or ungrounded
Every model-produced statement is exactly one of: (a) **grounded** by a validated reference; (b) **explicitly unsupported
model reasoning** (no grounding claim); (c) **rejected** from the durable contract. There is no intermediate state in
which an unresolved reference is displayed as grounded.

### Law 6 — No silent substitution
An invalid reference must never be silently replaced with a newer version, the current effective version, a
similarly-named item, another founder-owned item, a broader source document, or a different reference of the same kind.
Invalid references are **removed**, never swapped.

### Law 7 — Historical stability
A recommendation viewed later resolves to the **same** historical records that influenced it when generated. Later
revision, supersession, retirement, expiration, or exclusion-from-effective-state must not rewrite a retained session's
provenance. (Account deletion remains destructive — it removes the founder's records entirely.)

### Law 8 — Visible bounded degradation
When invalid references are removed, no language may remain that falsely claims grounding. This slice's **bounded
behavior** (documented, deterministic): invalid grounded references are **removed**; surviving validated references are
marked grounded; **if the recommendation retains no validated grounded reference, the outcome is downgraded to
`INSUFFICIENT_STRATEGIC_EVIDENCE`** (the existing "no grounded basis" terminal outcome). Partial statement-level grounding
is not faked: because references are the citation unit (the prose does not inline-cite), removing an invalid citation
does not leave a dangling grounding claim; if grounding collapses, the whole outcome degrades. A grounding failure is
never masked.

### Law 9 — Deterministic validation
Reference resolution and validation are deterministic application behavior, not another LLM judgment. No semantic or
name-based matching.

### Law 10 — Export fidelity
Export distinguishes validated grounded references from unsupported model text, records the recommendation schema
version and the grounding status, and **never** exports an unresolved reference as valid provenance. (Because invalid
references are removed before persistence, the persisted/exported recommendation contains only validated references; a
redacted rejection summary — kind + reason, never the raw invalid id — records that grounding was rejected.)

### Law 11 — No new memory
Validating provenance creates no Business Understanding, Public Positioning Context, Founder Strategic Context, Strategic
Decision, Commitment, Plan, Execution, or Strategic Memory. It only classifies existing references.

### Law 12 — Constitutional supremacy
When preserving a fluent answer conflicts with provenance integrity, **provenance integrity wins**. The test:
**"Does this serve the founder's clarity and sovereignty, or the product's hold?"** A fluent answer with fabricated
grounding serves the product's hold; a degraded-but-honest answer serves the founder.

## Scope boundary

This slice validates the grounded references of the existing `PRIORITY_DECISION` recommendation. It does **not** build
generic citation infrastructure, reconcile the legacy `memory.*` schema (KA-2), add Strategic Decision Memory,
Commitments, Plans, Execution, agents, market discovery, or Founder Conversation. `ACCEPT` semantics are unchanged
(writes no context/memory). The frozen engine is untouched.
