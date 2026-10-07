import { describe, it, expect, beforeEach } from 'vitest';
import { ValidationError, ConflictError } from '@bb/shared';
import {
  FounderAccountService,
  type IFounderAccountRepository,
  type FounderAccountRecord,
  type CreateFounderAccountRow,
} from '../../business/index';

class FakeAccountRepo implements IFounderAccountRepository {
  byEmail = new Map<string, FounderAccountRecord>();

  async findByEmail(email: string): Promise<FounderAccountRecord | null> {
    return this.byEmail.get(email) ?? null;
  }
  async getById(founderId: string): Promise<FounderAccountRecord | null> {
    for (const v of this.byEmail.values()) if (v.founderId === founderId) return v;
    return null;
  }
  async createAccount(row: CreateFounderAccountRow): Promise<FounderAccountRecord> {
    const rec: FounderAccountRecord = {
      founderId: row.founderId,
      email: row.email,
      name: row.name,
      interfaceLocale: row.interfaceLocale,
    };
    this.byEmail.set(row.email, rec);
    return rec;
  }
  async updateInterfaceLocale(founderId: string, locale: string): Promise<void> {
    for (const v of this.byEmail.values()) {
      if (v.founderId === founderId) this.byEmail.set(v.email, { ...v, interfaceLocale: locale });
    }
  }
}

describe('FounderAccountService', () => {
  let repo: FakeAccountRepo;
  let svc: FounderAccountService;
  beforeEach(() => {
    repo = new FakeAccountRepo();
    svc = new FounderAccountService(repo);
  });

  it('registers an account (email normalized, locale carried)', async () => {
    const a = await svc.register({ email: '  Claudia@Example.COM ', name: ' Claudia ', passwordHash: 'h', interfaceLocale: 'it' });
    expect(a.email).toBe('claudia@example.com');
    expect(a.name).toBe('Claudia');
    expect(a.interfaceLocale).toBe('it');
  });

  it('rejects duplicate email with ConflictError', async () => {
    await svc.register({ email: 'a@b.com', name: 'A', passwordHash: 'h' });
    await expect(svc.register({ email: 'a@b.com', name: 'A2', passwordHash: 'h2' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects an invalid email', async () => {
    await expect(svc.register({ email: 'nope', name: 'A', passwordHash: 'h' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('find-or-create by Google is idempotent on email', async () => {
    const first = await svc.findOrCreateByGoogle({ email: 'g@x.com', name: 'Gigi' });
    const second = await svc.findOrCreateByGoogle({ email: 'g@x.com', name: 'Different' });
    expect(second.founderId).toBe(first.founderId);
    expect(second.name).toBe('Gigi'); // existing account preserved
  });

  it('validates interface locale updates', async () => {
    const a = await svc.register({ email: 'l@x.com', name: 'L', passwordHash: 'h' });
    await expect(svc.setInterfaceLocale(a.founderId, 'de')).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.setInterfaceLocale(a.founderId, 'ro')).resolves.toBe('ro');
    expect((await svc.getById(a.founderId))?.interfaceLocale).toBe('ro');
  });
});
