import type { Pseudonymiser } from './pseudonymiser';

/**
 * Applies pseudonymiser.restore() to a JSON object recursively.
 * Used by S11 to restore PII in the committed brief before DB write.
 * Source: Corrections Addendum V1 F008.
 */
export function depseudonymise(
  obj: Record<string, unknown>,
  pseudonymiser: Pseudonymiser,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = pseudonymiser.restore(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === 'string'
          ? pseudonymiser.restore(item)
          : typeof item === 'object' && item !== null
            ? depseudonymise(item as Record<string, unknown>, pseudonymiser)
            : item,
      );
    } else if (typeof value === 'object' && value !== null) {
      result[key] = depseudonymise(value as Record<string, unknown>, pseudonymiser);
    } else {
      result[key] = value;
    }
  }
  return result;
}
