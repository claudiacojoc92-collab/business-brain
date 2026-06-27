-- F014 CORRECTION: avoid_phrases and emotional_register on audience fingerprints
-- Already present in V007. Idempotent add.

ALTER TABLE founder.audience_language_fingerprints
  ADD COLUMN IF NOT EXISTS avoid_phrases JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS emotional_register TEXT NOT NULL DEFAULT 'ASPIRATIONAL';
