import { describe, it, expect, vi } from 'vitest';
import { PromptRegistryClient } from '../../llm/prompt-registry-client';
import { createHash } from 'crypto';

function makePromptRow(systemTemplate: string) {
  const validationHash = createHash('sha256').update(systemTemplate).digest('hex');
  return {
    prompt_id:             'PR-001',
    system_template:       systemTemplate,
    user_template:         'User: {{INPUT}}',
    model_tier:            'STRONG',
    max_completion_tokens: 1000,
    validation_hash:       validationHash,
    is_active:             true,
  };
}

function makeMockDb(row: unknown) {
  const executeTakeFirst = vi.fn().mockResolvedValue(row);
  const where = vi.fn().mockReturnThis();
  const selectAll = vi.fn().mockReturnThis();
  const selectFrom = vi.fn().mockReturnValue({ selectAll, where, executeTakeFirst });
  return { selectFrom } as unknown as ReturnType<typeof import('../../database/client').createKyselyClient>;
}

describe('PromptRegistryClient', () => {
  const TEMPLATE = 'You are an expert marketing strategist. Context: {{CONTEXT}}';

  it('loads and returns a prompt record', async () => {
    const db = makeMockDb(makePromptRow(TEMPLATE));
    const client = new PromptRegistryClient(db);
    const prompt = await client.load('PR-001');
    expect(prompt.promptId).toBe('PR-001');
    expect(prompt.modelTier).toBe('STRONG');
    expect(prompt.systemTemplate).toBe(TEMPLATE);
  });

  it('caches prompt after first load', async () => {
    const db = makeMockDb(makePromptRow(TEMPLATE));
    const client = new PromptRegistryClient(db);
    await client.load('PR-001');
    await client.load('PR-001');
    expect(db.selectFrom).toHaveBeenCalledOnce();
  });

  it('throws when checksum mismatches', async () => {
    const row = makePromptRow(TEMPLATE);
    // Tamper with the validation hash
    const tamperedRow = { ...row, validation_hash: 'deadbeef'.repeat(8) };
    const db = makeMockDb(tamperedRow);
    const client = new PromptRegistryClient(db);
    await expect(client.load('PR-001')).rejects.toThrow('PROMPT_CHECKSUM_MISMATCH');
  });

  it('verifyChecksum passes for matching hash', () => {
    const db = makeMockDb(undefined);
    const client = new PromptRegistryClient(db);
    const hash = createHash('sha256').update(TEMPLATE).digest('hex');
    expect(() =>
      client.verifyChecksum({
        promptId:            'PR-001',
        systemTemplate:      TEMPLATE,
        userTemplate:        '',
        modelTier:           'STRONG',
        maxCompletionTokens: 1000,
        validationHash:      hash,
        isActive:            true,
      }),
    ).not.toThrow();
  });

  it('invalidate clears the cache entry', async () => {
    const db = makeMockDb(makePromptRow(TEMPLATE));
    const client = new PromptRegistryClient(db);
    await client.load('PR-001');
    client.invalidate('PR-001');
    await client.load('PR-001');
    expect(db.selectFrom).toHaveBeenCalledTimes(2);
  });
});
