import { PgEvidenceRepository } from '../database/repositories/pg-evidence.repository';
import type { KyselyDB } from '../database/client';
import type { IWebsiteIngestionPort, WebsiteIngestionResult } from '@bb/application';
import { readWebsite } from '../connectors/website/website.connector';

/**
 * Slice 1 ingestion adapter — reuses the REAL website connector (no second fetcher). Reads the
 * live site into the founder-scoped, immutable evidence store (ADR-007). Exposed through the
 * authenticated, business-scoped production route (not the dev SSE route).
 */
export class WebsiteIngestionAdapter implements IWebsiteIngestionPort {
  constructor(private readonly db: KyselyDB) {}

  async ingest(founderId: string, url: string): Promise<WebsiteIngestionResult> {
    const repo = new PgEvidenceRepository(this.db);
    const r = await readWebsite({ founderId, url, repo });
    const state: WebsiteIngestionResult['state'] =
      r.state === 'synced' || r.state === 'partial' || r.state === 'empty' || r.state === 'failed'
        ? r.state
        : 'partial';
    return {
      state,
      url: r.url,
      pagesRead: r.pagesRead,
      fragmentsStored: r.fragmentsStored,
      gaps: r.gaps,
      ...(r.error ? { error: r.error } : {}),
    };
  }
}
