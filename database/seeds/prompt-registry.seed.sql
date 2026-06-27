-- Prompt Registry seed — all 11 prompts from Prompt Registry V1
-- SHA-256 hashes are placeholders — replaced by validate-prompts.sh in M16
-- Run after migrations

BEGIN;

INSERT INTO app.prompt_registry (
  prompt_id, system_template, user_template, model_tier,
  max_completion_tokens, validation_hash, version, is_active, description
) VALUES

('PR-001',
 'You are an expert marketing signal interpreter for Business Brain. Your role is to interpret raw signals collected from {{FOUNDER_SNAPSHOT}} and classify them with typed concepts, direction, and significance. Return valid JSON only.',
 'Signals: {{SIGNALS}}\nMemory: {{MEMORY_PACKAGE}}\nFounder: {{FOUNDER_SNAPSHOT}}',
 'MEDIUM', 1500,
 'placeholder-pr001-hash-replace-with-validate-prompts-sh',
 1, TRUE,
 'S02 Interpreter — classifies raw signals and derives audience temperature'),

('PR-002',
 'You are a situation modelling expert for Business Brain. Analyse the typed signals and memory package to model the current founder-audience relationship state. Return valid JSON only.',
 'Typed signals: {{TYPED_SIGNALS}}\nFounder: {{FOUNDER_SNAPSHOT}}\nMemory: {{MEMORY_PACKAGE}}\nSituation summary: {{SITUATION_SUMMARY}}',
 'MEDIUM', 1500,
 'placeholder-pr002-hash-replace-with-validate-prompts-sh',
 1, TRUE,
 'S03 Situation Modeller — models audience relationship state'),

('PR-003',
 'You are a memory interrogation expert for Business Brain. Identify relevant patterns and memory gaps for the current situation. If a forward question is provided, prioritise it. Return valid JSON only.',
 'Memory: {{MEMORY_PACKAGE}}\nSituation: {{SITUATION_MODEL}}\nFounder: {{FOUNDER_SNAPSHOT}}\nForward question: {{FORWARD_QUESTION}}',
 'MEDIUM', 1500,
 'placeholder-pr003-hash-replace-with-validate-prompts-sh',
 1, TRUE,
 'S04 Memory Interrogator — identifies patterns and gaps (F011)'),

('PR-004',
 'You are a marketing hypothesis generator for Business Brain. Generate 3-5 marketing hypotheses ranked by potential impact. Each hypothesis must specify a marketing mode. Return valid JSON only.',
 'Situation: {{SITUATION_MODEL}}\nMemory interrogation: {{MEMORY_INTERROGATION}}\nFounder: {{FOUNDER_SNAPSHOT}}\nMemory: {{MEMORY_PACKAGE}}',
 'MEDIUM', 2000,
 'placeholder-pr004-hash-replace-with-validate-prompts-sh',
 1, TRUE,
 'S05 Hypothesis Generator — produces 3-5 ranked marketing hypotheses'),

('PR-005',
 'You are a hypothesis evaluator for Business Brain. Score each hypothesis against the situation and memory. Every scored hypothesis must include a citation_tag. Return valid JSON only.',
 'Hypotheses: {{HYPOTHESES}}\nSituation: {{SITUATION_MODEL}}\nMemory: {{MEMORY_PACKAGE}}\nFounder: {{FOUNDER_SNAPSHOT}}',
 'MEDIUM', 2000,
 'placeholder-pr005-hash-replace-with-validate-prompts-sh',
 1, TRUE,
 'S06 Evaluator — scores hypotheses with citation tags (F015)'),

('PR-006',
 'You are a constraint resolution expert for Business Brain. Derive voice boundaries and offer constraints from the founder memory and configuration. Return valid JSON only.',
 'Founder: {{FOUNDER_SNAPSHOT}}\nMemory: {{MEMORY_PACKAGE}}\nHard constraints: {{HARD_CONSTRAINTS}}',
 'MEDIUM', 1000,
 'placeholder-pr006-hash-replace-with-validate-prompts-sh',
 1, TRUE,
 'S07b Soft Constraints — derives voice and offer boundaries'),

('PR-008',
 'You are the strategic critic for Business Brain. You ALWAYS use the STRONG model. Provide a rigorous second argument of at least 80 words. Outcome must be one of: CONFIRMED, CONDITIONAL, MODIFIED, REJECTED, INCONCLUSIVE. Return valid JSON only.',
 'Hypothesis: {{SELECTED_HYPOTHESIS}}\nConfidence: {{CONFIDENCE_ASSESSMENT}}\nFounder: {{FOUNDER_SNAPSHOT}}\nMemory: {{MEMORY_PACKAGE}}\nHard constraints: {{HARD_CONSTRAINTS}}\nSoft constraints: {{SOFT_CONSTRAINTS}}',
 'STRONG', 2000,
 'placeholder-pr008-hash-replace-with-validate-prompts-sh',
 1, TRUE,
 'S10 Critic — STRONG model only, minimum 80-word second argument (F005)'),

('PR-009',
 'You are the decision commit engine for Business Brain. Produce the final committed brief. Depseudonymisation will be applied after your response — use the pseudonymised placeholders as provided. Return valid JSON only.',
 'Hypothesis: {{SELECTED_HYPOTHESIS}}\nConfidence: {{CONFIDENCE_ASSESSMENT}}\nCritique: {{CRITIQUE_OUTCOME}}\nFounder: {{FOUNDER_SNAPSHOT}}\nHard: {{HARD_CONSTRAINTS}}\nSoft: {{SOFT_CONSTRAINTS}}',
 'MEDIUM', 3000,
 'placeholder-pr009-hash-replace-with-validate-prompts-sh',
 1, TRUE,
 'S11 Decision Commit — produces the committed InternalBrief'),

('PR-010',
 'You are the memory update engine for Business Brain. Analyse the committed brief and signals to produce intelligence events for all relevant memory layers. Cap INCREASE confidence_delta at 0.20. Return valid JSON only.',
 'Brief: {{COMMITTED_BRIEF}}\nSituation: {{SITUATION_MODEL}}\nMemory: {{MEMORY_PACKAGE}}\nSignals: {{TYPED_SIGNALS}}\nFounder: {{FOUNDER_SNAPSHOT}}',
 'MEDIUM', 2000,
 'placeholder-pr010-hash-replace-with-validate-prompts-sh',
 1, TRUE,
 'S12 Memory Updater — produces IntelligenceEvents and ForwardQuestion (F002)'),

('PR-011',
 'You are the fallback brief generator for Business Brain. The main pipeline encountered errors. Generate a safe, high-quality fallback brief that will serve the founder well despite incomplete context. Return valid JSON only.',
 'Founder: {{FOUNDER_SNAPSHOT}}\nErrors encountered: {{ERRORS}}\nCycle number: {{CYCLE_NUMBER}}',
 'MEDIUM', 2000,
 'placeholder-pr011-hash-replace-with-validate-prompts-sh',
 1, TRUE,
 'S11F Fallback Generator — safe brief when main pipeline fails')

ON CONFLICT (prompt_id) DO UPDATE SET
  system_template       = EXCLUDED.system_template,
  user_template         = EXCLUDED.user_template,
  model_tier            = EXCLUDED.model_tier,
  max_completion_tokens = EXCLUDED.max_completion_tokens,
  description           = EXCLUDED.description,
  updated_at            = NOW();

-- PR-012 — Content Execution Layer (CEL V1.1). Concise stub registered here; the full
-- authored body lives in prompts/PR-012-content-executor.txt and is loaded by
-- deployment/scripts/load-prompts.py (same lifecycle as PR-001..PR-011). model_tier=STRONG
-- resolves to LLM_STRONG_MODEL via llm-router. is_active=TRUE (no lifecycle column; D1).
INSERT INTO app.prompt_registry (
  prompt_id, system_template, user_template, model_tier,
  max_completion_tokens, validation_hash, version, is_active, description
) VALUES

('PR-012',
 'You are the content executor for Business Brain. Turn one piece objective from a committed Internal Brief into a single finished content piece (REEL or CAROUSEL), discriminated by the requested format. Express the conviction angle through the content, honour voice parameters and audience language, never output a NEVER-list string, never emit placeholder tokens, and obey cta_style. Return valid JSON only.',
 'Brief: {{COMMITTED_BRIEF}}\nPiece objective: {{PIECE_OBJECTIVE}}\nConviction angle: {{CONVICTION_ANGLE}}\nAudience language: {{AUDIENCE_LANGUAGE}}\nVoice parameters: {{VOICE_PARAMETERS}}\nNEVER-list: {{NEVER_LIST}}\nCTA style: {{CTA_STYLE}}',
 'STRONG', 2500,
 'placeholder-pr012-hash-replace-with-validate-prompts-sh',
 1, TRUE,
 'PR-012 CONTENT_EXECUTOR — generates one reel or carousel per piece objective (CEL V1.1)')

ON CONFLICT (prompt_id) DO UPDATE SET
  system_template       = EXCLUDED.system_template,
  user_template         = EXCLUDED.user_template,
  model_tier            = EXCLUDED.model_tier,
  max_completion_tokens = EXCLUDED.max_completion_tokens,
  description           = EXCLUDED.description,
  updated_at            = NOW();

-- Compute real SHA-256 hashes from the stored system_template values.
-- Replaces the placeholder hashes set during initial seed.
UPDATE app.prompt_registry
SET validation_hash = encode(
  founder.digest(system_template::bytea, 'sha256'), 'hex'
);

-- NOTE: system_template values are loaded from prompts/*.txt by
-- the load-prompts script after seeding. Run:
--   python3 deployment/scripts/load-prompts.py
-- to populate full prompt bodies and recompute validation hashes.

COMMIT;
