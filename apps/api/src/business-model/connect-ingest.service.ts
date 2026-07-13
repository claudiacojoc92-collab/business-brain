/**
 * Ingest-only connect (S1-T5a). Thin wrappers over the EXISTING connectors that run ONLY the ingest spine
 * (fetch → extract → honesty-gated store, inside the connector) and return a factual result. They call NO
 * engine, NO recompute, and emit NO reflection stream — generation (POST /reads) stays the one place
 * recompute runs. The honesty gate is preserved because it lives inside the connector (makeFragment /
 * assertFragmentHonest → appendMany, enforced again by the V050 CHECK constraints).
 *
 * FRESH-READ POLICY: each wrapper deletes ONLY its own source's observed evidence before re-ingest — never
 * 'business-model' (inferred). Inference lifecycle belongs ENTIRELY to POST /reads. Content-addressed ids
 * dedupe identical re-reads; deleting the source's own evidence ensures a changed source replaces stale.
 *
 * This module imports NO engine and NO recompute (assertable) — connectors + repo only.
 */
import type { IEvidenceRepository } from '@bb/domain';
import { readWebsite } from '../connectors/website/website.connector';
import { readUpload } from '../connectors/upload/upload.connector';
import type { UploadInput } from '../connectors/upload/types';
import { readGoogle, type GoogleConnector } from '../connectors/google/google.connector';

/** A factual ingest outcome — what was stored, no interpretation, no reflection. */
export interface IngestResult {
  source: 'website' | 'upload' | 'google' | 'google-calendar';
  state: string;   // the connector's own read state (synced/partial/empty/failed/…)
  stored: number;  // observed fragments newly stored (content-addressed dedupe applied)
  detail?: Record<string, number | string | null>; // factual per-source extras (pagesRead / unitsRead / …)
}

/** Website: replace prior website evidence, then read → store observed. No engine, no stream. */
export async function ingestWebsite(args: { founderId: string; url: string; repo: IEvidenceRepository }): Promise<IngestResult> {
  await args.repo.deleteBySource(args.founderId, 'website'); // fresh source read — NOT 'business-model'
  const read = await readWebsite({ founderId: args.founderId, url: args.url, repo: args.repo });
  return { source: 'website', state: read.state, stored: read.fragmentsStored, detail: { pagesRead: read.pagesRead } };
}

/** Upload: replace prior upload evidence, then extract → store observed. No engine, no stream. */
export async function ingestUpload(args: { founderId: string; input: UploadInput; repo: IEvidenceRepository }): Promise<IngestResult> {
  await args.repo.deleteBySource(args.founderId, 'upload');
  const read = await readUpload({ founderId: args.founderId, input: args.input, repo: args.repo });
  return { source: 'upload', state: read.state, stored: read.fragmentsStored, detail: { unitsRead: read.unitsRead, filename: read.filename, redundantUnits: read.redundantUnits } };
}

/** Calendar: replace prior calendar evidence, then sync → store temporal observed. No engine, no stream. */
export async function ingestCalendar(args: { founderId: string; conn: GoogleConnector; repo: IEvidenceRepository; windowDays?: number; now?: Date }): Promise<IngestResult> {
  await args.repo.deleteBySource(args.founderId, 'google-calendar');
  const sync = await args.conn.syncCalendar(args.founderId, { windowDays: args.windowDays, now: args.now });
  const state = sync.eventsRead === 0 ? 'empty' : sync.hasPattern ? 'synced' : 'partial';
  return { source: 'google-calendar', state, stored: sync.fragmentsStored, detail: { eventsRead: sync.eventsRead } };
}

/**
 * Google Drive ingest — DEFINED for a FUTURE Drive connect task (Drive needs a picker flow to select
 * fileIds). It is NOT wired to any production route here; calendar is the Google source exposed now.
 */
export async function ingestGoogle(args: { founderId: string; fileIds: string[]; conn: GoogleConnector; repo: IEvidenceRepository }): Promise<IngestResult> {
  await args.repo.deleteBySource(args.founderId, 'google');
  const read = await readGoogle(args.conn, args.founderId, args.fileIds);
  return { source: 'google', state: read.state, stored: read.fragmentsStored, detail: { filesRead: read.filesRead, unitsRead: read.unitsRead } };
}
