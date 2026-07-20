-- V069: Founder Strategy — persist deterministic strategic-context conflicts on the session (Wave 4 remediation).
-- The NON_NEGOTIABLE_OPTION rule (rule 3 of the five) is evaluated by the durable worker over the strategist's own
-- bounded option assessment (optionAssessment) against the founder's non-negotiables, then attached here so it is
-- part of the resulting strategic-context/recommendation contract, resolvable, and renderable in the founder UI.
-- Additive, nullable; existing sessions read as no attached conflicts.

ALTER TABLE business.strategic_session ADD COLUMN IF NOT EXISTS context_conflicts JSONB;

COMMENT ON COLUMN business.strategic_session.context_conflicts IS 'Deterministic strategic-context conflicts attached by the worker (e.g. NON_NEGOTIABLE_OPTION), with references resolving to immutable founder_strategic_context_item rows.';
