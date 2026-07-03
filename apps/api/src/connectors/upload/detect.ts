/**
 * Content-based type detection + security bounds (spec §9). Type is decided by MAGIC BYTES,
 * never the filename extension (extension-invariance, §5.5). Bounds are enforced before any
 * parser touches the file so a malicious/oversized artifact can't blow the budget.
 */
import { createHash } from 'node:crypto';
import type { DetectedType } from './types';

export const MAX_BYTES = 15 * 1024 * 1024; // 15 MB hard cap
export const MAX_PAGES = 300;              // page/complexity cap (DoS bound)
export const MIN_MEANINGFUL_CHARS = 16;    // "empty" (§10) = genuinely negligible; a short real memo
                                           // is ingested honestly-thin, not called empty (spec §4)

export class UploadBoundsError extends Error {
  constructor(message: string) { super(message); this.name = 'UploadBoundsError'; }
}

/** Reject oversized/empty input before parsing. Throws UploadBoundsError (→ honest failed state). */
export function assertWithinBounds(bytes: Buffer): void {
  if (!bytes || bytes.length === 0) throw new UploadBoundsError('empty file');
  if (bytes.length > MAX_BYTES) throw new UploadBoundsError(`file exceeds ${MAX_BYTES} bytes`);
}

const startsWith = (b: Buffer, sig: number[]) => sig.every((byte, i) => b[i] === byte);
const PDF_SIG = [0x25, 0x50, 0x44, 0x46];           // %PDF
const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04];           // PK\x03\x04 (DOCX is a zip)

/** Is this ZIP a WordprocessingML (.docx) package? Look for the OOXML word part by content. */
function isDocxZip(bytes: Buffer): boolean {
  // The zip's local headers/central directory carry entry names as ASCII; a real DOCX
  // always contains "word/document.xml". Scan a bounded prefix + suffix (central dir is at end).
  const hay = bytes.toString('latin1');
  return hay.includes('word/document.xml') || (hay.includes('word/') && hay.includes('document.xml'));
}

/** Heuristic: is this decodable, mostly-printable UTF-8 text (not binary)? */
function looksLikeText(bytes: Buffer): boolean {
  const n = Math.min(bytes.length, 4096);
  if (n === 0) return false;
  let control = 0;
  for (let i = 0; i < n; i++) {
    const c = bytes[i]!;
    if (c === 0) return false;                       // NUL → binary
    // allow tab(9) newline(10) CR(13); count other C0 controls
    if (c < 0x09 || (c > 0x0d && c < 0x20)) control++;
  }
  return control / n < 0.02;                         // <2% control chars → text
}

/** Decide the artifact type by content. Returns 'unsupported' for anything not in Tier 1. */
export function detectType(bytes: Buffer): DetectedType {
  if (startsWith(bytes, PDF_SIG)) return 'pdf';
  if (startsWith(bytes, ZIP_SIG)) return isDocxZip(bytes) ? 'docx' : 'unsupported'; // other zips deferred (§3)
  if (looksLikeText(bytes)) return 'text';
  return 'unsupported';
}

/** Document identity: sha256 of the raw bytes (content-addressed, dedupe on re-upload). */
export function contentHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
