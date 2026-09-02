import { describe, it, expect, beforeEach } from 'vitest';
import { ValidationError } from '@bb/shared';
import {
  BusinessService,
  type IBusinessRepository,
  type BusinessRecord,
  type CreateBusinessRow,
} from '../../business/index';

class FakeBusinessRepo implements IBusinessRepository {
  rows: BusinessRecord[] = [];
  members = new Set<string>(); // `${businessId}:${founderId}`

  async createWithOwnerMembership(row: CreateBusinessRow): Promise<BusinessRecord> {
    const rec: BusinessRecord = {
      id: row.id,
      name: row.name,
      ownerFounderId: row.ownerFounderId,
      defaultConversationLanguage: row.defaultConversationLanguage as BusinessRecord['defaultConversationLanguage'],
      createdAt: new Date(0).toISOString(),
    };
    this.rows.push(rec);
    this.members.add(`${row.id}:${row.ownerFounderId}`);
    return rec;
  }
  async listForFounder(founderId: string): Promise<BusinessRecord[]> {
    return this.rows.filter((r) => this.members.has(`${r.id}:${founderId}`));
  }
  async getForFounder(businessId: string, founderId: string): Promise<BusinessRecord | null> {
    if (!this.members.has(`${businessId}:${founderId}`)) return null;
    return this.rows.find((r) => r.id === businessId) ?? null;
  }
  async hasMembership(businessId: string, founderId: string): Promise<boolean> {
    return this.members.has(`${businessId}:${founderId}`);
  }
}

describe('BusinessService', () => {
  let repo: FakeBusinessRepo;
  let svc: BusinessService;
  beforeEach(() => {
    repo = new FakeBusinessRepo();
    svc = new BusinessService(repo);
  });

  it('creates a business with an owner membership', async () => {
    const b = await svc.createBusiness({ founderId: 'f1', name: 'Lumina Studio', defaultConversationLanguage: 'ro' });
    expect(b.name).toBe('Lumina Studio');
    expect(b.ownerFounderId).toBe('f1');
    expect(b.defaultConversationLanguage).toBe('ro');
    expect(await repo.hasMembership(b.id, 'f1')).toBe(true);
  });

  it('rejects empty/whitespace business names', async () => {
    await expect(svc.createBusiness({ founderId: 'f1', name: '   ' })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.createBusiness({ founderId: 'f1', name: '' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('defaults conversation language to en when unset', async () => {
    const b = await svc.createBusiness({ founderId: 'f1', name: 'Acme' });
    expect(b.defaultConversationLanguage).toBe('en');
  });

  it('supports one founder owning multiple businesses', async () => {
    await svc.createBusiness({ founderId: 'f1', name: 'One' });
    await svc.createBusiness({ founderId: 'f1', name: 'Two' });
    const list = await svc.listBusinesses('f1');
    expect(list).toHaveLength(2);
  });

  it('isolates businesses: a non-member founder cannot read another founder business', async () => {
    const b = await svc.createBusiness({ founderId: 'owner', name: 'Private' });
    expect(await svc.getBusiness(b.id, 'owner')).not.toBeNull();
    expect(await svc.getBusiness(b.id, 'intruder')).toBeNull();
    expect(await svc.listBusinesses('intruder')).toHaveLength(0);
  });
});
