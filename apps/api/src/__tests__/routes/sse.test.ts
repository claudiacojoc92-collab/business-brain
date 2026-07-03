import { describe, it, expect } from 'vitest';
import { sseData, sseFrame } from '../../routes/sse';

// Built from code points so no raw U+2028/U+2029 appears in this source (a raw one breaks the parser).
const LS = String.fromCharCode(0x2028); // U+2028 LINE SEPARATOR
const PS = String.fromCharCode(0x2029); // U+2029 PARAGRAPH SEPARATOR

describe('server SSE framing — U+2028/U+2029 escaping (defense-in-depth)', () => {
  it('escapes raw separators so none reach the wire, losslessly', () => {
    const payload = { text: `alpha${LS}beta${PS}gamma`, arr: [1, 2, 3] };
    const out = sseData(payload);
    expect(out).not.toContain(LS); // no raw LINE SEPARATOR on the wire
    expect(out).not.toContain(PS); // no raw PARAGRAPH SEPARATOR on the wire
    expect(out).toContain('\\u2028');
    expect(out).toContain('\\u2029');
    expect(JSON.parse(out)).toEqual(payload); // \uXXXX escapes decode back to the exact chars
  });

  it('a large multi-fragment payload with separators round-trips with no raw separator', () => {
    const payload = { lines: Array.from({ length: 60 }, (_, i) => ({ t: `page ${i}${LS}x${PS}y` })) };
    const out = sseData(payload);
    expect(out).not.toContain(LS);
    expect(out).not.toContain(PS);
    expect(JSON.parse(out)).toEqual(payload);
  });

  it('sseFrame emits a single-data-line frame terminated by a blank line', () => {
    expect(sseFrame('observed', { a: 1 })).toBe('event: observed\ndata: {"a":1}\n\n');
  });

  it('a frame carrying separators has exactly one blank-line terminator (no false boundary)', () => {
    const frame = sseFrame('inferred', { s: `a${LS}b${PS}c` });
    // The only blank-line sequence is the trailing terminator — separators did not create one.
    expect(frame.split('\n\n')).toHaveLength(2);
    expect(frame.endsWith('\n\n')).toBe(true);
  });
});
