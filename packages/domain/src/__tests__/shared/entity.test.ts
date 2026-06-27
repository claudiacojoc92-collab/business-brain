import { describe, it, expect } from 'vitest';
import { Entity } from '../../shared/entity';

class TestEntity extends Entity {
  constructor(id: string, readonly name: string) {
    super(id);
  }
}

class OtherEntity extends Entity {
  constructor(id: string) {
    super(id);
  }
}

describe('Entity', () => {
  it('stores the id', () => {
    expect(new TestEntity('e-01', 'Alice').id).toBe('e-01');
  });

  it('two entities with same id and type are equal', () => {
    const a = new TestEntity('e-01', 'Alice');
    const b = new TestEntity('e-01', 'Bob');
    expect(a.equals(b)).toBe(true);
  });

  it('two entities with different ids are not equal', () => {
    const a = new TestEntity('e-01', 'Alice');
    const b = new TestEntity('e-02', 'Alice');
    expect(a.equals(b)).toBe(false);
  });

  it('entities of different types are not equal even with same id', () => {
    const a = new TestEntity('e-01', 'Alice');
    const b = new OtherEntity('e-01');
    expect(a.equals(b)).toBe(false);
  });
});
