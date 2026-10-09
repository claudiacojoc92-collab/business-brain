/**
 * Which stored evidence fragments belong to a pour-in SOURCE as the founder sees it in the source list
 * (`{ url, type }` from the arc_source_added event). Used to UNLINK a source from a business: the fragments stay
 * in the append-only ledger; only the business link goes, so the next understanding no longer reads them.
 *
 * New ingests carry `payload.sourceKey` (= the source-list url). Older rows don't, so each type also has a
 * fallback that matches how that route stored its fragments.
 */
import type { EvidenceFragment } from '@bb/domain';
import { hostOf } from './bridge';

export interface PourInSourceRef { readonly url: string; readonly type: string }

/** The slug the file route uses in `founder://file/<slug>/<n>` (kept here so both sides agree). */
export function fileSourceSlug(filename: string): string {
  return (filename.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60)) || 'file';
}

export function fragmentMatchesSource(f: EvidenceFragment, s: PourInSourceRef): boolean {
  const payload = (f.payload ?? {}) as Record<string, unknown>;
  const key = typeof payload['sourceKey'] === 'string' ? (payload['sourceKey'] as string) : null;
  const url = f.sourceUrl ?? '';
  switch (s.type) {
    case 'website':
      return f.source === 'website' && (f.platform ?? '').replace(/^www\./, '') === hostOf(s.url);
    case 'instagram':
      return f.source === 'instagram';
    case 'link':
      if (f.source !== 'founder_supplied' || payload['pageType'] !== 'link') return false;
      return key != null ? key === s.url : url === s.url || hostOf(url) === hostOf(s.url);
    case 'pdf': case 'docx': case 'text':
      if (f.source !== 'founder_supplied') return false;
      return key != null ? key === s.url : url.startsWith(`founder://file/${fileSourceSlug(s.url)}/`);
    case 'description':
      return f.source === 'founder_supplied' && url === 'founder://text';
    default:
      return false;
  }
}
