# Founder Experience Compression — UX audit + deliverable (2026-07-22)

A PRODUCT slice, not a governance slice. No new domain object, table, migration, or constitutional change. It proves the
five frozen slices (Promotion Gate, Consumption Gate, Execution Boundary, Outcome Review Boundary, Origination Gate) form
ONE coherent founder experience. Every accepted guarantee — founder sovereignty, Withheld Verdict, Returned Leap, Named
Unknown, Bounded Claims, No Manufactured Need, Explicit Promotion, Explicit Learning Admission — is preserved; only the
VISIBLE surface is compressed and de-jargoned. Domain + API + DB language unchanged.

## Part 2 — UX audit (before)

Founder journey from a Strategic Recommendation to a future recommendation influenced by a promoted learning, as the code
renders it (`apps/web/src/strategy/StrategyPage.tsx`):

| # | Screen / interaction | Why the founder does it | Preserves guarantees? | System could do it safely? | Cognitive load | Class |
|---|---|---|---|---|---|---|
| 1 | Ask box → pick a frozen snapshot → "Reason it through" | Consumption Gate: reason over frozen context | yes (Consumption Gate) | partly — but snapshot CHOICE is the guarantee | medium (exposes "snapshot") | Essential (reword) |
| 2 | Read recommendation (call/why/evidence/unknowns/alternatives/next step) | Withheld Verdict, Named Unknown, Bounded Claims | yes | no — must be founder's read | low | Essential |
| 3 | "Save my read" (ACCEPT/QUALIFY/REJECT/…) | Founder sovereignty on the recommendation | yes | no | low | Essential |
| 4 | "Record a decision" (separate act) | Decision ≠ read | yes | no | low | Essential |
| 5 | "Create a commitment from this decision" | Commitment ≠ decision | yes | no | low | Essential |
| 6 | "Create a plan" / "Activate this plan" | Plan = intention | yes | no | low | Essential |
| 7 | Execution: "Add execution report" (state + statement + evidence) | Execution Boundary: founder testimony | yes | no | low | Essential |
| 8 | Outcome review: **"Create context snapshot"** (separate click) then select it | binds the review to frozen context | yes | **yes — snapshot creation "changes nothing, regenerates nothing"** | medium (exposes "snapshot") | **Architectural leakage** |
| 9 | Outcome review form (observed outcome + statement + unknowns) | Outcome Review Boundary | yes | no — founder's account | medium (reads like a form) | Essential (reframe) |
| 10 | **"Propose a learning candidate"** + rich form (statement, own words, before/now/changed, unknowns, contradictions, observations, category/scope/epistemic status) | Origination Gate: a proposal | yes | no | **high** (word "candidate"; many fields) | Helpful (reword + disclose) |
| 11 | Candidate card shows **"rev N"**, **provenance ids/hashes/snapshot**, **Adopt/Reject/Defer/Withdraw** | revisioned proposal + four-way judgment | yes | no | **high** (rev ids, hashes, "Adopt") | **Architectural leakage** (progressive disclosure) |
| 12 | Judgment: **Adopt / Reject / Defer / Withdraw** | Explicit Learning Admission | yes | no — must be explicit | medium (jargon verbs) | Essential (reword) |
| 13 | Learnings list: **"Refine / Contest / Supersede / Retire"** + **"Promote to Business Understanding / Founder Strategic Context"** | lifecycle + Explicit Promotion | yes | no — promotion must be explicit | high (jargon; "Promote"; rev ids) | Essential (reword) |
| 14 | Promotion form: "Promote to Business Understanding", **"Create Promotion Event"**-style copy | Explicit Promotion | yes | no | medium | Essential (reword by purpose) |
| 15 | Future recommendation reasons over a snapshot that now includes the promoted learning | closes the loop | yes | yes (automatic on next snapshot) | low | Essential |

**Findings.** Every interaction that carries a constitutional decision (read, decide, commit, plan, report, review, keep,
promote) is **Essential** and stays. The **leakage** is in *wording* and *noise*, not in required decisions: the explicit
outcome-review snapshot click (8), the exposed revision ids / hashes / provenance on the candidate card (11), and the raw
governance verbs "candidate / Adopt / Reject / Defer / Promote" (10, 12, 13, 14). Two interactions can be **merged/removed**
without weakening anything: the separate "Create context snapshot" in the review flow (auto-mint underneath), and the
"details" noise (collapse behind progressive disclosure).

## Part 13 — Deliverable

### 1. Founder journey (before)
Ask → pick snapshot → reason → read → save read → record decision → create commitment → create plan → activate plan →
add execution report → **create context snapshot** → select snapshot → record outcome review → **propose a learning
candidate** (rich form) → read candidate card with rev ids + hashes → **Adopt / Reject / Defer / Withdraw** → (learnings
list) **Refine/Contest/Supersede/Retire** + **Promote to Business Understanding / Founder Strategic Context**.

### 2. Founder journey (after)
Ask → pick a frozen view → reason → read → save read → record decision → create commitment → create plan → activate plan →
add execution report → record outcome review (snapshot minted underneath) → **see a possible learning** → collapsed card:
*what it suggests · appears true when… · still unknown…* → **Keep / Not yet / Discard** → (kept learnings) same lifecycle,
now labelled by purpose → **"Let future decisions use this" / "Apply to your whole strategy"**. "Show the full record"
reveals every provenance id, revision, hash, contradiction — nothing is hidden, only quieter.

### 3. Interactions removed
- The separate **"Create context snapshot" → select** step inside the outcome-review flow: the review now mints/reuses a
  frozen context underneath on submit (side-effect-free per the Consumption contract). One click + one select removed.

### 4. Interactions merged
- Candidate **provenance / revision / hash** collapse into a single optional **"Show the full record"** expander (was
  always-on noise). The founder sees meaning by default; complexity on demand.

### 5. Wording improvements (UI copy only — domain/API/DB unchanged)
| Internal (unchanged) | Before (UI) | After (UI) |
|---|---|---|
| learning_candidate | "Propose a learning candidate" / "learning candidate" | "See a possible learning" / "possible learning" |
| candidate.status PROPOSED | "proposed" | "Possible learning" |
| candidate.status DEFERRED | "deferred" | "Not yet" |
| candidate.status ADOPTED | "adopted" | "Kept" |
| candidate.status REJECTED / WITHDRAWN | "rejected" / "withdrawn" | "Discarded" |
| ADOPT | "Adopt (creates a learning; does not promote)" | "Keep this learning" |
| DEFER | "Defer" | "Not yet" |
| REJECT | "Reject" | "Discard" |
| WITHDRAW | "Withdraw" (primary) | moved under "Show the full record" → "Discard permanently" |
| candidate revision N + provenance ids/hashes | always shown inline | "Show the full record" expander |
| promote → BUSINESS_UNDERSTANDING | "Promote to Business Understanding" | "Let future decisions use this" |
| promote → FOUNDER_STRATEGIC_CONTEXT | "Promote to Founder Strategic Context" | "Apply to your whole strategy" |
| promotion history headings | "Promotion history (…)" | "What future decisions will use" |
| outcome review fields | plain fields | guided: "What did you expect? / What happened? / What's still unclear? / Worth remembering?" |

### 6. Screens requiring progressive disclosure
- **Possible learning card** — collapsed: statement + "appears true when {scope}" + "still unknown {unknowns}" + Keep /
  Not yet / Discard. Expanded ("Show the full record"): source outcome review + snapshot id + revision number + content
  hash + contradictions + selected observations + Discard-permanently (WITHDRAW). Nothing becomes inaccessible.

### 7. Updated UX principles
1. **Show meaning, not implementation.** Default views name what something *means*; ids/hashes/revisions live behind an
   expander.
2. **Never hide constitutional truth — disclose it progressively.** Everything stored stays reachable in one click.
3. **Founder verbs, domain nouns.** UI says Keep / Not yet / Discard; the domain keeps ADOPT / DEFER / REJECT / WITHDRAW.
4. **No manufactured need.** Nothing nudges toward Keep or Promote; all paths are equally weighted, and "keeping never
   shares it automatically" is stated.
5. **Let the system do side-effect-free plumbing.** Snapshot minting for a review is automatic; genuine founder decisions
   are never automated.

### 8. Evidence no constitutional guarantee changed
No backend/domain/API/migration edits (Part 12): the same repositories, routes, CHECKs, triggers, and append-only ledgers
run unchanged. The full backend suite (1096/1) is untouched; every Playwright suite still passes (text assertions updated to
the improved copy, all constitutional DB assertions — origin, zero-promotion-on-keep, immutable history, snapshot binding —
unchanged). Explicit Promotion and Explicit Learning Admission remain explicit clicks; Withheld Verdict / Named Unknown /
Bounded Claims wording is preserved; frozen strategist hashes byte-identical.
