/**
 * Slice 6 — smallest blob store for carousel binaries (slide PNGs + export ZIP). Filesystem-backed; binary
 * storage is kept separate from immutable asset metadata (which lives in Postgres). A real object store can
 * implement the same IBlobStore port later without touching the domain.
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import JSZip from 'jszip';
import type { IBlobStore } from '@bb/application';

export class FsBlobStore implements IBlobStore {
  constructor(private readonly root: string) {}
  private path(key: string): string { return join(this.root, key); }

  async put(key: string, bytes: Buffer): Promise<void> {
    const f = this.path(key);
    await mkdir(dirname(f), { recursive: true });
    await writeFile(f, bytes);
  }
  async get(key: string): Promise<Buffer | null> {
    try { return await readFile(this.path(key)); } catch { return null; }
  }
  async putZip(key: string, files: Array<{ name: string; bytes: Buffer }>): Promise<void> {
    const zip = new JSZip();
    for (const f of files) zip.file(f.name, f.bytes);
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await this.put(key, buf as Buffer);
  }
}
