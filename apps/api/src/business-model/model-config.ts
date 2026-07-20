/**
 * Wave-2 debt B — EXPLICIT, VALIDATED model configuration for the two model-dependent Layer-2 capabilities
 * (the FROZEN engine is NOT covered here — it is byte-frozen and separately versioned). Before this module
 * the models were an IMPLICIT hardcoded default (`?? 'claude-sonnet-5'`) with no operator-visible config, and
 * the deployment's declared LLM_STRONG_MODEL was never wired to these capabilities — a silent-divergence risk.
 *
 * This contract makes the choice explicit and fails fast in production-capable mode when it is missing/invalid,
 * so a deploy can never silently fall back to an unintended model. The chosen model is NOT changed here:
 * `LOCAL_DEFAULT` is exactly the value that was previously hardcoded, and it is used ONLY in non-production
 * (local/test) mode, clearly separated from the production-required configuration.
 *
 *   Business Understanding synthesis → SYNTHESIS_MODEL
 *   Market-context inference         → MARKET_INFERENCE_MODEL (falls back to SYNTHESIS_MODEL)
 */

export type ModelCapability = 'synthesis' | 'market-inference' | 'strategy';

export interface ModelConfig {
  capability: ModelCapability;
  provider: 'anthropic';
  modelId: string;          // effective runtime model id (== effectiveValue)
  promptVersion: string;    // the system-prompt version this capability runs
  schemaVersion: string;    // the structured-output contract version
  configuredSource: string; // which env var (or 'local-default') supplied the value
  effectiveValue: string;
}

/** The value previously hardcoded as `?? 'claude-sonnet-5'`. Used ONLY in non-production mode. Changing this
 *  is a deliberate model switch and is out of scope for the evaluation pass. */
export const LOCAL_DEFAULT_MODEL = 'claude-sonnet-5';

export const PROMPT_VERSION: Record<ModelCapability, string> = {
  synthesis: 'synthesis-1',
  'market-inference': 'market-infer-sys-1',
  strategy: 'strategy-1',
};
export const SCHEMA_VERSION: Record<ModelCapability, string> = {
  synthesis: 'conclusions-1',          // {conclusions:[{type,statement,epistemicStatus,evidenceRefs,confidence}]}
  'market-inference': 'market-inference-1', // {inferenceText,epistemicStatus,relevanceToFounder}
  strategy: 'strategy-recommendation-1',   // {recommendation,reasoning,confidence,alternatives,nextStep,…}
};

/** Production-capable mode = a real deploy. Local dev + tests are NOT production-capable and may use the default. */
export function isProductionCapable(): boolean {
  return (process.env['NODE_ENV'] ?? '').toLowerCase() === 'production';
}

// A conservative shape check — an Anthropic model id like 'claude-sonnet-5' / 'claude-sonnet-4-6'. Rejects
// empty/garbage so a typo can't silently ship.
const MODEL_ID = /^claude-[a-z0-9]+(?:-[a-z0-9]+)*$/;

function resolve(capability: ModelCapability, primaryEnv: string, fallbackEnv?: string): ModelConfig {
  const primary = process.env[primaryEnv]?.trim();
  const fallback = fallbackEnv ? process.env[fallbackEnv]?.trim() : undefined;
  let modelId: string;
  let configuredSource: string;
  if (primary) { modelId = primary; configuredSource = primaryEnv; }
  else if (fallback) { modelId = fallback; configuredSource = fallbackEnv!; }
  else if (isProductionCapable()) {
    throw new Error(`[model-config] ${capability}: ${primaryEnv}${fallbackEnv ? ` (or ${fallbackEnv})` : ''} is REQUIRED in production-capable mode — no silent model default is allowed.`);
  } else { modelId = LOCAL_DEFAULT_MODEL; configuredSource = 'local-default'; }

  if (!MODEL_ID.test(modelId)) {
    throw new Error(`[model-config] ${capability}: model id "${modelId}" (from ${configuredSource}) is not a valid Anthropic model identifier.`);
  }
  return {
    capability, provider: 'anthropic', modelId,
    promptVersion: PROMPT_VERSION[capability], schemaVersion: SCHEMA_VERSION[capability],
    configuredSource, effectiveValue: modelId,
  };
}

export function synthesisModelConfig(): ModelConfig { return resolve('synthesis', 'SYNTHESIS_MODEL'); }
export function marketInferenceModelConfig(): ModelConfig { return resolve('market-inference', 'MARKET_INFERENCE_MODEL', 'SYNTHESIS_MODEL'); }
// Wave 4 — the strategist runs on its OWN key (STRATEGY_MODEL), falling back to the synthesis model. Same
// fail-fast contract; no silent model switch. Does NOT change the synthesis/market models.
export function strategyModelConfig(): ModelConfig { return resolve('strategy', 'STRATEGY_MODEL', 'SYNTHESIS_MODEL'); }

/** Boot-time fail-fast: resolve ALL capabilities so a production-capable process refuses to start with a
 *  missing/invalid model configuration. Returns the configs for logging (never logs secrets). */
export function validateModelConfig(): { synthesis: ModelConfig; marketInference: ModelConfig; strategy: ModelConfig } {
  return { synthesis: synthesisModelConfig(), marketInference: marketInferenceModelConfig(), strategy: strategyModelConfig() };
}
