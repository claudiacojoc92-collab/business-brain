import { sql } from 'kysely';
import type { KyselyDB } from '../client';
import type {
  IIntakeSessionRepository,
  IntakeSessionRecord,
} from '@bb/application';

/**
 * Kysely implementation of IIntakeSessionRepository (B1 onboarding).
 *   - Find the active intake session for a founder
 *   - Deep-set a single signal in intake_sessions.signals (JSONB)
 *   - Mark the session completed
 *
 * No 28-answers→profile derivation here — that is a separate phase.
 * Source: Database Design V1 Section 04 (founder.intake_sessions).
 */
export class PgIntakeSessionRepository implements IIntakeSessionRepository {
  constructor(private readonly db: KyselyDB) {}

  async findActiveByFounderId(founderId: string): Promise<IntakeSessionRecord | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('founder.intake_sessions')
      .selectAll()
      .where('founder_id', '=', founderId)
      .where('completed_at', 'is', null)
      .where('abandoned_at', 'is', null)
      .where('expires_at', '>', new Date().toISOString())
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!row) return null;

    return {
      id:                   row.id,
      founderId:            row.founder_id,
      signals:              (row.signals ?? {}) as Record<string, string>,
      mandatorySignalTypes: (row.mandatory_signal_types ?? []) as string[],
      expiresAt:            new Date(row.expires_at),
      completedAt:          row.completed_at ? new Date(row.completed_at) : null,
      abandonedAt:          row.abandoned_at ? new Date(row.abandoned_at) : null,
    };
  }

  async upsertSignal(sessionId: string, signalType: string, value: string): Promise<void> {
    // Deep-set the signal-type key in the signals JSONB without touching others.
    // signalType is drawn from a fixed enum (the 28 question types), not user input.
    await sql`
      UPDATE founder.intake_sessions
      SET signals    = jsonb_set(
                         COALESCE(signals, '{}'::jsonb),
                         ${sql.raw(`'{${signalType}}'`)},
                         ${JSON.stringify(value)}::jsonb,
                         true
                       ),
          updated_at = NOW()
      WHERE id = ${sessionId}
    `.execute(this.db);
  }

  async markCompleted(sessionId: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.db as any)
      .updateTable('founder.intake_sessions')
      .set({ completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .where('id', '=', sessionId)
      .where('completed_at', 'is', null)
      .execute();
  }
}
