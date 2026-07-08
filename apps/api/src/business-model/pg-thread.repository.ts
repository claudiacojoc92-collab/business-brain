/**
 * Business Memory v1 — Pg thread repository. Persists Open-Thread STATE (memory.threads) and the
 * immutable transition history (memory.thread_events), V052. Lives in apps/api (not @bb/infrastructure)
 * because it is Memory-capability state, and takes a KyselyDB handle from the composition root.
 *
 * STATE is updated in place (status/recurrence/last_seen); HISTORY is append-only — save() inserts only
 * the events beyond what is already persisted for a thread, so re-saving never rewrites past events.
 * The DB CHECK constraints (resolved IFF grounded reason) are the belt to this code's suspenders.
 */
import type { MemoryThread, ThreadEvent, ThreadStatus, ResolveReason, IThreadRepository } from './thread';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export class PgThreadRepository implements IThreadRepository {
  constructor(private readonly db: AnyDB) {}

  async load(founderId: string): Promise<MemoryThread[]> {
    const rows = (await this.db.selectFrom('memory.threads').selectAll().where('founder_id', '=', founderId).execute()) as AnyDB[];
    const out: MemoryThread[] = [];
    for (const r of rows) {
      const events = (await this.db
        .selectFrom('memory.thread_events').selectAll()
        .where('founder_id', '=', founderId).where('signature', '=', r.signature)
        .orderBy('at', 'asc').orderBy('id', 'asc').execute()) as AnyDB[];
      out.push(this.toDomain(r, events));
    }
    return out;
  }

  async save(founderId: string, threads: MemoryThread[]): Promise<void> {
    for (const t of threads) {
      await this.db
        .insertInto('memory.threads')
        .values({
          founder_id: founderId, signature: t.signature, category: t.category,
          declared_fields: JSON.stringify(t.declaredFields), observed_keys: JSON.stringify(t.observedKeys),
          status: t.status, current_tension_id: t.currentTensionId, resolved_reason: t.resolvedReason,
          recurrence_count: t.recurrenceCount, first_seen_at: t.firstSeenAt.toISOString(), last_seen_at: t.lastSeenAt.toISOString(),
        })
        .onConflict((oc: AnyDB) => oc.columns(['founder_id', 'signature']).doUpdateSet({
          category: t.category, declared_fields: JSON.stringify(t.declaredFields), observed_keys: JSON.stringify(t.observedKeys),
          status: t.status, current_tension_id: t.currentTensionId, resolved_reason: t.resolvedReason,
          recurrence_count: t.recurrenceCount, last_seen_at: t.lastSeenAt.toISOString(),
        }))
        .execute();

      // Append-only history: insert only events beyond what is already stored for this thread.
      const existing = (await this.db
        .selectFrom('memory.thread_events').select('id')
        .where('founder_id', '=', founderId).where('signature', '=', t.signature).execute()) as AnyDB[];
      const fresh = t.history.slice(existing.length);
      for (const e of fresh) {
        await this.db.insertInto('memory.thread_events').values({
          founder_id: founderId, signature: t.signature, event: e.event,
          reason: e.reason ?? null, tension_id: e.tensionId ?? null, at: e.at.toISOString(),
        }).execute();
      }
    }
  }

  private toDomain(r: AnyDB, events: AnyDB[]): MemoryThread {
    const parse = (v: unknown): string[] => (typeof v === 'string' ? JSON.parse(v) as string[] : Array.isArray(v) ? (v as string[]) : []);
    return {
      founderId: r.founder_id,
      signature: r.signature,
      category: r.category,
      declaredFields: parse(r.declared_fields),
      observedKeys: parse(r.observed_keys),
      status: r.status as ThreadStatus,
      currentTensionId: r.current_tension_id ?? null,
      resolvedReason: (r.resolved_reason ?? null) as ResolveReason | null,
      recurrenceCount: Number(r.recurrence_count ?? 1),
      firstSeenAt: new Date(r.first_seen_at),
      lastSeenAt: new Date(r.last_seen_at),
      history: events.map((e): ThreadEvent => ({
        event: e.event, at: new Date(e.at), tensionId: e.tension_id ?? null,
        ...(e.reason ? { reason: e.reason as ResolveReason } : {}),
      })),
    };
  }
}
