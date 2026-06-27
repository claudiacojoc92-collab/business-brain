COMMENT ON SCHEMA founder  IS 'Founder profile, intake, voice, offer, and recalibration data';
COMMENT ON SCHEMA cycle    IS 'Weekly cycle, signals, briefs, content pieces, and approval data';
COMMENT ON SCHEMA memory   IS 'Business Memory layers, intelligence events, patterns, and snapshots';
COMMENT ON SCHEMA campaign IS 'Campaign aggregates and phases';
COMMENT ON SCHEMA outcome  IS 'Outcome reports and attribution';
COMMENT ON SCHEMA app      IS 'Application infrastructure: events, idempotency, projections, scheduler';
COMMENT ON SCHEMA audit    IS 'Audit log for all state-changing operations';

COMMENT ON TABLE memory.intelligence_events IS
  'Append-only. Partitioned by emitted_at (RANGE). Never UPDATE or DELETE. See trg_prevent_ie_mutation.';

COMMENT ON TABLE app.domain_events IS
  'Transactional outbox. Published by OutboxRelay via SELECT FOR UPDATE SKIP LOCKED (F010).';

COMMENT ON TABLE founder.offer_versions IS
  'trust_multiplier is derived from price_tier via trg_derive_trust_multiplier. Never set directly.';
