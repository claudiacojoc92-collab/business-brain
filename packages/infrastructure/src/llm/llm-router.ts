import type { AnthropicClient } from './anthropic-client';
import type { PromptRegistryClient } from './prompt-registry-client';

export interface LLMCallOptions {
  promptId: string;
  variables: Record<string, string>;
}

export interface LLMResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  promptId: string;
}

type ModelTier = 'STRONG' | 'MEDIUM';

/**
 * Routes LLM calls to the correct model tier.
 * Verifies prompt checksum before every call.
 *
 * Model tier assignment (from environment):
 *   STRONG → LLM_STRONG_MODEL env var (default: claude-sonnet-4-6)
 *   MEDIUM → LLM_MEDIUM_MODEL env var (default: claude-haiku-4-5)
 *
 * RULE: Stage 10 (Critic) always uses STRONG. No downgrade permitted.
 * Source: Implementation Spec V1 Section 13, Prompt Registry V1.
 */
export class LLMRouter {
  private readonly strongModel: string;
  private readonly mediumModel: string;

  constructor(
    private readonly anthropic: AnthropicClient,
    private readonly promptRegistry: PromptRegistryClient,
    options?: { strongModel?: string; mediumModel?: string },
  ) {
    this.strongModel = options?.strongModel
      ?? process.env['LLM_STRONG_MODEL']
      ?? 'claude-sonnet-4-6';
    this.mediumModel = options?.mediumModel
      ?? process.env['LLM_MEDIUM_MODEL']
      ?? 'claude-haiku-4-5';
  }

  async call(options: LLMCallOptions): Promise<LLMResponse> {
    const prompt = await this.promptRegistry.load(options.promptId);
    // Checksum already verified by promptRegistry.load()

    const model = this.resolveModel(prompt.modelTier);
    const systemPrompt = this.interpolate(prompt.systemTemplate, options.variables);
    const userPrompt   = this.interpolate(prompt.userTemplate, options.variables);

    const response = await this.anthropic.messages.create({
      model,
      max_tokens: prompt.maxCompletionTokens,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    });

    const content = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('');

    return {
      content,
      inputTokens:  response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model,
      promptId:     options.promptId,
    };
  }

  private resolveModel(tier: ModelTier): string {
    return tier === 'STRONG' ? this.strongModel : this.mediumModel;
  }

  private interpolate(template: string, variables: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      return variables[key] ?? `{{${key}}}`;
    });
  }
}
