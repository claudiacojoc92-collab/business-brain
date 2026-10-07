import type { KyselyDB } from '../client';
import { isSupportedLocale, type IContentLanguageStore, type SupportedLocale } from '@bb/application';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The business's content language (workspace.businesses.content_language, V084). NULL until decided: set once at
 * first understanding (from the founder's material) or by an explicit founder switch. Legacy businesses keep NULL
 * and resolve to their FIRST understanding snapshot's detected source_language, so nothing is migrated.
 */
export class PgContentLanguageStore implements IContentLanguageStore {
  constructor(private readonly db: KyselyDB) {}

  async get(businessId: string): Promise<SupportedLocale | null> {
    const r = await (this.db as any).selectFrom('workspace.businesses').select('content_language').where('id', '=', businessId).executeTakeFirst();
    return isSupportedLocale(r?.content_language) ? r.content_language : null;
  }

  async setIfUnset(businessId: string, language: SupportedLocale): Promise<void> {
    await (this.db as any).updateTable('workspace.businesses').set({ content_language: language })
      .where('id', '=', businessId).where('content_language', 'is', null).execute();
  }

  async set(businessId: string, language: SupportedLocale): Promise<void> {
    await (this.db as any).updateTable('workspace.businesses').set({ content_language: language }).where('id', '=', businessId).execute();
  }

  async firstUnderstandingLanguage(businessId: string): Promise<string | null> {
    const r = await (this.db as any).selectFrom('workspace.understanding_snapshots').select('source_language')
      .where('business_id', '=', businessId).where('source_language', 'is not', null)
      .orderBy('created_at', 'asc').limit(1).executeTakeFirst();
    return r?.source_language ?? null;
  }
}
