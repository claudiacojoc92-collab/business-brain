import type { KyselyDB } from './client';
import { sql } from 'kysely';

/**
 * Sets PostgreSQL session-local variables for Row Level Security.
 * Called within every transaction before any data operations.
 *
 * RULE: RLS context is ALWAYS set inside the transaction, never outside.
 * Source: Implementation Spec V1 Section 03, Section 14.
 */
export async function setRlsContext(
  db: KyselyDB,
  founderId: string,
  role: string,
  traceId: string,
): Promise<void> {
  await sql`SELECT
    set_config('app.current_founder_id', ${founderId}, true),
    set_config('app.role',               ${role},      true),
    set_config('app.trace_id',           ${traceId},   true)
  `.execute(db);
}
