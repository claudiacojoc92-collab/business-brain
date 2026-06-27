-- Updated_at auto-update trigger function
CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'founder.founders',
    'founder.intake_sessions',
    'founder.offer_versions',
    'founder.recalibration_sessions',
    'founder.belief_chains',
    'cycle.weekly_cycles',
    'cycle.content_pieces',
    'campaign.campaigns',
    'app.process_manager_state',
    'app.scheduler_state',
    'app.prompt_registry'
  ]) LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_set_updated_at ON %s;
       CREATE TRIGGER trg_set_updated_at
         BEFORE UPDATE ON %s
         FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();',
      t, t
    );
  END LOOP;
END;
$$;
