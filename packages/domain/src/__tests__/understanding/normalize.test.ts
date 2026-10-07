import { describe, it, expect } from 'vitest';
import {
  normalizePublication,
  NORMALIZATION_RULE_KEY,
  NORMALIZATION_RULE_VERSION,
} from '../../understanding';

const base = { externalId: 'p1', caption: 'Hello world', mediaType: 'reel', occurredAt: '2025-01-06T09:00:00.000Z' };

describe('normalizePublication', () => {
  it('normalizes leading/trailing whitespace and CRLF line endings, and declares the loss', () => {
    const r = normalizePublication({ ...base, caption: '  line one\r\nline two  ' }, undefined);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.caption).toBe('line one\nline two');
    expect(r.extraction.ruleKey).toBe(NORMALIZATION_RULE_KEY);
    expect(r.extraction.ruleVersion).toBe(NORMALIZATION_RULE_VERSION);
    expect(r.extraction.mode).toBe('deterministic');
    expect(r.extraction.reproducible).toBe(true);
    expect(r.extraction.informationLoss).toBeDefined();
  });

  it('declares no information loss when caption is already clean', () => {
    const r = normalizePublication(base, undefined);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.extraction.informationLoss).toBeUndefined();
  });

  it('handles an absent bio (payload has no bio)', () => {
    const r = normalizePublication(base, undefined);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('bio' in r.payload).toBe(false);
  });

  it('drops a whitespace-only bio', () => {
    const r = normalizePublication(base, '   \n  ');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('bio' in r.payload).toBe(false);
  });

  it('normalizes a real bio', () => {
    const r = normalizePublication(base, '  Physio clinic  ');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.bio).toBe('Physio clinic');
  });

  it('rejects an empty / whitespace-only caption', () => {
    const r = normalizePublication({ ...base, caption: '   \n ' }, undefined);
    expect(r).toEqual({ ok: false, reasonCode: 'empty_caption' });
  });

  it('rejects an unsupported media type', () => {
    const r = normalizePublication({ ...base, mediaType: 'gif' }, undefined);
    expect(r).toEqual({ ok: false, reasonCode: 'invalid_media_type' });
  });

  it('normalizes media type casing/whitespace', () => {
    const r = normalizePublication({ ...base, mediaType: '  REEL ' }, undefined);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.mediaType).toBe('reel');
  });

  it('rejects an invalid timestamp', () => {
    const r = normalizePublication({ ...base, occurredAt: 'not-a-date' }, undefined);
    expect(r).toEqual({ ok: false, reasonCode: 'invalid_timestamp' });
  });
});
