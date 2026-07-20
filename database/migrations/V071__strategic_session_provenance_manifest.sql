-- V071: Founder Strategy — persist the IMMUTABLE provenance manifest on the session (KA-1 remediation, Blocker 1).
-- The pm-1 manifest is the exact allowed-reference set the model was permitted to cite for this session, built from the
-- assembled context at generation time. Persisting it (serialized: immutable target ids + logical id + exact version +
-- reference space, no display labels, no source bodies) makes the historical allowed-reference set reconstructable and
-- revalidatable WITHOUT re-running the assembler or reading current effective context — satisfying input-bounded
-- references, exact historical identity, historical stability, and deterministic historical revalidation.
-- Written transactionally with the terminal outcome (markReady/markInsufficient, WHERE status='PROCESSING'); immutable
-- thereafter. Additive, nullable; existing sessions read as no persisted manifest. Deleted with the session; exported.

ALTER TABLE business.strategic_session ADD COLUMN IF NOT EXISTS provenance_manifest JSONB;

COMMENT ON COLUMN business.strategic_session.provenance_manifest IS 'Immutable serialized provenance manifest (pm-1): { manifestVersion, understandingVersion, entries:[{ space CONCLUSION|RESPONDED_CONCLUSION|ENTITY|FINDING|SOURCE_URL|CONTEXT_ITEM, id, logicalItemId?, version?, suppliedToModel }] }. The exact allowed-reference set at generation; reconstructs/revalidates historical provenance without the assembler or current effective context. Written once with the terminal outcome; never rewritten.';
