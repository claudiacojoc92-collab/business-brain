import type { KyselyDB } from '../client';
import type {
  IBusinessEvidenceLinkRepository,
  IDiscoveredProfileRepository,
  IUnderstandingSnapshotRepository,
  IAhaRepository,
  IBusinessWebsiteRepository,
  DiscoveredProfile,
  DiscoveredProfileInput,
  SaveUnderstandingInput,
  UnderstandingSnapshotRecord,
  SaveAhaInput,
  AhaRecord,
} from '@bb/application';
import { generateId } from '@bb/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));

/** workspace.business_evidence_links — provenance boundary (business → immutable fragment). */
export class PgBusinessEvidenceLinkRepository implements IBusinessEvidenceLinkRepository {
  constructor(private readonly db: KyselyDB) {}

  async bind(businessId: string, links: { fragmentId: string; source: string }[]): Promise<{ linked: number }> {
    if (links.length === 0) return { linked: 0 };
    let linked = 0;
    for (const l of links) {
      const res = await (this.db as any)
        .insertInto('workspace.business_evidence_links')
        .values({ id: generateId(), business_id: businessId, evidence_fragment_id: l.fragmentId, source: l.source })
        .onConflict((oc: any) => oc.columns(['business_id', 'evidence_fragment_id']).doNothing())
        .returning('id')
        .executeTakeFirst();
      if (res) linked += 1;
    }
    return { linked };
  }

  async listFragmentIds(businessId: string): Promise<string[]> {
    const rows = await (this.db as any)
      .selectFrom('workspace.business_evidence_links')
      .select('evidence_fragment_id')
      .where('business_id', '=', businessId)
      .execute();
    return rows.map((r: any) => r.evidence_fragment_id);
  }
}

/** workspace.discovered_profiles — DISCOVERED public profiles (ownership only, never ingested). */
export class PgDiscoveredProfileRepository implements IDiscoveredProfileRepository {
  constructor(private readonly db: KyselyDB) {}

  async upsertMany(businessId: string, profiles: DiscoveredProfileInput[]): Promise<void> {
    for (const p of profiles) {
      await (this.db as any)
        .insertInto('workspace.discovered_profiles')
        .values({
          id: generateId(),
          business_id: businessId,
          platform: p.platform,
          url: p.url,
          status: 'discovered',
          discovered_from_url: p.discoveredFromUrl,
        })
        .onConflict((oc: any) => oc.columns(['business_id', 'url']).doNothing())
        .execute();
    }
  }

  async list(businessId: string): Promise<DiscoveredProfile[]> {
    const rows = await (this.db as any)
      .selectFrom('workspace.discovered_profiles')
      .select(['id', 'platform', 'url', 'status'])
      .where('business_id', '=', businessId)
      .orderBy('created_at', 'asc')
      .execute();
    return rows.map((r: any) => ({ id: r.id, platform: r.platform, url: r.url, status: r.status }));
  }

  async setStatus(businessId: string, id: string, status: 'confirmed' | 'rejected'): Promise<DiscoveredProfile | null> {
    const r = await (this.db as any)
      .updateTable('workspace.discovered_profiles')
      .set({ status, updated_at: new Date().toISOString() })
      .where('business_id', '=', businessId)
      .where('id', '=', id)
      .returning(['id', 'platform', 'url', 'status'])
      .executeTakeFirst();
    return r ? { id: r.id, platform: r.platform, url: r.url, status: r.status } : null;
  }
}

function toSnapshot(r: any): UnderstandingSnapshotRecord {
  return {
    id: r.id,
    businessId: r.business_id,
    profileVersion: r.profile_version,
    contentHash: r.content_hash,
    sourceRefCount: r.source_ref_count,
    sourceLanguage: r.source_language ?? null,
    understanding: typeof r.understanding === 'string' ? JSON.parse(r.understanding) : r.understanding,
    modelId: r.model_id,
    createdAt: iso(r.created_at),
  };
}

/** workspace.understanding_snapshots — immutable governed-understanding synthesis. */
export class PgUnderstandingSnapshotRepository implements IUnderstandingSnapshotRepository {
  constructor(private readonly db: KyselyDB) {}

  async save(input: SaveUnderstandingInput): Promise<UnderstandingSnapshotRecord> {
    const r = await (this.db as any)
      .insertInto('workspace.understanding_snapshots')
      .values({
        id: input.id,
        business_id: input.businessId,
        profile_version: input.profileVersion,
        content_hash: input.contentHash,
        source_ref_count: input.sourceRefCount,
        source_language: input.sourceLanguage,
        understanding: JSON.stringify(input.understanding),
        model_id: input.modelId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toSnapshot(r);
  }

  async latest(businessId: string): Promise<UnderstandingSnapshotRecord | null> {
    const r = await (this.db as any)
      .selectFrom('workspace.understanding_snapshots')
      .selectAll()
      .where('business_id', '=', businessId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    return r ? toSnapshot(r) : null;
  }
}

function toAha(r: any): AhaRecord {
  return {
    id: r.id,
    businessId: r.business_id,
    understandingSnapshotId: r.understanding_snapshot_id,
    language: r.language,
    status: r.status,
    findings: typeof r.findings === 'string' ? JSON.parse(r.findings) : r.findings,
    modelId: r.model_id,
    createdAt: iso(r.created_at),
  };
}

/** workspace.aha_versions — immutable Aha (never overwritten; new versions appended). */
export class PgAhaRepository implements IAhaRepository {
  constructor(private readonly db: KyselyDB) {}

  async save(input: SaveAhaInput): Promise<AhaRecord> {
    const r = await (this.db as any)
      .insertInto('workspace.aha_versions')
      .values({
        id: input.id,
        business_id: input.businessId,
        understanding_snapshot_id: input.understandingSnapshotId,
        language: input.language,
        content_hash: input.contentHash,
        model_id: input.modelId,
        findings: JSON.stringify(input.findings),
        status: input.status,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toAha(r);
  }

  async latest(businessId: string): Promise<AhaRecord | null> {
    const r = await (this.db as any)
      .selectFrom('workspace.aha_versions')
      .selectAll()
      .where('business_id', '=', businessId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    return r ? toAha(r) : null;
  }
}

/** website_url / ingestion_state on workspace.businesses. */
export class PgBusinessWebsiteRepository implements IBusinessWebsiteRepository {
  constructor(private readonly db: KyselyDB) {}

  async setWebsite(businessId: string, url: string, state: string): Promise<void> {
    await (this.db as any)
      .updateTable('workspace.businesses')
      .set({ website_url: url, ingestion_state: state })
      .where('id', '=', businessId)
      .execute();
  }

  async setIngestion(businessId: string, state: string, ingested: boolean): Promise<void> {
    const patch: Record<string, unknown> = { ingestion_state: state };
    if (ingested) patch['ingested_at'] = new Date().toISOString();
    await (this.db as any).updateTable('workspace.businesses').set(patch).where('id', '=', businessId).execute();
  }
}
