-- Enable RLS on all founder-data tables
ALTER TABLE founder.founders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE founder.intake_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE founder.voice_versions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE founder.audiences             ENABLE ROW LEVEL SECURITY;
ALTER TABLE founder.audience_language_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE founder.offer_versions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE founder.belief_chains         ENABLE ROW LEVEL SECURITY;
ALTER TABLE founder.conviction_angles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE founder.recalibration_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle.weekly_cycles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle.cycle_signals           ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle.internal_briefs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle.content_pieces          ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle.content_edits           ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle.forward_questions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory.memory_layers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory.intelligence_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory.patterns               ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory.voice_signatures       ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory.memory_snapshots       ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign.campaigns            ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign.campaign_phases      ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcome.outcome_reports       ENABLE ROW LEVEL SECURITY;

-- RLS policies: idempotent via DROP IF EXISTS + CREATE

DROP POLICY IF EXISTS founders_isolation ON founder.founders;
CREATE POLICY founders_isolation ON founder.founders
  USING (id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS intake_sessions_isolation ON founder.intake_sessions;
CREATE POLICY intake_sessions_isolation ON founder.intake_sessions
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS voice_versions_isolation ON founder.voice_versions;
CREATE POLICY voice_versions_isolation ON founder.voice_versions
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS audiences_isolation ON founder.audiences;
CREATE POLICY audiences_isolation ON founder.audiences
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS alf_isolation ON founder.audience_language_fingerprints;
CREATE POLICY alf_isolation ON founder.audience_language_fingerprints
  USING (audience_id IN (
    SELECT id FROM founder.audiences
    WHERE founder_id = current_setting('app.current_founder_id', TRUE)
  ));

DROP POLICY IF EXISTS offer_versions_isolation ON founder.offer_versions;
CREATE POLICY offer_versions_isolation ON founder.offer_versions
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS belief_chains_isolation ON founder.belief_chains;
CREATE POLICY belief_chains_isolation ON founder.belief_chains
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS conviction_angles_isolation ON founder.conviction_angles;
CREATE POLICY conviction_angles_isolation ON founder.conviction_angles
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS recalibration_sessions_isolation ON founder.recalibration_sessions;
CREATE POLICY recalibration_sessions_isolation ON founder.recalibration_sessions
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS weekly_cycles_isolation ON cycle.weekly_cycles;
CREATE POLICY weekly_cycles_isolation ON cycle.weekly_cycles
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS cycle_signals_isolation ON cycle.cycle_signals;
CREATE POLICY cycle_signals_isolation ON cycle.cycle_signals
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS internal_briefs_isolation ON cycle.internal_briefs;
CREATE POLICY internal_briefs_isolation ON cycle.internal_briefs
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS content_pieces_isolation ON cycle.content_pieces;
CREATE POLICY content_pieces_isolation ON cycle.content_pieces
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS content_edits_isolation ON cycle.content_edits;
CREATE POLICY content_edits_isolation ON cycle.content_edits
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS forward_questions_isolation ON cycle.forward_questions;
CREATE POLICY forward_questions_isolation ON cycle.forward_questions
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS memory_layers_isolation ON memory.memory_layers;
CREATE POLICY memory_layers_isolation ON memory.memory_layers
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS intelligence_events_isolation ON memory.intelligence_events;
CREATE POLICY intelligence_events_isolation ON memory.intelligence_events
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS patterns_isolation ON memory.patterns;
CREATE POLICY patterns_isolation ON memory.patterns
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS voice_signatures_isolation ON memory.voice_signatures;
CREATE POLICY voice_signatures_isolation ON memory.voice_signatures
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS memory_snapshots_isolation ON memory.memory_snapshots;
CREATE POLICY memory_snapshots_isolation ON memory.memory_snapshots
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS campaigns_isolation ON campaign.campaigns;
CREATE POLICY campaigns_isolation ON campaign.campaigns
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS campaign_phases_isolation ON campaign.campaign_phases;
CREATE POLICY campaign_phases_isolation ON campaign.campaign_phases
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

DROP POLICY IF EXISTS outcome_reports_isolation ON outcome.outcome_reports;
CREATE POLICY outcome_reports_isolation ON outcome.outcome_reports
  USING (founder_id = current_setting('app.current_founder_id', TRUE));
