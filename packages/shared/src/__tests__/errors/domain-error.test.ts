import { describe, it, expect } from 'vitest';
import {
  DomainError,
  PreconditionFailed,
  NotFoundError,
  ConflictError,
} from '../../errors/domain-error';

describe('DomainError subclasses', () => {
  it('PreconditionFailed has httpStatus 403', () => {
    expect(new PreconditionFailed('X', 'x').httpStatus).toBe(403);
  });
  it('NotFoundError has httpStatus 404', () => {
    expect(new NotFoundError('X', 'x').httpStatus).toBe(404);
  });
  it('ConflictError has httpStatus 409', () => {
    expect(new ConflictError('X', 'x').httpStatus).toBe(409);
  });
  it('name equals subclass name', () => {
    expect(new PreconditionFailed('X', 'x').name).toBe('PreconditionFailed');
    expect(new NotFoundError('X', 'x').name).toBe('NotFoundError');
    expect(new ConflictError('X', 'x').name).toBe('ConflictError');
  });
  it('is instanceof DomainError and Error', () => {
    const e = new PreconditionFailed('X', 'x');
    expect(e instanceof DomainError).toBe(true);
    expect(e instanceof Error).toBe(true);
  });
  it('code is accessible', () => {
    expect(new PreconditionFailed('FOUNDER_NOT_ACTIVE', 'msg').code).toBe('FOUNDER_NOT_ACTIVE');
  });
});
