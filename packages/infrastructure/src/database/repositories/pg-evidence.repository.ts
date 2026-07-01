import type { KyselyDB } from '../client';
import type { EvidenceFragment, IEvidenceRepository } from '@bb/domain';
import { assertFragmentHonest } from '@bb/domain';

/**
 * Append-only evidence store (ADR-007). Never updates a fragment in place; identical
 * content dedupes via the content-addressed primary key (ON CONFLICT DO NOTHING).
 *
 * The store-layer honesty gate re-asserts the structural rules before every insert and
 * fails CLOSED — an inferred fragment with empty derived_from (or an observed fragment
 * with no source) is refused, never persisted. This is the M1 fabrication class, closed
 * at the persistence edge (belt-and-suspenders with the DB CHECK constraints).
 */
export class PgEvidenceRepository implements IEvidenceRepository {
  constructor(private readonly db: KyselyDB) {}

  async append(fragment: EvidenceFragment, tx?: unknown): Promise<{ stored: boolean }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (tx ?? this.db) as any;

    // Honesty gate — fail closed. Throws EvidenceHonestyError; nothing is written.
    assertFragmentHonest({
      confidenceKind: fragment.confidenceKind,
      sourceUrl: fragment.sourceUrl,
      derivedFrom: fragment.derivedFrom,
      source: fragment.source,
    });

    const res = await db
      .insertInto('evidence.fragments')
      .values(this.toRow(fragment))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict((oc: any) => oc.column('id').doNothing())
      .returning('id')
      .executeTakeFirst();

    return { stored: Boolean(res) };
  }

  async appendMany(fragments: EvidenceFragment[], tx?: unknown): Promise<{ stored: number; deduped: number }> {
    let stored = 0;
    for (const f of fragments) {
      const r = await this.append(f, tx);
      if (r.stored) stored += 1;
    }
    return { stored, deduped: fragments.length - stored };
  }

  async findByFounder(founderId: string, tx?: unknown): Promise<EvidenceFragment[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (tx ?? this.db) as any;
    const rows = (await db
      .selectFrom('evidence.fragments')
      .selectAll()
      .where('founder_id', '=', founderId)
      .execute()) as unknown[];
    return rows.map((r) => this.toDomain(r));
  }

  async findObserved(founderId: string, source?: string, tx?: unknown): Promise<EvidenceFragment[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (tx ?? this.db) as any;
    let q = db
      .selectFrom('evidence.fragments')
      .selectAll()
      .where('founder_id', '=', founderId)
      .where('confidence_kind', '=', 'observed');
    if (source) q = q.where('source', '=', source);
    const rows = (await q.execute()) as unknown[];
    return rows.map((r) => this.toDomain(r));
  }

  async deleteBySource(founderId: string, source: string, tx?: unknown): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (tx ?? this.db) as any;
    await db
      .deleteFrom('evidence.fragments')
      .where('founder_id', '=', founderId)
      .where('source', '=', source)
      .execute();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toRow(f: EvidenceFragment): any {
    return {
      id:              f.id,
      founder_id:      f.founderId,
      source:          f.source,
      platform:        f.platform,
      source_url:      f.sourceUrl,
      confidence_kind: f.confidenceKind,
      occurred_at:     f.occurredAt ? f.occurredAt.toISOString() : null,
      captured_at:     f.capturedAt.toISOString(),
      visibility:      f.visibility,
      payload:         JSON.stringify(f.payload),
      derived_from:    f.derivedFrom && f.derivedFrom.length ? JSON.stringify(f.derivedFrom) : null,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toDomain(row: any): EvidenceFragment {
    return {
      id:             row.id,
      founderId:      row.founder_id,
      source:         row.source,
      platform:       row.platform ?? null,
      sourceUrl:      row.source_url ?? null,
      confidenceKind: row.confidence_kind,
      occurredAt:     row.occurred_at ? new Date(row.occurred_at) : null,
      capturedAt:     new Date(row.captured_at),
      visibility:     row.visibility,
      payload:        typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload ?? {}),
      derivedFrom:    row.derived_from
        ? (typeof row.derived_from === 'string' ? JSON.parse(row.derived_from) : row.derived_from)
        : null,
    };
  }
}
