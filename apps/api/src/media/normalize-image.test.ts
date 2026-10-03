import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { normalizeUpload, sniffImage } from './normalize-image';

const red = { r: 220, g: 30, b: 30 };
const base = () => sharp({ create: { width: 4, height: 2, channels: 3, background: red } });

describe('normalizeUpload — harden the photo-upload path', () => {
  it('applies EXIF orientation (90° CW tag → rotated pixels) and strips the tag', async () => {
    // A 4×2 JPEG tagged orientation=6 (rotate 90° CW) should come out 2×4 with no orientation tag.
    const tagged = await base().jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const res = await normalizeUpload(tagged);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const meta = await sharp(res.bytes).metadata();
    expect(meta.width).toBe(2);
    expect(meta.height).toBe(4);
    expect(meta.orientation).toBeUndefined();
  });

  it('PNG input stays PNG (lossless / transparency preserved)', async () => {
    const png = await base().png().toBuffer();
    const res = await normalizeUpload(png);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.format).toBe('png');
    expect((await sharp(res.bytes).metadata()).format).toBe('png');
  });

  it('JPEG input stays JPEG', async () => {
    const jpg = await base().jpeg().toBuffer();
    const res = await normalizeUpload(jpg);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.format).toBe('jpeg');
    expect((await sharp(res.bytes).metadata()).format).toBe('jpeg');
  });

  it('WebP (and other photo-like) re-encodes to JPEG', async () => {
    const webp = await base().webp().toBuffer();
    expect(sniffImage(webp)).toBe('webp');
    const res = await normalizeUpload(webp);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.format).toBe('jpeg');
  });

  it('rejects a non-image with UNSUPPORTED_IMAGE_TYPE', async () => {
    const notAnImage = Buffer.from('this is plain text, not an image at all', 'utf8');
    const res = await normalizeUpload(notAnImage);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('UNSUPPORTED_IMAGE_TYPE');
  });

  it('enforces the size ceiling on the NORMALIZED output, not just the input', async () => {
    const png = await base().png().toBuffer();
    const res = await normalizeUpload(png, 10); // any real image exceeds a 10-byte ceiling
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('IMAGE_TOO_LARGE');
  });

  it('rejects HEIC with its own code (HEIC_UNSUPPORTED)', async () => {
    // Minimal ISO-BMFF header: box size + 'ftyp' + 'heic' brand — enough for the sniffer.
    const heic = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00]);
    expect(sniffImage(heic)).toBe('heic');
    const res = await normalizeUpload(heic);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('HEIC_UNSUPPORTED');
  });
});
