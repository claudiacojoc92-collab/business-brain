/**
 * Instagram compliance store — the durable side of Deauthorize + Data-Deletion.
 *
 * Resolves an app-scoped Instagram user id (from a verified signed_request) to our founder, purges
 * every trace of that founder's Instagram-derived data, and records an auditable, idempotent ledger
 * entry that powers the public deletion-status page.
 *
 * Deletion scope (all founder-scoped; everything else cascades from bb_version):
 *   • app.oauth_credentials      — the encrypted long-lived Instagram token (the credential)
 *   • businessbrain.bb_version   — every Business Brain version → CASCADE deletes bb_import,
 *                                   bb_observation (captions + metrics), bb_generation_context,
 *                                   bb_evidence_*, bb_diagnosis_*, execution plan, etc.
 *   • businessbrain.bb_refresh_status     — the founder's refresh cursor
 *   • businessbrain.bb_instagram_identity — the ig-id ↔ founder mapping itself
 *
 * The founder LOGIN account (founder.founders) is intentionally NOT deleted here: this removes the
 * Instagram connection and all data derived from it, not the person's account. Nothing in this module
 * logs a token, a caption, or a signed_request.
 */
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { createKyselyClient } from '@bb/infrastructure';
import type { KyselyDB } from '@bb/infrastructure';
import { INSTAGRAM_PROVIDER } from './instagram.connector';

export type DeletionKind = 'deauthorize' | 'data_deletion';

export interface DeletionStatus {
  confirmationCode: string;
  kind: DeletionKind;
  status: 'received' | 'completed';
  requestedAt: string;
  completedAt: string | null;
}

/** Deterministic, public, non-reversible confirmation code for an ig user id (stable across retries). */
export function confirmationCodeFor(igUserId: string): string {
  return 'bbdel_' + createHash('sha256').update(`bb-instagram-deletion:${igUserId}`).digest('hex').slice(0, 24);
}

export class InstagramComplianceStore {
  constructor(private readonly db: KyselyDB) {}

  /** Record the ig-id ↔ founder mapping at OAuth callback (upsert; keyed by ig user id). */
  async recordIdentity(igUserId: string, founderId: string): Promise<void> {
    if (!igUserId || !founderId) return;
    const now = new Date().toISOString();
    await sql`
      INSERT INTO businessbrain.bb_instagram_identity (ig_user_id, founder_id, connected_at, updated_at)
      VALUES (${igUserId}, ${founderId}, ${now}, ${now})
      ON CONFLICT (ig_user_id)
      DO UPDATE SET founder_id = EXCLUDED.founder_id, updated_at = EXCLUDED.updated_at
    `.execute(this.db);
  }

  /**
   * Resolve the founder for an ig user id: the identity map first, then a fallback to the most recent
   * import that recorded this account (covers accounts connected before the identity map existed).
   */
  async resolveFounder(igUserId: string): Promise<string | null> {
    if (!igUserId) return null;
    const mapped = await sql<{ founder_id: string }>`
      SELECT founder_id FROM businessbrain.bb_instagram_identity WHERE ig_user_id = ${igUserId} LIMIT 1
    `.execute(this.db);
    if (mapped.rows[0]?.founder_id) return mapped.rows[0].founder_id;

    const imported = await sql<{ founder_id: string }>`
      SELECT founder_id FROM businessbrain.bb_import
      WHERE account_external_id = ${igUserId}
      ORDER BY imported_at DESC LIMIT 1
    `.execute(this.db);
    return imported.rows[0]?.founder_id ?? null;
  }

  /**
   * Purge all Instagram-derived data for a founder, transactionally. Idempotent: deleting already-gone
   * rows is a no-op, so repeated Meta callbacks never error.
   */
  async deleteInstagramData(founderId: string): Promise<void> {
    if (!founderId) return;
    await this.db.transaction().execute(async (trx: KyselyDB) => {
      await sql`DELETE FROM app.oauth_credentials WHERE founder_id = ${founderId} AND provider = ${INSTAGRAM_PROVIDER}`.execute(trx);
      await sql`DELETE FROM businessbrain.bb_version WHERE founder_id = ${founderId}`.execute(trx); // CASCADE → all BB children
      await sql`DELETE FROM businessbrain.bb_refresh_status WHERE founder_id = ${founderId}`.execute(trx);
      await sql`DELETE FROM businessbrain.bb_instagram_identity WHERE founder_id = ${founderId}`.execute(trx);
    });
  }

  /**
   * Record (or refresh) a deletion request keyed by its deterministic confirmation code. Idempotent:
   * repeated valid requests upsert the same row and only advance the status/timestamp.
   */
  async recordRequest(args: {
    confirmationCode: string;
    kind: DeletionKind;
    igUserId: string | null;
    founderId: string | null;
    status: 'received' | 'completed';
  }): Promise<void> {
    const now = new Date().toISOString();
    const completedAt = args.status === 'completed' ? now : null;
    await sql`
      INSERT INTO businessbrain.bb_deletion_request
        (confirmation_code, kind, ig_user_id, founder_id, status, requested_at, completed_at)
      VALUES (${args.confirmationCode}, ${args.kind}, ${args.igUserId}, ${args.founderId}, ${args.status}, ${now}, ${completedAt})
      ON CONFLICT (confirmation_code)
      DO UPDATE SET
        status       = EXCLUDED.status,
        founder_id   = COALESCE(EXCLUDED.founder_id, businessbrain.bb_deletion_request.founder_id),
        completed_at = COALESCE(businessbrain.bb_deletion_request.completed_at, EXCLUDED.completed_at)
    `.execute(this.db);
  }

  /** Public status lookup for the deletion-status page. Returns null for an unknown code. */
  async getStatus(confirmationCode: string): Promise<DeletionStatus | null> {
    if (!confirmationCode) return null;
    const r = await sql<{
      confirmation_code: string;
      kind: DeletionKind;
      status: 'received' | 'completed';
      requested_at: string | Date;
      completed_at: string | Date | null;
    }>`
      SELECT confirmation_code, kind, status, requested_at, completed_at
      FROM businessbrain.bb_deletion_request WHERE confirmation_code = ${confirmationCode} LIMIT 1
    `.execute(this.db);
    const row = r.rows[0];
    if (!row) return null;
    const iso = (v: string | Date | null): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
    return {
      confirmationCode: row.confirmation_code,
      kind: row.kind,
      status: row.status,
      requestedAt: iso(row.requested_at) ?? '',
      completedAt: iso(row.completed_at),
    };
  }
}

let cached: InstagramComplianceStore | null | undefined;

/** Shared singleton; null when DATABASE_URL is unset (callers send 503). */
export function getInstagramComplianceStore(): InstagramComplianceStore | null {
  if (cached !== undefined) return cached;
  const url = process.env['DATABASE_URL'] ?? '';
  if (!url) {
    cached = null;
    return null;
  }
  cached = new InstagramComplianceStore(createKyselyClient(url));
  return cached;
}

/** Test seam. */
export function __resetInstagramComplianceStoreForTest(): void {
  cached = undefined;
}
