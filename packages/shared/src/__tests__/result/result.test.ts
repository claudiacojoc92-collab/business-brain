import { describe, it, expect } from 'vitest';
import { ok, err, Ok, Err, type Result } from '../../result/result';

describe('ok()', () => {
  it('isOk is true', () => { expect(ok('v').isOk).toBe(true); });
  it('isErr is false', () => { expect(ok('v').isErr).toBe(false); });
  it('value is the wrapped value', () => { expect(ok('hello').value).toBe('hello'); });
  it('accepts null', () => { expect(ok(null).value).toBeNull(); });
  it('accepts undefined', () => { expect(ok(undefined).value).toBeUndefined(); });
  it('returns an instance of Ok', () => { expect(ok('v') instanceof Ok).toBe(true); });
});

describe('err()', () => {
  it('isOk is false', () => { expect(err('e').isOk).toBe(false); });
  it('isErr is true', () => { expect(err('e').isErr).toBe(true); });
  it('error is the wrapped error', () => { expect(err('oops').error).toBe('oops'); });
  it('returns an instance of Err', () => { expect(err('e') instanceof Err).toBe(true); });
});

describe('Result type narrowing', () => {
  it('narrows to Ok branch', () => {
    const r: Result<string, Error> = ok('hello');
    if (r.isOk) {
      expect(r.value).toBe('hello');
    } else {
      throw new Error('Should not reach Err branch');
    }
  });

  it('narrows to Err branch', () => {
    const r: Result<string, Error> = err(new Error('fail'));
    if (r.isErr) {
      expect(r.error.message).toBe('fail');
    } else {
      throw new Error('Should not reach Ok branch');
    }
  });
});
