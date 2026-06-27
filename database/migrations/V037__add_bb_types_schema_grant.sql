-- Grant usage on bb_types schema to application role
-- In production this is granted to the bbapp role
-- For development the bbuser has superuser privileges
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bbapp') THEN
    GRANT USAGE ON SCHEMA bb_types TO bbapp;
    GRANT USAGE ON SCHEMA founder, cycle, memory, campaign, outcome, app, audit TO bbapp;
  END IF;
END;
$$;
