import Anthropic from '@anthropic-ai/sdk';

/**
 * Creates and returns an Anthropic SDK client.
 * The API key is loaded from secrets at startup — never from process.env directly.
 *
 * M7 transient-failure hardening: the SDK's own retry is exactly the safe mechanism we want — it retries ONLY
 * transient/retryable failures (429 rate-limit, 500/502/503, 529 overloaded, connection resets) with exponential
 * backoff, and NEVER retries a 4xx semantic error or our application-level fail-closes (those never reach it as a
 * retryable status). We only raise the bounded count from the default 2 → 4 and give slow generations a generous
 * request timeout. No custom retry loop (which could double-bill or re-run a semantic fail-close).
 * Source: Implementation Spec V1 Section 14.
 */
const MAX_RETRIES = Number(process.env['ANTHROPIC_MAX_RETRIES']) || 4;      // bounded
const REQUEST_TIMEOUT_MS = Number(process.env['ANTHROPIC_TIMEOUT_MS']) || 300_000; // 5m for the slowest generations

export function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: MAX_RETRIES, timeout: REQUEST_TIMEOUT_MS });
}

export type AnthropicClient = Anthropic;
