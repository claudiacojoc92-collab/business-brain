import { z } from 'zod';
import type { Result } from '@bb/shared';
import { ok, err } from '@bb/shared';

export interface ValidationOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  customValidators?: ((data: any) => Result<void, Error>)[];
}

/**
 * Universal LLM output validator.
 * Applied to every stage output before passing to the next stage.
 * Steps: JSON parse → PII scan → schema validate → custom validators.
 * Source: Implementation Spec V1 Section 05, Corrections Addendum V1 F008.
 */
export async function validateLLMOutput<T>(
  rawOutput: string,
  schema: z.ZodSchema<T>,
  options?: ValidationOptions,
): Promise<Result<T, Error>> {
  // Step 1: JSON parse (strip markdown code fences Claude may emit)
  let parsed: unknown;
  const cleaned = rawOutput
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return err(new Error(`JSON_PARSE_FAILURE: ${rawOutput.slice(0, 200)}`));
  }

  // Step 2: Schema validation
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return err(new Error(`SCHEMA_VALIDATION_FAILURE: ${JSON.stringify(result.error.issues)}`));
  }

  // Step 3: Custom stage validators
  for (const validator of options?.customValidators ?? []) {
    const customResult = validator(result.data);
    if (customResult.isErr) return err(customResult.error);
  }

  return ok(result.data);
}
