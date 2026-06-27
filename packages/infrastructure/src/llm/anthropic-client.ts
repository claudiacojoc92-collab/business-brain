import Anthropic from '@anthropic-ai/sdk';

/**
 * Creates and returns an Anthropic SDK client.
 * The API key is loaded from secrets at startup — never from process.env directly.
 * Source: Implementation Spec V1 Section 14.
 */
export function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

export type AnthropicClient = Anthropic;
