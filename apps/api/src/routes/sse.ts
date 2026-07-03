/**
 * SSE framing helpers (server side) — the emit counterpart to the browser's createSSEParser.
 *
 * WHY escaping exists: JSON.stringify leaves U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH
 * SEPARATOR) RAW inside string values. Those two characters are line terminators to many consumers
 * — regex `.`, several SSE parsers, and the JS parser itself — so emitting them raw is a latent
 * transport defect (it is what broke the live upload). We escape them to their backslash-uXXXX form
 * so no raw Unicode line separator ever reaches any stream consumer. Lossless: a JSON \uXXXX escape
 * decodes back to the exact character. Defense-in-depth — the browser reader is independently
 * hardened to treat these as content, but the wire is kept clean regardless of who reads it.
 *
 * The separators are matched via RegExp(String.fromCharCode(...)) rather than a regex literal so a
 * raw U+2028/U+2029 never appears in this source (a raw one breaks the JS/esbuild parser itself).
 */
const U2028 = new RegExp(String.fromCharCode(0x2028), 'g');
const U2029 = new RegExp(String.fromCharCode(0x2029), 'g');

export function sseData(data: unknown): string {
  return JSON.stringify(data).replace(U2028, '\\u2028').replace(U2029, '\\u2029');
}

/** A complete SSE frame: one event line, one single-line data line, terminated by a blank line. */
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${sseData(data)}\n\n`;
}
