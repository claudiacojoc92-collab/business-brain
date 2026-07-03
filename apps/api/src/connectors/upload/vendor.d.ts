/** Minimal ambient types for the pure-JS parsers (no official @types). Only the surface we use. */
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfPageData { getTextContent(opts?: { normalizeWhitespace?: boolean; disableCombineTextItems?: boolean }): Promise<{ items: Array<{ str: string }> }>; }
  interface PdfOptions { max?: number; pagerender?: (page: PdfPageData) => Promise<string> | string; }
  interface PdfResult { numpages: number; numrender: number; text: string; version: string }
  function pdf(data: Buffer, options?: PdfOptions): Promise<PdfResult>;
  export = pdf;
}
declare module 'mammoth' {
  interface MammothResult { value: string; messages: Array<{ type: string; message: string }> }
  export function convertToHtml(input: { buffer: Buffer }): Promise<MammothResult>;
  export function extractRawText(input: { buffer: Buffer }): Promise<MammothResult>;
}
