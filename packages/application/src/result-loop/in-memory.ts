import type { Contact, FollowUp, FollowUpStatus, IContactRepository, IFollowUpRepository, IOutcomeRepository, ITouchRepository, Outcome, ResultLoopRepos, Touch } from './contracts';

/** In-memory stores with the same guarantees as the Postgres ones: touches and outcomes are append-only (no update, no
 *  delete), a follow-up resolves once. Used by tests and the offline acceptance script. */
export class InMemoryContactRepository implements IContactRepository {
  readonly rows: Contact[] = [];
  async insert(c: Contact): Promise<void> { this.rows.push(c); }
  async update(businessId: string, id: string, patch: Partial<Contact>, at: string): Promise<Contact | null> {
    const i = this.rows.findIndex((c) => c.businessId === businessId && c.id === id);
    if (i < 0) return null;
    this.rows[i] = { ...this.rows[i]!, ...patch, updatedAt: at };
    return this.rows[i]!;
  }
  async get(businessId: string, id: string): Promise<Contact | null> { return this.rows.find((c) => c.businessId === businessId && c.id === id) ?? null; }
  async list(businessId: string): Promise<Contact[]> { return this.rows.filter((c) => c.businessId === businessId); }
}

export class InMemoryTouchRepository implements ITouchRepository {
  private readonly rows: Touch[] = [];
  async append(t: Touch): Promise<void> { this.rows.push(Object.freeze({ ...t })); }
  async list(businessId: string, contactId?: string): Promise<Touch[]> { return this.rows.filter((t) => t.businessId === businessId && (!contactId || t.contactId === contactId)); }
}

export class InMemoryOutcomeRepository implements IOutcomeRepository {
  private readonly rows: Outcome[] = [];
  async append(o: Outcome): Promise<void> { this.rows.push(Object.freeze({ ...o })); }
  async list(businessId: string, contactId?: string): Promise<Outcome[]> { return this.rows.filter((o) => o.businessId === businessId && (!contactId || o.contactId === contactId)); }
}

export class InMemoryFollowUpRepository implements IFollowUpRepository {
  readonly rows: FollowUp[] = [];
  async insert(f: FollowUp): Promise<void> { this.rows.push(f); }
  async resolve(businessId: string, id: string, status: Exclude<FollowUpStatus, 'OPEN'>, at: string, touchId: string | null): Promise<boolean> {
    const i = this.rows.findIndex((f) => f.businessId === businessId && f.id === id && f.status === 'OPEN');
    if (i < 0) return false;
    this.rows[i] = { ...this.rows[i]!, status, resolvedAt: at, resolvedByTouchId: touchId };
    return true;
  }
  async list(businessId: string, opts: { status?: FollowUpStatus; contactId?: string } = {}): Promise<FollowUp[]> {
    return this.rows.filter((f) => f.businessId === businessId && (!opts.status || f.status === opts.status) && (!opts.contactId || f.contactId === opts.contactId));
  }
}

export function inMemoryResultLoopRepos(): ResultLoopRepos {
  return { contacts: new InMemoryContactRepository(), touches: new InMemoryTouchRepository(), outcomes: new InMemoryOutcomeRepository(), followUps: new InMemoryFollowUpRepository() };
}
