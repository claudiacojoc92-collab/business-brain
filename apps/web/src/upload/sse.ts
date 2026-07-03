/**
 * M2.2 — SSE frame parser for the live upload stream (POST /dev/m22/upload → text/event-stream,
 * consumed via fetch()+ReadableStream).
 *
 * WHY THIS EXISTS (the bug it fixes): the previous inline reader extracted a frame's data with
 * `/^data: (.*)$/m`. In a JS regex, `.` and the `/m` `$` treat U+2028 (LINE SEPARATOR) and U+2029
 * (PARAGRAPH SEPARATOR) as line terminators — but `JSON.stringify` leaves those two characters RAW
 * (unescaped) inside JSON strings. Real PDF/DOCX text routinely contains them. So a payload carrying
 * a U+2028/U+2029 was silently TRUNCATED at that character, and `JSON.parse` failed mid-structure
 * ("Expected ',' or ']' after array element at position …"). The frame boundary was intact; the
 * DATA EXTRACTION was the defect.
 *
 * THE FIX: frames are delimited ONLY by a blank line (`\r?\n\r?\n`); lines within a frame are split
 * ONLY on `\r?\n`. U+2028/U+2029 are valid CONTENT and are never treated as boundaries. The `data:`
 * value is taken by literal prefix-slice (not a `.`-based regex), so any character — including
 * U+2028/U+2029 — is preserved verbatim and `JSON.parse` sees the complete JSON.
 *
 * Stateful across chunks: `feed(chunk)` buffers partial frames and returns only the frames that are
 * complete so far, so a frame split across network chunks (or split mid-character-sequence) is
 * reassembled before it is surfaced.
 */
export interface SSEFrame {
  event?: string;
  data?: string;
}

const FRAME_BOUNDARY = /\r?\n\r?\n/; // blank line — the ONLY frame delimiter (never U+2028/U+2029)
const LINE_BREAK = /\r?\n/;          // within a frame, lines break ONLY on CR/LF (never U+2028/U+2029)

export function createSSEParser() {
  let buf = '';
  return {
    /** Append a decoded chunk; return every frame that is now complete. */
    feed(chunk: string): SSEFrame[] {
      buf += chunk;
      const out: SSEFrame[] = [];
      let m: RegExpExecArray | null;
      while ((m = FRAME_BOUNDARY.exec(buf))) {
        const frame = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        let event: string | undefined;
        const dataLines: string[] = [];
        for (const line of frame.split(LINE_BREAK)) {
          if (line.startsWith('event:')) event = line.slice(6).replace(/^ /, '');
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, '')); // literal slice — preserves U+2028/U+2029
        }
        out.push({ event, data: dataLines.length ? dataLines.join('\n') : undefined });
      }
      return out;
    },
  };
}
