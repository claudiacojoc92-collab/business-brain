-- V086: where a conversation turn was written (BUS-83 prerequisite, approved 2026-10-14).
--
-- workspace.conversation_turns keeps the founder's words but not WHERE they were written. Future passive communication
-- learning must tell onboarding from Talk from the mirror without guessing: how a founder talks to BB in one place is
-- context-bound evidence, never her external voice.
--
-- Only the surface KIND is stored, never screen contents. Founder and BB turns of the same interaction carry the same
-- surface. Nullable: rows written before this migration stay NULL (unknown / legacy); nothing is backfilled or inferred.
--   onboarding   = the Day One arc conversation (answers, skips, its opener)
--   mirror       = the founder's answer to the mirror (Day One moment 5)
--   talk         = the Talk drawer
--   conversation = the standalone conversation page (including a baseline refresh)

ALTER TABLE workspace.conversation_turns ADD COLUMN IF NOT EXISTS surface TEXT NULL;

DO $$ BEGIN
  ALTER TABLE workspace.conversation_turns ADD CONSTRAINT conversation_turns_surface_chk
    CHECK (surface IS NULL OR surface IN ('onboarding', 'mirror', 'talk', 'conversation'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
