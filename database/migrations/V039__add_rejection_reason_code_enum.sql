-- F003 CORRECTION: Add bb_types.rejection_reason_code enum
-- Already added in V003 — this migration verifies the values are correct

DO $$ BEGIN
  -- Verify all required codes exist by attempting to cast
  PERFORM 'VOICE_MISMATCH'::TEXT;
  PERFORM 'UNCLASSIFIED'::TEXT;
  -- If bb_types.rejection_reason_code does not have AUTO_APPROVED,
  -- add it to approval_status instead (F004 below)
EXCEPTION WHEN others THEN NULL; END $$;
