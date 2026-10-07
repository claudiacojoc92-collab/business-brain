import type { SubjectRef } from './types';

/**
 * Stable scoping key for a business subject. Every business-owned repository row is keyed by this,
 * so identical content-addressed ids in two different businesses never collide across the isolation
 * boundary (a business only ever reads rows carrying its own key).
 */
export function businessRefKey(ref: SubjectRef): string {
  return `${ref.type}:${ref.id}`;
}
