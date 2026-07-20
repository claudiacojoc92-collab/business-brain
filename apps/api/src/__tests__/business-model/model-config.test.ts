import { describe, it, expect, afterEach } from 'vitest';
import { synthesisModelConfig, marketInferenceModelConfig, validateModelConfig, LOCAL_DEFAULT_MODEL } from '../../business-model/model-config';

/** Wave-2 debt B — the explicit, validated model-configuration contract. Pure (no DB/network). */

const KEYS = ['NODE_ENV', 'SYNTHESIS_MODEL', 'MARKET_INFERENCE_MODEL'] as const;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];
function setEnv(patch: Partial<Record<(typeof KEYS)[number], string | undefined>>): void {
  for (const k of KEYS) { if (k in patch) { const v = patch[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; } });

describe('model-config contract', () => {
  it('non-production defaults to the documented model with source local-default; versions per capability', () => {
    setEnv({ NODE_ENV: 'test', SYNTHESIS_MODEL: undefined, MARKET_INFERENCE_MODEL: undefined });
    const s = synthesisModelConfig();
    expect(s.modelId).toBe(LOCAL_DEFAULT_MODEL); expect(s.configuredSource).toBe('local-default'); expect(s.provider).toBe('anthropic');
    expect(s.promptVersion).toBe('synthesis-1'); expect(s.schemaVersion).toBe('conclusions-1'); expect(s.effectiveValue).toBe(s.modelId);
    const m = marketInferenceModelConfig();
    expect(m.promptVersion).toBe('market-infer-sys-1'); expect(m.schemaVersion).toBe('market-inference-1');
  });

  it('reads explicit env per capability, independently', () => {
    setEnv({ NODE_ENV: 'test', SYNTHESIS_MODEL: 'claude-sonnet-5', MARKET_INFERENCE_MODEL: 'claude-opus-4-8' });
    expect(synthesisModelConfig().modelId).toBe('claude-sonnet-5');
    const m = marketInferenceModelConfig();
    expect(m.modelId).toBe('claude-opus-4-8'); expect(m.configuredSource).toBe('MARKET_INFERENCE_MODEL');
  });

  it('market inference falls back to SYNTHESIS_MODEL when its own var is unset', () => {
    setEnv({ NODE_ENV: 'test', SYNTHESIS_MODEL: 'claude-sonnet-5', MARKET_INFERENCE_MODEL: undefined });
    const m = marketInferenceModelConfig();
    expect(m.modelId).toBe('claude-sonnet-5'); expect(m.configuredSource).toBe('SYNTHESIS_MODEL');
  });

  it('production-capable mode FAILS FAST when the required model config is missing', () => {
    setEnv({ NODE_ENV: 'production', SYNTHESIS_MODEL: undefined, MARKET_INFERENCE_MODEL: undefined });
    expect(() => synthesisModelConfig()).toThrow(/REQUIRED in production-capable mode/);
    expect(() => validateModelConfig()).toThrow(/REQUIRED in production-capable mode/);
  });

  it('production-capable mode passes when explicitly configured', () => {
    setEnv({ NODE_ENV: 'production', SYNTHESIS_MODEL: 'claude-sonnet-5', MARKET_INFERENCE_MODEL: 'claude-sonnet-5' });
    const v = validateModelConfig();
    expect(v.synthesis.modelId).toBe('claude-sonnet-5'); expect(v.marketInference.modelId).toBe('claude-sonnet-5');
  });

  it('rejects an invalid / non-Anthropic model id', () => {
    setEnv({ NODE_ENV: 'test', SYNTHESIS_MODEL: 'gpt-4o' });
    expect(() => synthesisModelConfig()).toThrow(/not a valid Anthropic model/);
  });
});
