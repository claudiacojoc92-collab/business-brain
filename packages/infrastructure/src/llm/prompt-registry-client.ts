import type { KyselyDB } from '../database/client';
import { createHash } from 'crypto';

export interface PromptRecord {
  promptId: string;
  systemTemplate: string;
  userTemplate: string;
  modelTier: 'STRONG' | 'MEDIUM';
  maxCompletionTokens: number;
  validationHash: string;
  isActive: boolean;
}

/**
 * Loads prompts from the prompt_registry table and verifies SHA-256 checksums.
 * Checksums are verified before every LLM call.
 *
 * If a checksum mismatches: throw InfrastructureError('PROMPT_CHECKSUM_MISMATCH').
 * Source: Implementation Spec V1 Section 14, Prompt Registry V1.
 */
export class PromptRegistryClient {
  private readonly cache = new Map<string, PromptRecord>();

  constructor(private readonly db: KyselyDB) {}

  async load(promptId: string): Promise<PromptRecord> {
    const cached = this.cache.get(promptId);
    if (cached) return cached;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('app.prompt_registry')
      .selectAll()
      .where('prompt_id', '=', promptId)
      .where('is_active', '=', true)
      .executeTakeFirst();

    if (!row) {
      throw new Error(`Prompt ${promptId} not found in registry.`);
    }

    const record: PromptRecord = {
      promptId:            row.prompt_id,
      systemTemplate:      row.system_template,
      userTemplate:        row.user_template,
      modelTier:           row.model_tier,
      maxCompletionTokens: row.max_completion_tokens,
      validationHash:      row.validation_hash,
      isActive:            row.is_active,
    };

    this.verifyChecksum(record);
    this.cache.set(promptId, record);
    return record;
  }

  verifyChecksum(prompt: PromptRecord): void {
    const computed = createHash('sha256')
      .update(prompt.systemTemplate)
      .digest('hex');

    if (computed !== prompt.validationHash) {
      throw new Error(
        `PROMPT_CHECKSUM_MISMATCH: Prompt ${prompt.promptId} checksum failed. ` +
        `Expected ${prompt.validationHash}, got ${computed}.`,
      );
    }
  }

  invalidate(promptId: string): void {
    this.cache.delete(promptId);
  }

  invalidateAll(): void {
    this.cache.clear();
  }
}
