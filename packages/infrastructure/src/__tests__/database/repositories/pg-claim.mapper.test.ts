import { describe, it, expect } from 'vitest';
import { reconstructClaimObject } from '../../../database/repositories/pg-claim.repository';

/**
 * §6 — the row→ClaimObject mapper must reconstruct the EXACT scalar type and reject malformed rows with a
 * governed infrastructure error (never fabricate a value). These are pure-function unit tests (no DB).
 */
describe('reconstructClaimObject — exact typed reconstruction', () => {
  it('reconstructs a string', () => {
    expect(reconstructClaimObject({ id: '1', object_type: 'string', object_text: 'coaching', object_number: null, object_bool: null })).toBe('coaching');
  });
  it('reconstructs a number (finite)', () => {
    expect(reconstructClaimObject({ id: '1', object_type: 'number', object_text: null, object_number: 2, object_bool: null })).toBe(2);
    expect(reconstructClaimObject({ id: '1', object_type: 'number', object_text: null, object_number: 0.1, object_bool: null })).toBe(0.1);
  });
  it('reconstructs a boolean', () => {
    expect(reconstructClaimObject({ id: '1', object_type: 'boolean', object_text: null, object_number: null, object_bool: false })).toBe(false);
  });
  it('does not confuse "1" (string) with 1 (number)', () => {
    expect(reconstructClaimObject({ id: '1', object_type: 'string', object_text: '1', object_number: null, object_bool: null })).toBe('1');
    expect(reconstructClaimObject({ id: '1', object_type: 'number', object_text: null, object_number: 1, object_bool: null })).toBe(1);
  });
});

describe('reconstructClaimObject — malformed rows throw (never fabricate)', () => {
  it('wrong discriminator', () => {
    expect(() => reconstructClaimObject({ id: '1', object_type: 'date', object_text: 'x', object_number: null, object_bool: null })).toThrow(/malformed|unknown/);
  });
  it('missing selected value', () => {
    expect(() => reconstructClaimObject({ id: '1', object_type: 'string', object_text: null, object_number: null, object_bool: null })).toThrow(/malformed/);
  });
  it('multiple selected values', () => {
    expect(() => reconstructClaimObject({ id: '1', object_type: 'string', object_text: 'x', object_number: 5, object_bool: null })).toThrow(/malformed/);
  });
  it('non-finite number', () => {
    expect(() => reconstructClaimObject({ id: '1', object_type: 'number', object_text: null, object_number: Infinity, object_bool: null })).toThrow(/malformed/);
    expect(() => reconstructClaimObject({ id: '1', object_type: 'number', object_text: null, object_number: NaN, object_bool: null })).toThrow(/malformed/);
  });
  it('type/value column mismatch (number discriminator, text populated)', () => {
    expect(() => reconstructClaimObject({ id: '1', object_type: 'number', object_text: 'x', object_number: null, object_bool: null })).toThrow(/malformed/);
  });
  it('the error message never contains the object value', () => {
    try {
      reconstructClaimObject({ id: 'c9', object_type: 'string', object_text: 'SECRET_VALUE', object_number: 7, object_bool: null });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).not.toContain('SECRET_VALUE');
      expect((e as Error).message).toContain('c9');
    }
  });
});
