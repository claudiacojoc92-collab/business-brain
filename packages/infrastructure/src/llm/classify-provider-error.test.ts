import { describe, it, expect } from 'vitest';
import { classifyProviderError } from './classify-provider-error';

function sdk(name: string, status?: number): Error {
  const e = new Error(name);
  (e as unknown as { name: string }).name = name;
  if (status !== undefined) (e as unknown as { status: number }).status = status;
  return e;
}

describe('classifyProviderError', () => {
  it('maps HTTP-status provider errors to granular codes', () => {
    expect(classifyProviderError(sdk('RateLimitError', 429))?.code).toBe('MODEL_RATE_LIMITED');
    expect(classifyProviderError(sdk('InternalServerError', 529))?.code).toBe('MODEL_OVERLOADED');
    expect(classifyProviderError(sdk('InternalServerError', 503))?.code).toBe('MODEL_UNAVAILABLE');
    expect(classifyProviderError(sdk('InternalServerError', 500))?.code).toBe('MODEL_UNAVAILABLE');
    expect(classifyProviderError(sdk('BadRequestError', 400))?.code).toBe('MODEL_REQUEST_INVALID');
    expect(classifyProviderError(sdk('BadRequestError', 413))?.code).toBe('MODEL_REQUEST_INVALID');
    expect(classifyProviderError(sdk('AuthenticationError', 401))?.code).toBe('MODEL_AUTH');
    expect(classifyProviderError(sdk('PermissionDeniedError', 403))?.code).toBe('MODEL_AUTH');
  });

  it('maps network errors (no HTTP status) by name', () => {
    expect(classifyProviderError(sdk('APIConnectionTimeoutError'))?.code).toBe('MODEL_TIMEOUT');
    expect(classifyProviderError(sdk('APIConnectionError'))?.code).toBe('MODEL_UNAVAILABLE');
  });

  it('flags only a rejected key as the operational emergency, and marks retryability honestly', () => {
    expect(classifyProviderError(sdk('AuthenticationError', 401))).toMatchObject({ operational: true, retryable: false });
    expect(classifyProviderError(sdk('RateLimitError', 429))).toMatchObject({ operational: false, retryable: true });
    expect(classifyProviderError(sdk('BadRequestError', 400))).toMatchObject({ operational: false, retryable: false });
    expect(classifyProviderError(sdk('InternalServerError', 500))).toMatchObject({ operational: false, retryable: true });
  });

  it('returns null for things that are not provider errors', () => {
    expect(classifyProviderError(null)).toBeNull();
    expect(classifyProviderError(new Error('plain'))).toBeNull();            // no status, name "Error"
    expect(classifyProviderError({ status: 500 })).toBeNull();               // numeric status but no "*Error" name
    expect(classifyProviderError(sdk('SomethingError', 418))).toBeNull();    // unmapped status
    expect(classifyProviderError('a string')).toBeNull();
  });
});
