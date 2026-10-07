-- V084: the business's CONTENT language — the language BB writes in for this business (understanding, conversation,
-- strategy, plan, pages…). Decided once (first understanding, from the founder's own material) or by an explicit
-- founder switch. The UI is always English and does not use it. NULL = not decided yet: legacy businesses resolve to
-- their first understanding snapshot's source_language, so no data migration is needed.
-- Rule + resolver: packages/application/src/business/content-language.ts (operator rule 2026-10-07).
ALTER TABLE workspace.businesses ADD COLUMN IF NOT EXISTS content_language TEXT
  CHECK (content_language IS NULL OR content_language IN ('ro', 'en', 'it'));
