import { describe, it, expect, vi } from 'vitest';
import { LLMRouter } from '../../llm/llm-router';
import type { PromptRegistryClient, PromptRecord } from '../../llm/prompt-registry-client';
import type { AnthropicClient } from '../../llm/anthropic-client';
import { createHash } from 'crypto';

function makePromptRecord(overrides: Partial<PromptRecord> = {}): PromptRecord {
  const systemTemplate = 'You are an expert. Context: {{CONTEXT}}';
  return {
    promptId:            'PR-001',
    systemTemplate,
    userTemplate:        'Input: {{INPUT}}',
    modelTier:           'STRONG',
    maxCompletionTokens: 1000,
    validationHash:      createHash('sha256').update(systemTemplate).digest('hex'),
    isActive:            true,
    ...overrides,
  };
}

function makeMockRegistry(prompt: PromptRecord): PromptRegistryClient {
  return {
    load:          vi.fn().mockResolvedValue(prompt),
    verifyChecksum:vi.fn(),
    invalidate:    vi.fn(),
    invalidateAll: vi.fn(),
  } as unknown as PromptRegistryClient;
}

function makeMockAnthropic(content = '{"result": "ok"}'): AnthropicClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: content }],
        usage:   { input_tokens: 100, output_tokens: 50 },
      }),
    },
  } as unknown as AnthropicClient;
}

describe('LLMRouter', () => {
  it('calls the correct model for STRONG tier', async () => {
    const prompt  = makePromptRecord({ modelTier: 'STRONG' });
    const registry = makeMockRegistry(prompt);
    const anthropic = makeMockAnthropic();
    const router = new LLMRouter(anthropic, registry, {
      strongModel: 'claude-sonnet-4-6',
      mediumModel: 'claude-haiku-4-5',
    });

    await router.call({ promptId: 'PR-001', variables: { CONTEXT: 'test', INPUT: 'go' } });

    expect(anthropic.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-6' }),
    );
  });

  it('interpolates template variables', async () => {
    const prompt  = makePromptRecord();
    const registry = makeMockRegistry(prompt);
    const anthropic = makeMockAnthropic();
    const router = new LLMRouter(anthropic, registry, {
      strongModel: 'claude-sonnet-4-6',
      mediumModel: 'claude-haiku-4-5',
    });

    await router.call({ promptId: 'PR-001', variables: { CONTEXT: 'my-context', INPUT: 'my-input' } });

    expect(anthropic.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        system:   'You are an expert. Context: my-context',
        messages: [{ role: 'user', content: 'Input: my-input' }],
      }),
    );
  });

  it('returns structured LLMResponse', async () => {
    const prompt   = makePromptRecord();
    const registry = makeMockRegistry(prompt);
    const anthropic = makeMockAnthropic('{"key":"value"}');
    const router = new LLMRouter(anthropic, registry, {
      strongModel: 'claude-sonnet-4-6',
      mediumModel: 'claude-haiku-4-5',
    });

    const result = await router.call({ promptId: 'PR-001', variables: {} });

    expect(result.content).toBe('{"key":"value"}');
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(result.promptId).toBe('PR-001');
  });
});
