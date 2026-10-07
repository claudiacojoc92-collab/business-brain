/**
 * Slice 7 — IObjectStore implementations for large video bytes. ADDITIVE; the frozen carousel FsBlobStore is
 * untouched. S3ObjectStore drives Cloudflare R2 (S3-compatible) with presigned direct uploads (video bytes never
 * transit our API JSON). LocalObjectStore is the filesystem dev/test impl with the same contract.
 */
import { createWriteStream, createReadStream, mkdirSync, existsSync, statSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { IObjectStore, PresignedUpload } from '@bb/application';

// ── Local filesystem object store (dev/tests): same contract as R2, no network. ──
export class LocalObjectStore implements IObjectStore {
  constructor(private readonly baseDir: string, private readonly uploadBaseUrl = 'local://reel-upload') {}
  private path(key: string): string { return join(this.baseDir, key); }
  async presignPut(key: string, _contentType: string, _maxBytes: number): Promise<PresignedUpload> {
    return { url: `${this.uploadBaseUrl}/${encodeURIComponent(key)}`, method: 'PUT', objectKey: key };
  }
  async head(key: string): Promise<{ exists: boolean; bytes?: number } | null> {
    const p = this.path(key); return existsSync(p) ? { exists: true, bytes: statSync(p).size } : { exists: false };
  }
  async getStream(key: string): Promise<NodeJS.ReadableStream | null> {
    const p = this.path(key); return existsSync(p) ? createReadStream(p) : null;
  }
  async getToFile(key: string, destPath: string): Promise<boolean> {
    const p = this.path(key); if (!existsSync(p)) return false;
    mkdirSync(dirname(destPath), { recursive: true }); writeFileSync(destPath, readFileSync(p)); return true;
  }
  async getToBuffer(key: string): Promise<Buffer | null> {
    const p = this.path(key); return existsSync(p) ? readFileSync(p) : null;
  }
  async put(key: string, bytes: Buffer, _contentType: string): Promise<void> {
    const p = this.path(key); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, bytes);
  }
  async delete(key: string): Promise<void> { const p = this.path(key); if (existsSync(p)) rmSync(p, { force: true }); }
}

// ── Cloudflare R2 / S3 object store (production). Lazy-imports the AWS SDK so the dependency is only loaded when
//    R2 is actually configured (keeps carousel/other paths free of it). ──
export interface S3ObjectStoreConfig { endpoint?: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; presignExpirySeconds?: number }
export class S3ObjectStore implements IObjectStore {
  private client: unknown;
  private presigner: ((client: unknown, cmd: unknown, opts: { expiresIn: number }) => Promise<string>) | null = null;
  private cmds: Record<string, new (i: unknown) => unknown> = {};
  constructor(private readonly cfg: S3ObjectStoreConfig) {}
  private async sdk(): Promise<void> {
    if (this.client) return;
    const s3 = await import('@aws-sdk/client-s3');
    const presign = await import('@aws-sdk/s3-request-presigner');
    this.client = new s3.S3Client({ region: this.cfg.region, ...(this.cfg.endpoint ? { endpoint: this.cfg.endpoint } : {}), forcePathStyle: Boolean(this.cfg.endpoint), credentials: { accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey } });
    this.cmds = { put: s3.PutObjectCommand as never, get: s3.GetObjectCommand as never, head: s3.HeadObjectCommand as never, del: s3.DeleteObjectCommand as never };
    this.presigner = presign.getSignedUrl as never;
  }
  async presignPut(key: string, contentType: string, _maxBytes: number): Promise<PresignedUpload> {
    await this.sdk();
    const cmd = new this.cmds['put']!({ Bucket: this.cfg.bucket, Key: key, ContentType: contentType });
    const url = await this.presigner!(this.client, cmd, { expiresIn: this.cfg.presignExpirySeconds ?? 900 });
    return { url, method: 'PUT', objectKey: key, headers: { 'Content-Type': contentType } };
  }
  async head(key: string): Promise<{ exists: boolean; bytes?: number } | null> {
    await this.sdk();
    try { const r = await (this.client as { send: (c: unknown) => Promise<{ ContentLength?: number }> }).send(new this.cmds['head']!({ Bucket: this.cfg.bucket, Key: key })); return { exists: true, bytes: r.ContentLength }; }
    catch { return { exists: false }; }
  }
  private async getBody(key: string): Promise<NodeJS.ReadableStream | null> {
    await this.sdk();
    try { const r = await (this.client as { send: (c: unknown) => Promise<{ Body?: NodeJS.ReadableStream }> }).send(new this.cmds['get']!({ Bucket: this.cfg.bucket, Key: key })); return r.Body ?? null; }
    catch { return null; }
  }
  async getStream(key: string): Promise<NodeJS.ReadableStream | null> { return this.getBody(key); }
  async getToFile(key: string, destPath: string): Promise<boolean> {
    const body = await this.getBody(key); if (!body) return false;
    mkdirSync(dirname(destPath), { recursive: true }); await pipeline(body, createWriteStream(destPath)); return true;
  }
  async getToBuffer(key: string): Promise<Buffer | null> {
    const body = await this.getBody(key); if (!body) return null;
    const chunks: Buffer[] = []; for await (const c of body as AsyncIterable<Buffer>) chunks.push(Buffer.from(c)); return Buffer.concat(chunks);
  }
  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.sdk();
    await (this.client as { send: (c: unknown) => Promise<unknown> }).send(new this.cmds['put']!({ Bucket: this.cfg.bucket, Key: key, Body: bytes, ContentType: contentType }));
  }
  async delete(key: string): Promise<void> {
    await this.sdk();
    await (this.client as { send: (c: unknown) => Promise<unknown> }).send(new this.cmds['del']!({ Bucket: this.cfg.bucket, Key: key }));
  }
}
