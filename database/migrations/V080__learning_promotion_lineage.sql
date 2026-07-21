-- V080: Strategic Learning Promotion Gate — remediation. Adds EXPLICIT deterministic lineage to the append-only
-- promotion ledger so the effective promoted state is derived from a sequence/predecessor chain, NEVER from created_at
-- alone (ADR-013 remediation amendment, contract C-8). One contiguous chain per (founder, target, logical thread):
-- the first event is a PROMOTE at sequence 1 with null predecessor; REPLACE/REMOVE and any re-PROMOTE-after-REMOVE append
-- the next sequence pointing to the exact current effective (highest-sequence) event. Forward-only; does NOT edit V079.

ALTER TABLE business.learning_promotion_event
  ADD COLUMN IF NOT EXISTS promotion_sequence            INTEGER,
  ADD COLUMN IF NOT EXISTS predecessor_promotion_event_id TEXT;

-- Backfill existing V079 rows into a deterministic chain per (founder, target, logical thread), ordered by the stable
-- (created_at, id) key — NOT ambiguous timestamp alone (id breaks any tie). Sequence 1..N; predecessor = prior row's id.
WITH ordered AS (
  SELECT id, founder_id, target, logical_learning_id,
         ROW_NUMBER() OVER (PARTITION BY founder_id, target, logical_learning_id ORDER BY created_at ASC, id ASC) AS seq,
         LAG(id)     OVER (PARTITION BY founder_id, target, logical_learning_id ORDER BY created_at ASC, id ASC) AS pred
  FROM business.learning_promotion_event
)
UPDATE business.learning_promotion_event e
SET promotion_sequence = o.seq, predecessor_promotion_event_id = o.pred
FROM ordered o
WHERE e.id = o.id AND e.promotion_sequence IS NULL;

-- Fail loudly if backfill produced an impossible chain: a sequence-1 event that is not a PROMOTE (ambiguous/forked data).
DO $$
DECLARE bad INTEGER;
BEGIN
  SELECT count(*) INTO bad FROM business.learning_promotion_event
   WHERE promotion_sequence = 1 AND promotion_action <> 'PROMOTE';
  IF bad > 0 THEN
    RAISE EXCEPTION 'V080 backfill: % chain(s) begin with a non-PROMOTE event — data is ambiguous, refusing to migrate', bad;
  END IF;
END $$;

ALTER TABLE business.learning_promotion_event
  ALTER COLUMN promotion_sequence SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lpe_sequence_positive') THEN
    ALTER TABLE business.learning_promotion_event ADD CONSTRAINT lpe_sequence_positive CHECK (promotion_sequence > 0);
  END IF;
  -- First event of a chain is a PROMOTE with null predecessor; every later event has a predecessor.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lpe_sequence_predecessor_shape') THEN
    ALTER TABLE business.learning_promotion_event ADD CONSTRAINT lpe_sequence_predecessor_shape CHECK (
      (promotion_sequence = 1 AND predecessor_promotion_event_id IS NULL AND promotion_action = 'PROMOTE')
      OR (promotion_sequence > 1 AND predecessor_promotion_event_id IS NOT NULL)
    );
  END IF;
END $$;

-- Contiguity + no duplicate sequence within a chain.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lpe_chain_sequence
  ON business.learning_promotion_event (founder_id, target, logical_learning_id, promotion_sequence);
-- No fork: each predecessor event may be consumed by exactly one successor.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lpe_predecessor
  ON business.learning_promotion_event (founder_id, predecessor_promotion_event_id)
  WHERE predecessor_promotion_event_id IS NOT NULL;

COMMENT ON COLUMN business.learning_promotion_event.promotion_sequence IS 'ADR-013 remediation (V080): 1..N contiguous position in the (founder,target,logical thread) chain. Effective state is the highest-sequence event; promoted iff its action is PROMOTE/REPLACE. Never derived from created_at alone.';
COMMENT ON COLUMN business.learning_promotion_event.predecessor_promotion_event_id IS 'ADR-013 remediation (V080): the exact current effective event this event supersedes (null only for the sequence-1 PROMOTE). Unique per founder — no forks.';
