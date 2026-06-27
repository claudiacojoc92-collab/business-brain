-- F006 CORRECTION: Verify intelligence_events is partitioned.
-- Partitioning was applied in V018. This migration is a no-op guard.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'memory' AND c.relname = 'intelligence_events'
  ) THEN
    RAISE EXCEPTION 'intelligence_events must be partitioned. Check V018.';
  END IF;
END;
$$;
