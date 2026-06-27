import { monotonicFactory } from 'ulid';

const _generate = monotonicFactory();

/** Generate a new ULID. Time-sortable, URL-safe, 26 characters.
 *  Uses monotonicFactory so same-millisecond IDs are strictly ordered. */
export function generateId(): string {
  return _generate();
}

/** Returns true if the string is a correctly-formatted ULID. */
export function validateId(id: string): boolean {
  return /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/.test(id);
}

/** Alias for generateId(). Used when generating correlation IDs. */
export const generateCorrelationId = generateId;
