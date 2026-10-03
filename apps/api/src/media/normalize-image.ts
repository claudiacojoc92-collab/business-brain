import sharp from 'sharp';

/**
 * Harden the founder photo-upload path (carousel/media + carousel/photo-set). Decodes the uploaded bytes, and:
 *  - validates the real type from the bytes themselves (magic-byte sniff), not the declared data-URL prefix;
 *  - applies EXIF orientation so portrait phone photos don't render sideways, and strips the orientation tag;
 *  - re-encodes by rule: PNG stays PNG (lossless, transparency preserved — screenshots/logos); JPEG, WebP, and
 *    anything else photo-like becomes JPEG.
 * Non-images and HEIC are rejected with distinct codes (HEIC is rejected FOR NOW — see known-issues: iOS Safari
 * may already convert HEIC→JPEG on upload, which must be verified on a real iPhone before 2b).
 */

export type NormalizeReject = 'UNSUPPORTED_IMAGE_TYPE' | 'HEIC_UNSUPPORTED' | 'IMAGE_UNREADABLE' | 'IMAGE_TOO_LARGE';
export type NormalizeResult =
  | { readonly ok: true; readonly bytes: Buffer; readonly format: 'png' | 'jpeg' }
  | { readonly ok: false; readonly code: NormalizeReject };

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

type Sniffed = 'png' | 'jpeg' | 'webp' | 'gif' | 'heic' | 'unknown';

/** Detect the real container from the first bytes — no library needed. */
export function sniffImage(b: Buffer): Sniffed {
  if (b.length < 12) return 'unknown';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp'; // RIFF…WEBP
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif'; // GIF8
  // ISO-BMFF 'ftyp' box at offset 4, with a HEIC/HEIF brand → iPhone photo.
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = b.subarray(8, 12).toString('latin1').toLowerCase();
    if (brand === 'heic' || brand === 'heix' || brand === 'heif' || brand === 'mif1' || brand === 'hevc' || brand === 'hevx') return 'heic';
  }
  return 'unknown';
}

export async function normalizeUpload(bytes: Buffer, maxBytes: number = DEFAULT_MAX_BYTES): Promise<NormalizeResult> {
  const kind = sniffImage(bytes);
  if (kind === 'heic') return { ok: false, code: 'HEIC_UNSUPPORTED' };
  if (kind === 'unknown') return { ok: false, code: 'UNSUPPORTED_IMAGE_TYPE' };
  let out: Buffer;
  let format: 'png' | 'jpeg';
  try {
    // rotate() with no args auto-applies the EXIF orientation and removes the tag.
    const pipeline = sharp(bytes, { failOn: 'error' }).rotate();
    if (kind === 'png') { out = await pipeline.png().toBuffer(); format = 'png'; }
    else { out = await pipeline.jpeg({ quality: 88 }).toBuffer(); format = 'jpeg'; } // jpeg | webp | gif → jpeg
  } catch {
    return { ok: false, code: 'IMAGE_UNREADABLE' }; // sniffed as an image but could not be decoded (corrupt/truncated)
  }
  // Enforce the ceiling on what actually gets STORED: re-encoding (esp. PNG) can grow the file past the input.
  if (out.length > maxBytes) return { ok: false, code: 'IMAGE_TOO_LARGE' };
  return { ok: true, bytes: out, format };
}

/** English fallback for a rejection code. The web maps the CODE to a localized string; this is only the default. */
export function rejectMessage(code: NormalizeReject): string {
  switch (code) {
    case 'HEIC_UNSUPPORTED': return 'That looks like an iPhone HEIC photo. Save it as JPEG and try again.';
    case 'UNSUPPORTED_IMAGE_TYPE': return "That file isn't a supported image. Use a JPG, PNG, or WebP.";
    case 'IMAGE_UNREADABLE': return "That image couldn't be read — it may be corrupt. Try another.";
    case 'IMAGE_TOO_LARGE': return 'That image is too large (max 10MB). Try a smaller one.';
  }
}
