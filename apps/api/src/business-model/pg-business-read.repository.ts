/**
 * Pg Business Read repository (S1-T3, V055) — persists immutable, founder-scoped snapshots of a fully
 * assembled, receipt-bearing Business Read (business_read.snapshots). Option A: the WHOLE resolved Read is
 * stored as one JSONB document, so a historical Read reloads exactly as generated even after evidence,
 * assembler mappings, or language later change. Insert-only — there is no update path (a correction is a
 * NEW snapshot). Reads are a read-only CONSUMER of the assembler's output; this layer never re-assembles,
 * never calls the engine.
 */
import { createHash } from 'node:crypto';
import { generateId } from '@bb/shared';
import type { BusinessRead } from './read-assembler';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

/** The current BusinessRead contract version — written on save, validated on load (fail closed on drift). */
export const READ_SCHEMA_VERSION = 1;

/** A persisted snapshot: the immutable envelope + the whole stored Read. */
export interface StoredRead {
  readId: string;
  founderId: string;
  schemaVersion: number;
  createdAt: Date;
  contentHash: string;
  read: BusinessRead;
}

/** Thrown when a stored snapshot cannot be honestly reconstituted — corruption or an unknown/future schema
 *  version. NEVER masked as "not found": absence and corruption are different truths. */
export class StoredReadError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'StoredReadError';
  }
}

/**
 * Canonical serialization: recursively sort object keys, OMIT undefined (JSON.stringify already drops it;
 * we mirror that so the pre-store value and the JSONB round-trip — which loses key order — hash identically).
 * Arrays keep order (order is meaningful in a Read: section order, provenance order). The result is a stable
 * string over structurally-equal Reads regardless of key insertion order.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}
function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] === undefined) continue; // mirror JSON.stringify's omission — the JSONB round-trip drops it too
    out[key] = canonicalValue(obj[key]);
  }
  return out;
}

const contentHashOf = (read: BusinessRead): string => createHash('sha256').update(canonicalize(read)).digest('hex');

export class PgBusinessReadRepository {
  constructor(private readonly db: AnyDB) {}

  /** Insert a new immutable snapshot. Generates the ULID, stamps the schema version, and stores a
   *  round-trip-stable content hash. Returns the envelope keys for the caller (export / list / fetch). */
  async save(read: BusinessRead): Promise<{ readId: string; createdAt: Date }> {
    const readId = generateId();
    const row = await this.db
      .insertInto('business_read.snapshots')
      .values({
        read_id: readId,
        founder_id: read.founderId,
        schema_version: READ_SCHEMA_VERSION,
        content_hash: contentHashOf(read),
        read_content: JSON.stringify(read),
      })
      .returning(['read_id', 'created_at'])
      .executeTakeFirstOrThrow();
    return { readId: row.read_id as string, createdAt: new Date(row.created_at as string) };
  }

  /** Fetch one snapshot the founder owns. read_id alone is NOT authorization — founder_id is always filtered.
   *  null = genuinely not found; corruption/unknown-version THROWS (never masked as absence). */
  async findById(founderId: string, readId: string): Promise<StoredRead | null> {
    const r = await this.db
      .selectFrom('business_read.snapshots').selectAll()
      .where('founder_id', '=', founderId).where('read_id', '=', readId)
      .executeTakeFirst();
    return r ? this.toStored(r) : null;
  }

  /** All of the founder's snapshots, newest first (created_at DESC, read_id tiebreak — deterministic). */
  async listByFounder(founderId: string, opts: { limit?: number; offset?: number } = {}): Promise<StoredRead[]> {
    let q = this.db
      .selectFrom('business_read.snapshots').selectAll()
      .where('founder_id', '=', founderId)
      .orderBy('created_at', 'desc').orderBy('read_id', 'desc');
    if (opts.limit != null) q = q.limit(opts.limit);
    if (opts.offset != null) q = q.offset(opts.offset);
    const rows = (await q.execute()) as AnyDB[];
    return rows.map((r) => this.toStored(r));
  }

  /** The most recent snapshot, or null if the founder has none. */
  async findLatestByFounder(founderId: string): Promise<StoredRead | null> {
    const [latest] = await this.listByFounder(founderId, { limit: 1 });
    return latest ?? null;
  }

  // Deserialize a row into a StoredRead — fail closed on unknown version or malformed content.
  private toStored(r: AnyDB): StoredRead {
    const schemaVersion = Number(r.schema_version);
    if (schemaVersion !== READ_SCHEMA_VERSION) {
      throw new StoredReadError(`unsupported stored Read schema_version ${r.schema_version} (read_id ${r.read_id})`);
    }
    let read: BusinessRead;
    try {
      const raw = r.read_content;
      read = (typeof raw === 'string' ? JSON.parse(raw) : raw) as BusinessRead;
    } catch (e) {
      throw new StoredReadError(`corrupt read_content for read_id ${r.read_id}`, e);
    }
    if (!read || typeof read !== 'object' || !Array.isArray(read.sections) || typeof read.founderId !== 'string') {
      throw new StoredReadError(`malformed read_content for read_id ${r.read_id}`);
    }
    return {
      readId: r.read_id as string,
      founderId: r.founder_id as string,
      schemaVersion,
      createdAt: new Date(r.created_at as string),
      contentHash: r.content_hash as string,
      read,
    };
  }
}
