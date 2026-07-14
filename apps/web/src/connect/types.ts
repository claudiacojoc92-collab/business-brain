import type { BusinessRead } from '../reads/types';

/**
 * Connect surface contracts (S1-T5b) — a web-side mirror of the S1-T5a production connect API + the S1-T4
 * generate endpoint. Presentation/client-only; nothing here interprets or mutates.
 */

/** GET /connect/status — factual presence per source (counts + booleans; never scores/quality). */
export interface ConnectStatus {
  website: { connected: boolean; count: number };
  upload: { connected: boolean; count: number };
  calendar: { connected: boolean };
}

/** A connect action's factual result ({source, state, stored, detail}). */
export interface IngestResult {
  source: string;
  state: string;
  stored: number;
  detail?: Record<string, unknown>;
}

/** POST /reads — the discriminated generate outcome (201 generated | 200 insufficient_evidence). */
export type GenerateResult =
  | { status: 'generated'; readId: string; createdAt: string; schemaVersion: number; read: BusinessRead }
  | { status: 'insufficient_evidence'; reason: string; whatToDo: string };
