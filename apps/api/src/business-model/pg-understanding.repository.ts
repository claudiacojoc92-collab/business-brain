/**
 * Pg repository for versioned Business Understanding (Wave 2, V058). Append-only: save() inserts a new
 * version row; latest() returns the highest version for a founder; the whole history is retained for
 * auditability. Founder-scoped on every call. No FK cascade (delete coverage is explicit in delete.service).
 */
import { assertUnderstandingWellFormed, type Understanding } from './understanding';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export class PgUnderstandingRepository {
  constructor(private readonly db: AnyDB) {}

  async nextVersion(founderId: string, tx?: unknown): Promise<number> {
    const db = (tx ?? this.db) as AnyDB;
    const row = await db.selectFrom('business.understanding').select(({ fn }: AnyDB) => [fn.max('version').as('v')])
      .where('founder_id', '=', founderId).executeTakeFirst();
    return (Number(row?.v) || 0) + 1;
  }

  async save(u: Understanding, tx?: unknown): Promise<void> {
    assertUnderstandingWellFormed(u); // fail closed — never persist a malformed/over-claimed understanding
    const db = (tx ?? this.db) as AnyDB;
    await db.insertInto('business.understanding').values({
      id: u.id, founder_id: u.founderId, version: u.version, supersedes_id: u.supersedesId,
      model_version: u.modelVersion, source_fragment_ids: JSON.stringify(u.sourceFragmentIds),
      conclusions: JSON.stringify(u.conclusions), created_at: u.createdAt,
    }).execute();
  }

  async latest(founderId: string, tx?: unknown): Promise<Understanding | null> {
    const db = (tx ?? this.db) as AnyDB;
    const r = await db.selectFrom('business.understanding').selectAll()
      .where('founder_id', '=', founderId).orderBy('version', 'desc').limit(1).executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }

  async listByFounder(founderId: string, tx?: unknown): Promise<Understanding[]> {
    const db = (tx ?? this.db) as AnyDB;
    const rows = await db.selectFrom('business.understanding').selectAll()
      .where('founder_id', '=', founderId).orderBy('version', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }

  private toDomain(r: AnyDB): Understanding {
    const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
    return {
      id: r.id, founderId: r.founder_id, version: Number(r.version), supersedesId: r.supersedes_id ?? null,
      modelVersion: r.model_version, sourceFragmentIds: parse(r.source_fragment_ids) ?? [],
      conclusions: parse(r.conclusions) ?? [], createdAt: new Date(r.created_at).toISOString(),
    };
  }
}
