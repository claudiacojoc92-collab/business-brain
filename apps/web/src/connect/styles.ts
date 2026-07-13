import type { CSSProperties } from 'react';

/** Connect surface styles — the editorial token idiom (reads/ sibling). Quiet bordered blocks, not KPI tiles. */
export const card: CSSProperties = { border: '1px solid var(--line)', borderRadius: 12, padding: '20px 22px', marginBottom: 16, background: 'var(--surface)' };
export const cardTitle: CSSProperties = { fontFamily: 'var(--serif)', fontSize: '1.15rem', fontWeight: 500, color: 'var(--ink)', margin: '0 0 10px' };
export const statusLine: CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.82rem', color: 'var(--ink-2)', margin: '0 0 10px' };
export const note: CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.72rem', color: 'var(--ink-3)', margin: '8px 0 0' };
export const errorLine: CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.8rem', color: 'var(--warn-ink)', margin: '8px 0 0' };
export const input: CSSProperties = { background: 'var(--paper)', border: '1px solid var(--line-2)', borderRadius: 9, color: 'var(--ink)', fontSize: '0.95rem', padding: '10px 12px', outline: 'none', fontFamily: 'var(--sans)', width: '100%', boxSizing: 'border-box' };
export const primaryBtn = (enabled: boolean): CSSProperties => ({ alignSelf: 'flex-start', background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 9, cursor: enabled ? 'pointer' : 'not-allowed', fontFamily: 'var(--sans)', fontWeight: 500, fontSize: '0.9rem', padding: '10px 18px', opacity: enabled ? 1 : 0.4 });
export const quietBtn: CSSProperties = { background: 'none', border: '1px solid var(--line-2)', borderRadius: 9, cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: '0.8rem', color: 'var(--ink-2)', padding: '7px 14px' };
export const linkBtn: CSSProperties = { display: 'inline-block', background: 'var(--ink)', color: 'var(--paper)', textDecoration: 'none', borderRadius: 9, fontFamily: 'var(--sans)', fontWeight: 500, fontSize: '0.9rem', padding: '10px 18px' };
