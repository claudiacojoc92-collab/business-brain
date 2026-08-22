-- V074: Slice 6 — record the GENERATION MODE on each carousel safety-trace row. UNSHIPPED
-- (feature/business-brain-v1). The primary path is the richer governed draft→safety→repair loop
-- ('normal'); 'constrained_fallback' marks the bounded internal CONSTRAINED REALIZATION MODE that is
-- reached ONLY when normal drafting kept introducing unlicensed meaning. The fallback works from a fixed
-- beat→authorized-meaning skeleton; fallback_bindings_hash pins that skeleton for audit (NULL for normal).
-- Additive, append-only; existing rows default to 'normal'. No new audit system — same trace table.

ALTER TABLE workspace.carousel_safety_trace
  ADD COLUMN IF NOT EXISTS generation_mode        TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS fallback_bindings_hash TEXT;
