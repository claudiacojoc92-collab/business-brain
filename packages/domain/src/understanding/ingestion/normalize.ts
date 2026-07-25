import type { NormalizedObservationPayload } from '../observations/normalized-observation';
import type { Extraction } from '../observations/extraction';

/**
 * The pinned, deterministic normalization rule for Instagram-like publications (Commit 2).
 * Deterministic and reproducible; it never infers, classifies, or extracts facets, and never alters
 * the MEANING of the source content. Any byte-level loss (trimmed whitespace / newline normalization)
 * is DECLARED in the Extraction descriptor; the full original entry is preserved in RawCapture.
 */
export const NORMALIZATION_RULE_KEY = 'understanding.ig_publication';
export const NORMALIZATION_RULE_VERSION = '1';

const ALLOWED_MEDIA_TYPES = new Set(['reel', 'carousel', 'image', 'video']);

export type NormalizationReasonCode =
  | 'empty_caption'
  | 'invalid_media_type'
  | 'invalid_timestamp';

export interface RawPublicationEntry {
  readonly externalId: string;
  readonly caption: string;
  readonly mediaType: string;
  readonly occurredAt: string;
}

export type NormalizeResult =
  | { readonly ok: true; readonly payload: NormalizedObservationPayload; readonly extraction: Extraction }
  | { readonly ok: false; readonly reasonCode: NormalizationReasonCode };

/** Normalize surrounding whitespace and line endings (CRLF/CR → LF). Deterministic. */
function normalizeText(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').trim();
}

function isValidIso(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

/**
 * Normalize one publication entry against the pinned rule. Fails closed with a reasonCode for empty
 * captions, unsupported media types, and invalid timestamps. `bio` is corpus-level and passed in.
 */
export function normalizePublication(entry: RawPublicationEntry, bio: string | undefined): NormalizeResult {
  const caption = normalizeText(entry.caption);
  if (caption === '') return { ok: false, reasonCode: 'empty_caption' };

  const mediaType = entry.mediaType.trim().toLowerCase();
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) return { ok: false, reasonCode: 'invalid_media_type' };

  if (!isValidIso(entry.occurredAt)) return { ok: false, reasonCode: 'invalid_timestamp' };

  const normalizedBio = bio === undefined ? undefined : normalizeText(bio);
  const bioValue = normalizedBio && normalizedBio.length > 0 ? normalizedBio : undefined;

  const captionLoss = caption !== entry.caption;
  const bioLoss = bioValue !== undefined && bio !== undefined && bioValue !== bio;
  const informationLoss =
    captionLoss || bioLoss ? 'trimmed surrounding whitespace and normalized line endings' : undefined;

  const payload: NormalizedObservationPayload = {
    caption,
    mediaType,
    occurredAt: entry.occurredAt,
    ...(bioValue !== undefined ? { bio: bioValue } : {}),
  };

  const extraction: Extraction = {
    ruleKey: NORMALIZATION_RULE_KEY,
    ruleVersion: NORMALIZATION_RULE_VERSION,
    mode: 'deterministic',
    sourceLocus: 'publication',
    reproducible: true,
    ...(informationLoss !== undefined ? { informationLoss } : {}),
  };

  return { ok: true, payload, extraction };
}
