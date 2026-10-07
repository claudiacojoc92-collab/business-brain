# Spec: <short name>

<!--
The spec pack: decide everything the builder would otherwise guess, BEFORE building.
Claude drafts it by interviewing the operator; the operator approves it. Delete sections that genuinely
don't apply (e.g. no UI → no App flow / Design), but say so in one line rather than leaving them empty.
Sizing: see intent/README.md (when a spec is required).
-->

- **Intent:** ./intent.md
- **Approved by:** <operator> on YYYY-MM-DD (or: NOT YET APPROVED)

## 1. Product requirements (what it does)
Feature by feature. For each: who uses it, what they can do, what "done" looks like (acceptance check).
| Feature | User | Behaviour | Acceptance check |
|---|---|---|---|

## 2. Technical requirements (what it's built on)
Stack, libraries, services, versions, hosting, external APIs and their limits/costs. Decide now; nothing
gets chosen mid-build. Note constraints from CLAUDE.md (Node versions, frozen code, licenses).

## 3. Flow (what happens next)
Page by page / step by step: entry point → each action → next screen or state → error and empty states.
A numbered list or a small diagram is enough.

## 4. Design brief (how it looks and sounds)
Colours, fonts, spacing, components to reuse, tone of copy, languages (EN/RO/IT here), brand rules,
accessibility. Link existing design-system decisions instead of re-deciding them.

## 5. Data (where data lives and who sees it)
Entities and fields, where each is stored, retention, who can read/write it (roles), privacy/secrets,
migrations needed (append-only here). "No new data" is a valid answer.

## 6. Implementation plan
Lives in ./plan.md (build order, files, tests, risks). Write it AFTER this spec is approved.

## Open questions
Anything still undecided. The spec is not approved while this list has blocking items.
