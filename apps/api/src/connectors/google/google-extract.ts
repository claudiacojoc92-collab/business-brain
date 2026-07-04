/**
 * Turn a granted Google file into the SAME ExtractedDoc shape the upload connector produces, so
 * every downstream reuse (classifier, provenance, reflection, recompute) works unchanged. We reuse
 * M2.2's extractors wholesale: Google-Doc → export text/plain → text extractor; PDF → pdf
 * extractor; text/* → text extractor. Unsupported native types (Sheets, Slides, images) are honest
 * `unsupported`, mirroring M2.2 (spec §4). OCR is out of scope → unsupported.
 */
import { extractPdf, extractText } from '../upload/extract';
import type { ExtractedDoc } from '../upload/types';
import type { DriveClient, DriveFileMeta } from './drive-client';

const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';

// 'unsupported' = a real type we don't read yet (Sheets/Slides/image) — a TYPE verdict.
// 'error'       = a Drive fetch/auth failure (401/403/404) — a DIFFERENT truth from a type verdict;
//                 must NOT masquerade as 'unsupported' (honesty; M2.2 honest-states discipline).
export type GoogleFileType = 'google-doc' | 'pdf' | 'text' | 'unsupported' | 'error';

export interface GoogleFileResult {
  fileId: string;
  filename: string;
  modifiedTime: string | null;
  type: GoogleFileType;
  doc: ExtractedDoc | null;
  error?: string;
}

export async function extractGoogleFile(
  drive: DriveClient,
  accessToken: string,
  meta: DriveFileMeta,
): Promise<GoogleFileResult> {
  const base = { fileId: meta.id, filename: meta.name, modifiedTime: meta.modifiedTime };
  try {
    if (meta.mimeType === GOOGLE_DOC_MIME) {
      const text = await drive.exportText(meta.id, accessToken);
      return { ...base, type: 'google-doc', doc: extractText(Buffer.from(text, 'utf8'), meta.name) };
    }
    if (meta.mimeType === 'application/pdf') {
      const bytes = await drive.download(meta.id, accessToken);
      return { ...base, type: 'pdf', doc: await extractPdf(bytes, meta.name) };
    }
    if (meta.mimeType.startsWith('text/')) {
      const bytes = await drive.download(meta.id, accessToken);
      return { ...base, type: 'text', doc: extractText(bytes, meta.name) };
    }
    // Sheets, Slides, images, etc. — honest unsupported (§4), never a fabricated read.
    return { ...base, type: 'unsupported', doc: null };
  } catch (e) {
    // A Drive export/download failure (auth/scoping/network) — an ERROR, not an unsupported type.
    return { ...base, type: 'error', doc: null, error: e instanceof Error ? e.message : 'read error' };
  }
}
