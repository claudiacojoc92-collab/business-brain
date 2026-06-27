import { z } from 'zod';

/** Validates a 26-character ULID string. */
export const ZodULID = z
  .string()
  .regex(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/, 'Must be a valid ULID');

/** Validates an ISO 8601 timestamp with timezone offset. */
export const ZodISOTimestamp = z.string().datetime({ offset: true });

/** Validates an email address, max 255 characters. */
export const ZodEmail = z.string().email().max(255);

/** Validates a non-empty string. */
export const ZodNonEmptyString = z.string().min(1);

/** Validates a confidence score between 0 and 1 inclusive. */
export const ZodConfidence = z.number().min(0).max(1);

/** Validates cursor-based pagination query parameters. */
export const ZodPaginationParams = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
