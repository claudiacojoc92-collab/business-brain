/** Test fixtures: generate REAL minimal PDF and DOCX bytes so extraction is genuinely exercised. */

/** Minimal valid single-stream PDF with computed xref offsets (pdfjs/pdf-parse can read it). */
export function makeMinimalPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/([()\\])/g, '\\$1');
  const content = `BT /F1 12 Tf 72 720 Td ${lines.map((l, i) => `${i ? '0 -16 Td ' : ''}(${esc(l)}) Tj `).join('')}ET`;
  const objs: Record<number, string> = {
    1: `<< /Type /Catalog /Pages 2 0 R >>`,
    2: `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    3: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    4: `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    5: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  };
  let pdf = `%PDF-1.4\n`;
  const offsets: number[] = [];
  for (let i = 1; i <= 5; i++) { offsets[i] = Buffer.byteLength(pdf, 'latin1'); pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

// ── minimal STORED (uncompressed) zip → valid .docx mammoth can read ──────────────
const CRC_TABLE = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf: Buffer): number { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'); const crc = crc32(e.data); const size = e.data.length;
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(20, 4); lfh.writeUInt32LE(crc, 14); lfh.writeUInt32LE(size, 18); lfh.writeUInt32LE(size, 22); lfh.writeUInt16LE(name.length, 26);
    local.push(lfh, name, e.data);
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); cdh.writeUInt16LE(20, 4); cdh.writeUInt16LE(20, 6); cdh.writeUInt32LE(crc, 16); cdh.writeUInt32LE(size, 20); cdh.writeUInt32LE(size, 24); cdh.writeUInt16LE(name.length, 28); cdh.writeUInt32LE(offset, 42);
    central.push(cdh, name);
    offset += 30 + name.length + size;
  }
  const cdStart = offset; const cdSize = central.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([...local, ...central, eocd]);
}

export function makeMinimalDocx(sections: Array<{ heading?: string; body: string }>): Buffer {
  const b = (s: string) => Buffer.from(s, 'utf8');
  const paras = sections.map((s) => {
    const h = s.heading ? `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${s.heading}</w:t></w:r></w:p>` : '';
    return `${h}<w:p><w:r><w:t xml:space="preserve">${s.body}</w:t></w:r></w:p>`;
  }).join('');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}</w:body></w:document>`;
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  return zip([
    { name: '[Content_Types].xml', data: b(ct) },
    { name: '_rels/.rels', data: b(rels) },
    { name: 'word/document.xml', data: b(doc) },
  ]);
}

/** A stand-in "website already read" corpus (what redundancy is measured against). */
export const WEBSITE_TEXT = [
  'Trusted by millions, Basecamp puts everything you need to get work done in one place. It is the calm, organized way to manage projects, work with clients, and communicate company-wide.',
  'Start free with Basecamp — one project, twenty users, forever free. Or upgrade to Plus or Pro Unlimited for unlimited projects and premium support.',
  'We started our business without outside funding, and you probably did too. We know your money is tight and every dollar counts.',
];
