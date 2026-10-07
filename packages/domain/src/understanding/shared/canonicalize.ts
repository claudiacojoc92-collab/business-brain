/**
 * Deterministic canonicalization for content-addressing.
 *
 * Rules:
 *  - object keys are sorted recursively;
 *  - `undefined` values are omitted;
 *  - arrays keep their order (order is SEMANTIC — use sortedUnique() for set-like inputs);
 *  - non-finite numbers, functions, symbols, bigint are rejected (fail closed).
 *
 * Never use JSON.stringify directly for identity: its object-key order is insertion order,
 * which would make identical semantic content hash differently.
 */
export function canonicalStringify(value: unknown): string {
  return write(value);
}

function write(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new Error('canonicalStringify: non-finite number is not representable');
    }
    return JSON.stringify(value);
  }
  if (t === 'boolean') return value === true ? 'true' : 'false';
  if (Array.isArray(value)) {
    return '[' + value.map((v) => write(v)).join(',') + ']';
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + write(obj[k])).join(',') + '}';
  }
  throw new Error(`canonicalStringify: unsupported type "${t}"`);
}

/**
 * Sort a set-like array (order NOT semantic) and drop duplicates, so the hash of a set is
 * independent of the order it was assembled in.
 */
export function sortedUnique(items: readonly string[]): string[] {
  return Array.from(new Set(items)).sort();
}
