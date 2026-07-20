-- V070: Founder Strategy — persist the deterministic provenance-validation result on the session (KA-1 slice).
-- Every grounded recommendation reference is validated at write time against the session's provenance manifest;
-- invalid references are removed before persistence. This column records the validation RESULT — grounding status +
-- validated/rejected counts + a REDACTED rejection summary (kind + reason only, never the raw invalid id) — so export
-- and audit can distinguish validated grounded references from rejected model claims. Additive, nullable; existing
-- sessions read as no attached validation. Historical reconstruction itself needs no migration (target ids are
-- immutable ULIDs + the session already snapshots understanding_version). Deleted with the session; exported.

ALTER TABLE business.strategic_session ADD COLUMN IF NOT EXISTS provenance_validation JSONB;

COMMENT ON COLUMN business.strategic_session.provenance_validation IS 'Deterministic provenance-validation result (pm-1): { manifestVersion, groundingStatus GROUNDED|DEGRADED|UNGROUNDED|NOT_APPLICABLE, validatedCount, rejectedCount, rejected:[{kind,reason}] }. Rejections are redacted (no raw invalid ids).';
