# Strategic Execution Boundary — database lineage-integrity audit (2026-07-21)

Third acceptance pass. The application layer now scopes execution-report chains correctly by
`(founder_id, plan_id, subject_type, subject_id)` (revision-scoped, V084). This audit asks a narrower,
lower-level question: **does the database itself independently prevent a predecessor from pointing outside its
canonical chain?** — regardless of what the routes and repository validate.

## Method
The live dev schema (`business.execution_report`) was inspected for every constraint, index, and trigger, and then
**probed empirically** with direct SQL `INSERT`s that bypass the routes, the domain constructors, and the repository —
each inside a transaction that was rolled back (zero residue confirmed). "DB-enforced" means the raw `INSERT` was
rejected by PostgreSQL; "application-only" means the raw `INSERT` succeeded even though the application would reject the
equivalent request.

## Prior database surface (V083 + V084)
- **Table** `business.execution_report` — PK `id`; columns incl. `founder_id`, `subject_type`, `subject_id`,
  `plan_logical_id`, `plan_id`, `plan_revision`, `report_sequence`, `predecessor_report_id` (nullable `TEXT`),
  `report_kind`, `execution_state`, …
- **Foreign keys:** **none** (0). `predecessor_report_id` is an unconstrained `TEXT` column — it does not even
  reference `execution_report(id)`, let alone the same chain.
- **CHECK constraints:** `exr_subject_type_enum`, `exr_kind_enum`, `exr_state_enum`, `exr_sequence_positive`
  (`report_sequence > 0`), `exr_sequence_predecessor_shape`
  (`(seq=1 AND predecessor IS NULL AND kind='REPORT') OR (seq>1 AND predecessor IS NOT NULL)`).
- **Unique indexes:** `uniq_exr_chain_sequence (founder_id, plan_id, subject_type, subject_id, report_sequence)`
  (V084, revision-scoped) · `uniq_exr_predecessor (founder_id, predecessor_report_id) WHERE predecessor IS NOT NULL`
  (no-fork) · `uniq_exr_founder_idempotency (founder_id, idempotency_key)`.
- **Effective index:** `idx_exr_effective (founder_id, plan_id, subject_type, subject_id, report_sequence DESC)`.
- **Triggers:** `exr_no_update` (BEFORE UPDATE → always raises) · `exr_no_delete` (BEFORE DELETE → raises unless
  `bb.allow_execution_report_delete='on'`).
- **Advisory lock:** repository-side `pg_advisory_xact_lock(hashtext(founder:plan.id:subject))` — **application code, not
  a database structural guarantee.**

Each existing structural guard and exactly what it prevents:
- `exr_*_enum` — a value outside the bounded subject-type / kind / state vocabularies.
- `exr_sequence_positive` — a zero or negative sequence.
- `exr_sequence_predecessor_shape` — a sequence-1 row that is not a null-predecessor REPORT, **and** a sequence>1 row
  with a null predecessor. (So a CORRECT/WITHDRAW with a null predecessor, and a sequence-1 row bearing a predecessor,
  are both already DB-rejected.)
- `uniq_exr_chain_sequence` — two rows sharing a sequence number **within one revision-scoped chain**.
- `uniq_exr_predecessor` — two children of the same predecessor **for one founder** (no-fork).
- `uniq_exr_founder_idempotency` — a replayed idempotency key.
- `exr_no_update` / `exr_no_delete` — any UPDATE, and any DELETE outside governed account deletion (append-only).

## The gap
None of the above verifies that `predecessor_report_id` refers to a row in the **same canonical chain**. There is no
foreign key, and no trigger loads the predecessor to compare identity or sequence. Chain-identity matching and sequence
adjacency are enforced **only** by the routes/repository.

## Empirical probe (direct SQL, routes/repo/domain bypassed, all rolled back)

| # | Question (direct SQL) | Result | DB-enforced? |
|---|---|---|---|
| 1 | Can a Revision-2 row reference a Revision-1 predecessor? | **INSERT succeeded** | ❌ no (app-only) |
| 2 | Can a subject-B row reference a subject-A predecessor? | **INSERT succeeded** | ❌ no (app-only) |
| 3 | Can founder B reference founder A's predecessor? | **INSERT succeeded** | ❌ no (app-only) |
| 4 | Can sequence 4 reference predecessor sequence 1 (non-adjacent)? | **INSERT succeeded** | ❌ no (app-only) |
| 5 | Can a CORRECT/WITHDRAW be inserted with no predecessor? | rejected by `exr_sequence_predecessor_shape` | ✅ yes |
| 6 | Can sequence 1 have a predecessor? | rejected by `exr_sequence_predecessor_shape` | ✅ yes |
| 7 | Can sequence 2 have no predecessor? | rejected by `exr_sequence_predecessor_shape` | ✅ yes |
| 8 | Can a non-REPORT event be the sequence-1 (initial) event? | rejected by `exr_sequence_predecessor_shape` | ✅ yes |
| 9 | Can two children reference the same predecessor (fork)? | rejected by `uniq_exr_predecessor` | ✅ yes |
| 10 | Can application validation be bypassed by a direct insert? | **yes for 1–4** | ❌ (gap) |

(Attacks 1–4 each produced `INSERT 0 1`; the transaction was rolled back and a residue count of 0 confirmed. Attack 4's
first run was incidentally caught by the fork guard because it reused an already-consumed predecessor; re-run with a fresh
predecessor, sequence 4 → sequence 1 inserted successfully — proving adjacency is not DB-enforced. The initial-CORRECT
probe was correctly rejected by `exr_sequence_predecessor_shape`.)

## Classification

**B — Some lineage invariants are database-enforced (append-only, sequence shape, positive sequence, bounded enums,
per-chain sequence uniqueness, no-fork, idempotency), but chain-identity matching of the predecessor — same founder, same
exact Plan revision, same subject, and sequence adjacency — is application-only.**

## Required closure (V085)
The database must independently reject any predecessor that is not `child.report_sequence - 1` within the identical
`(founder_id, plan_id, subject_type, subject_id)` chain, without weakening append-only, no-fork, revision-scoped sequence
uniqueness, account-deletion, or export completeness. See the V085 remediation and Laws 1–9 in the governance contract.
