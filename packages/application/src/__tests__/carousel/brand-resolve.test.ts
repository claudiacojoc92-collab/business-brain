import { describe, it, expect } from 'vitest';
import { resolveBrandContext } from '../../carousel/brand-resolve';
import type { CarouselSourceRef } from '../../carousel/contracts';

const media = (over: Partial<CarouselSourceRef>): CarouselSourceRef => ({
  sourceRefId: 's', sourceType: 'uploaded_image', provenance: 'founder upload', reuseRight: 'founder_uploaded', mediaRef: 'media/s.png', ...over,
});

describe('Slice 6 — honest brand resolution (discover-first over REAL signals only)', () => {
  it('with no explicit constraints and no brand asset, returns the restrained neutral default (unknown stays unknown)', () => {
    const b = resolveBrandContext('B', null, [media({ sourceType: 'uploaded_image' })]);
    expect(b.mode).toBe('restrained_default');
    expect(b.constraints).toBeUndefined();
  });

  it('discovers a logo from a founder-uploaded brand_asset (the one genuinely automatic signal)', () => {
    const b = resolveBrandContext('B', null, [media({ sourceRefId: 'logo1', sourceType: 'brand_asset', mediaRef: 'media/logo1.png' })]);
    expect(b.mode).toBe('known');
    expect(b.constraints?.logoRef).toBe('media/logo1.png');
    expect(b.constraints?.palette).toBeUndefined(); // never invented
  });

  it('unions explicit constraints and never fabricates fields that were not provided', () => {
    const b = resolveBrandContext('B', { palette: ['#0a0a0a', '#c8102e'] }, []);
    expect(b.mode).toBe('known');
    expect(b.constraints?.palette).toEqual(['#0a0a0a', '#c8102e']);
    expect(b.constraints?.typePreference).toBeUndefined();
    expect(b.constraints?.imageryStyle).toBeUndefined();
  });

  it('explicit logoRef wins over a discovered brand asset', () => {
    const b = resolveBrandContext('B', { logoRef: 'explicit/logo.png' }, [media({ sourceType: 'brand_asset', mediaRef: 'media/other.png' })]);
    expect(b.constraints?.logoRef).toBe('explicit/logo.png');
  });

  it('an empty palette is not a signal (does not flip to known)', () => {
    const b = resolveBrandContext('B', { palette: [] }, []);
    expect(b.mode).toBe('restrained_default');
  });
});
