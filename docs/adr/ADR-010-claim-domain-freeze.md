# ADR-010 — Claim Domain Freeze

Status: Proposed (freeze candidate — revised twice through architecture review)
Date: 2026-07-25
Scope: Understanding → Knowledge-Model core (Claims). Architecture only — no implementation, persistence, migrations, services, or repositories beyond the frozen interface.

## Context

`Claim` was always intended as the Knowledge-Model core but was left greenfield. A prior Commit-9
implementation attempt was correctly BLOCKED: there was no frozen contract to implement against, and
inventing one inside an implementation commit would smuggle load-bearing domain design into "storage
mechanics only". This ADR freezes that contract.

Two review passes shaped the result:

- **Pass 1** removed `ClaimKind` (a false taxonomy — overlapping and non-exhaustive) and the `predicate`
  "bounded vocabulary" promise (false — no registry), replaced the multi-axis `ClaimBasis` with a narrow
  `ClaimOrigin`, and deferred `ClaimDeclarationLink`.
- **Pass 2** (final) removed `ClaimOrigin` too and selected the minimal **Candidate B**. This ADR records
  that final decision.

## Constitutional position

A Claim represents **only a proposition** — never truth, evidence, verification, confidence, recognition, a
founder declaration, evaluation, a recommendation, a correction, or a verdict. Claims must remain
**evaluable later**, so no evaluation may live on the Claim. Every field must answer exactly one of: what
proposition was recorded, what it is about, what value it asserts, or what immutable operational metadata
belongs to its creation.

## Why `ClaimOrigin` was removed (final decision)

`ClaimOrigin = 'system_derived' | 'founder_authored'` failed the retention rule on almost every count:

- **Not one axis.** `founder_authored` answers *who authored the underlying assertion*; `system_derived`
  answers *what process produced the Claim*. Two different axes.
- **Not mutually exclusive.** A founder declaration from which the system extracts a structured Claim is
  *both* founder-authored (assertion) and system-derived (process).
- **`system_derived` is a grab-bag and non-exhaustive.** Extraction-from-declaration, inference-from-many,
  extraction-from-document, computation-from-metrics, external-generation, and normalization all collapse to
  one uninformative value, and *operator-manually-entered* fits neither value.
- **Duplicates FounderDeclaration and asserts untraceable provenance.** FounderDeclaration is already the
  founder-authored assertion and preserves the founder's actual wording (`.statement`); a Claim has no free
  text. The Declaration→Claim conversion (when / automatic-or-explicit / which component) is undefined by
  frozen contracts, and with the linkage contracts deferred a `founder_authored` claim could not be traced
  to any declaration. Encoding authorship on the Claim asserts provenance the contract cannot substantiate.
- **Would need reinterpretation.** Real provenance is many-to-one and multi-step; a single lossy enum would
  be reinterpreted the moment provenance is designed.

Authorship, source, and derivation are therefore **not fields on Claim**. They belong to future immutable
**provenance records** that reference a Claim (by id) without mutating it — allowing multiple sources,
multiple derivation steps, declaration linkage, and external linkage, none of which a single enum could
carry honestly.

## Alternatives considered

- **Candidate A (corrected triple with `origin`)** — rejected in pass 2 for the reasons above.
- **Candidate B (minimal proposition, no origin)** — **SELECTED.** States only "the system recorded this
  proposition, for this business, at this time." Sufficient for the first (storage) lifecycle, which is
  append-only/business-scoped/idempotent/ordered reads — none of which needs origin. Provenance is additive
  later with zero migration pressure on Claim (new records reference Claim; Claim never changes).
- **Candidate C (proposition + separate origin record now)** — deferred: freezing provenance records before
  Evidence/derivation flows exist would guess their shapes.

## Frozen facts

### Claim v1

```ts
type ClaimId = string;
type ClaimObject = string | number | boolean;   // null excluded

interface Claim {
  readonly id: ClaimId;
  readonly businessRef: SubjectRef;
  readonly subject: SubjectRef;
  readonly predicate: string;
  readonly object: ClaimObject;
  readonly recordedAt: Timestamp;
}
```

- **Proposition envelope.** Exactly ONE atomic ATTRIBUTE assertion "subject has predicate = object" (object a
  scalar). **Supported:** unary attribute propositions. **Not supported in v1** as first-class structure:
  relations between two subjects, comparisons, quantified/conditional/temporal/negative/causal propositions.
- **`predicate`.** At the type level an **arbitrary string** — TypeScript cannot enforce non-emptiness or
  "not prose". By convention a stable, opaque predicate key; non-emptiness and shape are **application-level
  validations**. Identity is exact and case-sensitive. No registry in v1.
- **`object`.** A single scalar; `null` excluded (absence is an **Unknown**, not a Claim). Strings are
  arbitrary at the type level; producers use scalar-like values by convention, not prose. Arrays/objects
  excluded (atomicity). A `SubjectRef` may not be an object → relational claims are out of v1. Numbers are
  unitless (unit lives in the predicate). **Atomicity:** one `(subject, predicate, object)` per Claim.
- **`recordedAt`.** ONLY "when the system recorded this Claim record" — server-owned, immutable, **not** event
  time, **not** truth-validity time, **not** repository ordering (ordering is a separate persistence-internal
  append sequence, not a `Claim` field).

### Repository

```ts
interface ClaimRepository {
  append(businessRef: SubjectRef, claim: Claim): Promise<void>;
  byId(businessRef: SubjectRef, id: ClaimId): Promise<Claim | null>;
  history(businessRef: SubjectRef): Promise<readonly Claim[]>;
  bySubject(businessRef: SubjectRef, subject: SubjectRef): Promise<readonly Claim[]>;
}
```

Append-only (no update/delete/supersede/resolve). Non-evaluative reads only (no latest/current/effective/
accepted/valid/verified/strongest/supported/contradicted/resolved). `history`/`bySubject` return every match
in **append order** (persistence sequence, not `recordedAt`). Port-level idempotency: idempotent by
`(businessRef, id)` for identical content, divergent reuse of an id must fail loudly — **no `clientEventId` on
`Claim` or in the port** (command idempotency is an application concern for the storage commit).

### Business scope

`Claim` carries `businessRef` and `append` takes `businessRef`; the frozen precondition is
**`businessRef === claim.businessRef`** and an implementation MUST reject a mismatch. All reads are scoped to
their `businessRef` argument; cross-business ids behave as not-found and reveal nothing. Storage identity is
composite `(business_ref, id)`. `SubjectRef` (type `'business'`) is the established scope type; no new type.

## Deferred

Provenance / authorship / source / derivation; `ClaimDerivation` / `ClaimSourceLink` /
`ClaimDeclarationDerivation` / `ClaimDeclarationLink` / `ClaimEvidenceLink`; Evidence and Examiner contracts;
relation / comparison / causal / quantified / temporal / negative proposition forms; a predicate registry or
branded `PredicateKey`. All future, separately-frozen; each references Claim without mutating it.

## Prohibited (never on Claim)

Status; confidence/certainty; truth/verdict; verification; evaluation/score/strength; recognition or
declaration state; mutation; supersession/lineage; latest/current-truth read semantics; evidence ids or
examiner results.

## Relationship to other lanes

FounderDeclaration (a founder's assertion, wording preserved) ≠ Claim (a system-recorded proposition, no
authorship field). Recognition/Review/Presentation are orthogonal snapshot-lane events. Evidence attaches via
a future link; Examiner reads claims + evidence and emits evaluation as a **separate** record; Audit is
downstream. **The minimal information a future Examiner needs from a Claim** is the proposition (`subject`,
`predicate`, `object`) — nothing evaluative and no provenance is required on the Claim itself.

## Future widening rules

Widening `ClaimObject`, introducing a proposition structure / relation model, adding a predicate registry, or
freezing any provenance/link record is a deliberate, ADR-recorded decision that references Claim and never
mutates it — never an incidental change.

## Consequences

- A future "Claims storage" commit implements `ClaimRepository` (append-only, `FOR UPDATE` per-business append
  sequence, application-level business-scoped `clientEventId` idempotency, migration, tests) against this
  frozen contract — the mechanics proven in Commits 5–8.
- `shared/types.ts` gains `ClaimId`; the understanding barrel additively exports `Claim`, `ClaimObject`,
  `ClaimRepository`. No existing contract is modified.
