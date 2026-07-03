import { describe, it, expect } from 'vitest';
import { createSSEParser } from '../upload/sse';

/**
 * The test that reproduces the production failure and makes it un-green-able.
 *
 * A real PDF dragged into the live UI failed with "Expected ',' or ']' after array element in JSON
 * at position ~22159". Cause: the Beat-1 payload carried U+2028 / U+2029 (Unicode line/paragraph
 * separators — routine in PDF/DOCX text). JSON.stringify leaves those two characters RAW, and the
 * old reader extracted the data line with /^data: (.*)$/m, whose `.` / `/m`-`$` treat U+2028/U+2029
 * as line terminators — so the JSON was truncated at that character and JSON.parse threw.
 *
 * These tests carry U+2028 AND U+2029 inside a realistic LARGE multi-fragment payload, push it
 * through the actual parser in awkward chunk splits (including a split exactly at the U+2028), and
 * assert clean reassembly + parse — in both the raw wire form (what broke production) and the
 * hardened escaped form (what the server now emits).
 *
 * NOTE: the separators are built from code points via String.fromCharCode — never written as raw
 * literals — because a raw U+2028/U+2029 in source breaks the esbuild/JS parser itself (which is the
 * same class of bug on the transport, one layer down).
 */

const LS = String.fromCharCode(0x2028); // U+2028 LINE SEPARATOR
const PS = String.fromCharCode(0x2029); // U+2029 PARAGRAPH SEPARATOR
const LS_RE = new RegExp(LS, 'g');
const PS_RE = new RegExp(PS, 'g');

interface Beat1 {
  state: string;
  uploadLines: Array<{ label: string; text: string; kind: 'observed'; fragmentIds: string[] }>;
  websiteLines: unknown[];
  handoff: string | null;
  message: string | null;
}

// A realistic large Beat-1 payload: many fragments, each text carrying U+2028/U+2029, as real
// document extraction produces. Sized past the ~22KB offset where production failed.
function bigBeat1(): Beat1 {
  const uploadLines = Array.from({ length: 60 }, (_, i) => ({
    label: `internal-strategy.pdf · page ${i + 1}`,
    text:
      `From your document: Section ${i + 1}.${LS}Publicly we present calm software for everyone,` +
      `${PS}but internally the wedge is teams burned by heavyweight tools who want radical simplicity. ` +
      'grounded evidence text '.repeat(12),
    kind: 'observed' as const,
    fragmentIds: [String(i).padStart(64, 'a')],
  }));
  return { state: 'synced', uploadLines, websiteLines: [], handoff: 'handoff', message: null };
}

// Frame like the server did BEFORE the fix: single-line JSON.stringify, U+2028/U+2029 left RAW.
const wireRaw = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

// Frame like the hardened server: U+2028/U+2029 escaped to U+2028 / U+2029 (valid JSON escapes).
const wireEscaped = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data).replace(LS_RE, '\\u2028').replace(PS_RE, '\\u2029')}\n\n`;

// Feed a wire string to a fresh parser in fixed-size chunks (models arbitrary network fragmentation).
function feedChunked(wire: string, size: number) {
  const parser = createSSEParser();
  const frames: Array<{ event?: string; data?: string }> = [];
  for (let i = 0; i < wire.length; i += size) frames.push(...parser.feed(wire.slice(i, i + size)));
  return frames;
}

describe('SSE parser — U+2028/U+2029 in a large payload across chunk/frame boundaries', () => {
  it('is a genuinely large payload past the production offset, carrying both separators', () => {
    const wire = wireRaw('observed', bigBeat1());
    expect(wire.length).toBeGreaterThan(22000);
    expect(wire).toContain(LS);
    expect(wire).toContain(PS);
  });

  it('GUARD: the OLD /^data: (.*)$/m extraction truncates and throws on this payload', () => {
    // Proves the fixture actually reproduces the bug — if this stops throwing, the fixture lost its trigger.
    const wire = wireRaw('observed', bigBeat1());
    const frame = wire.slice(0, wire.indexOf('\n\n'));
    const oldExtract = /^data: (.*)$/m.exec(frame)?.[1];
    expect(oldExtract).toBeDefined();
    expect(() => JSON.parse(oldExtract as string)).toThrow();
  });

  it('reassembles + parses raw-separator frames at every chunk size (the production failure, fixed)', () => {
    const payload = bigBeat1();
    const wire = wireRaw('observed', payload) + wireRaw('done', { state: 'synced', n: 60 });
    for (const size of [1, 3, 64, 997, 8192]) {
      const frames = feedChunked(wire, size);
      expect(frames.map((f) => f.event)).toEqual(['observed', 'done']);
      expect(JSON.parse(frames[0]!.data as string)).toEqual(payload); // would THROW with the old reader
      expect(JSON.parse(frames[1]!.data as string)).toEqual({ state: 'synced', n: 60 });
    }
  });

  it('reassembles when a chunk boundary falls exactly on the U+2028 character', () => {
    const payload = bigBeat1();
    const wire = wireRaw('observed', payload);
    const at = wire.indexOf(LS);
    expect(at).toBeGreaterThan(0);
    const parser = createSSEParser();
    const frames = [
      ...parser.feed(wire.slice(0, at)),      // ends right before the separator
      ...parser.feed(wire.slice(at, at + 1)), // the separator alone
      ...parser.feed(wire.slice(at + 1)),     // the remainder
    ];
    expect(frames).toHaveLength(1);
    expect(JSON.parse(frames[0]!.data as string)).toEqual(payload);
  });

  it('hardened escaped wire carries no raw separators and still round-trips', () => {
    const payload = bigBeat1();
    const wire = wireEscaped('observed', payload);
    expect(wire).not.toContain(LS); // server emitted the U+2028 escape, not the raw char
    expect(wire).not.toContain(PS);
    const frames = feedChunked(wire, 50);
    expect(frames).toHaveLength(1);
    expect(JSON.parse(frames[0]!.data as string)).toEqual(payload); // U+2028 escapes decode back to the char
  });

  it('keeps CRLF frame delimiting working and never splits on U+2028/U+2029 as a boundary', () => {
    const payload = { text: `alpha${LS}beta${PS}gamma`, arr: [1, 2, 3] };
    const wire = `event: observed\r\ndata: ${JSON.stringify(payload)}\r\n\r\n`;
    const frames = feedChunked(wire, 5);
    expect(frames).toHaveLength(1); // U+2028/U+2029 inside did NOT create extra frames
    expect(frames[0]!.event).toBe('observed');
    expect(JSON.parse(frames[0]!.data as string)).toEqual(payload);
  });
});
