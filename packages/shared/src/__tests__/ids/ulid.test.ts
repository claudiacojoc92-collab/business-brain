import { describe, it, expect } from 'vitest';
import { generateId, validateId, generateCorrelationId } from '../../ids/ulid';

describe('generateId', () => {
  it('returns a 26-character string', () => {
    expect(generateId()).toHaveLength(26);
  });

  it('returns only ULID alphabet characters', () => {
    expect(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/.test(generateId())).toBe(true);
  });

  it('100 sequential IDs are already in sorted order', () => {
    const ids = Array.from({ length: 100 }, () => generateId());
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('generateCorrelationId is the same function reference as generateId', () => {
    expect(generateCorrelationId).toBe(generateId);
  });
});

describe('validateId', () => {
  it('returns true for a valid ULID', () => {
    expect(validateId(generateId())).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(validateId('')).toBe(false);
  });

  it('returns false for UUID v4 format', () => {
    expect(validateId('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
  });

  it('returns false for 25-character string', () => {
    expect(validateId('01ARZ3NDEKTSV4RRFFQ69G5FA')).toBe(false);
  });

  it('returns false for 27-character string', () => {
    expect(validateId('01ARZ3NDEKTSV4RRFFQ69G5FAVX')).toBe(false);
  });

  it('returns false for lowercase ULID', () => {
    expect(validateId(generateId().toLowerCase())).toBe(false);
  });
});
