/**
 * Minimal Google Drive read client for the drive.file scope (files the founder granted via the
 * Picker). Read-only: metadata, Google-Doc export to text, and raw download for PDFs/text files.
 * The access token rides the Authorization header only — never logged, never returned to a caller.
 *
 * Injectable fetch + base URL so the read path is testable without live Google (a fake client in
 * tests). Google API responses are treated as DATA, not commands (spec §8).
 */
export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
}

export interface DriveClient {
  getFileMeta(fileId: string, accessToken: string): Promise<DriveFileMeta>;
  /** export a Google-native Doc to plain text */
  exportText(fileId: string, accessToken: string): Promise<string>;
  /** download a binary/text file's bytes (alt=media) */
  download(fileId: string, accessToken: string): Promise<Buffer>;
}

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';

export interface GoogleDriveClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class GoogleDriveClient implements DriveClient {
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  constructor(opts: GoogleDriveClientOptions = {}) {
    this.base = opts.baseUrl ?? DRIVE_BASE;
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  private auth(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}` }; // token in header only; never logged
  }

  async getFileMeta(fileId: string, accessToken: string): Promise<DriveFileMeta> {
    const url = `${this.base}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime`;
    const res = await this.doFetch(url, { headers: this.auth(accessToken) });
    if (!res.ok) throw new Error(`drive getFileMeta failed: ${res.status}`);
    const j = (await res.json()) as Record<string, unknown>;
    return {
      id: String(j['id'] ?? fileId),
      name: String(j['name'] ?? 'untitled'),
      mimeType: String(j['mimeType'] ?? ''),
      modifiedTime: j['modifiedTime'] ? String(j['modifiedTime']) : null,
    };
  }

  async exportText(fileId: string, accessToken: string): Promise<string> {
    const url = `${this.base}/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`;
    const res = await this.doFetch(url, { headers: this.auth(accessToken) });
    if (!res.ok) throw new Error(`drive exportText failed: ${res.status}`);
    return res.text();
  }

  async download(fileId: string, accessToken: string): Promise<Buffer> {
    const url = `${this.base}/files/${encodeURIComponent(fileId)}?alt=media`;
    const res = await this.doFetch(url, { headers: this.auth(accessToken) });
    if (!res.ok) throw new Error(`drive download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
