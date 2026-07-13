import type { CSSProperties } from 'react';

/**
 * Shared style vocabulary for the Business Read surface (S1-T6). Inline CSSProperties over the editorial
 * tokens (styles/tokens.css) — generalizes the RecommendationPreviewPage quote/kicker idiom. Typography +
 * whitespace + hairline --line carry the hierarchy; --gold is used only for structural section kickers,
 * NEVER to rank importance or manufacture urgency. --ok/--warn inks are never used here.
 */

// Section header — serif, the structural spine of the document.
export const sectionTitle: CSSProperties = { fontFamily: 'var(--serif)', fontSize: '1.35rem', fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--ink)', margin: '0 0 4px' };

// Small uppercase structural kicker (the one disciplined use of --gold).
export const kicker: CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.66rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, margin: '16px 0 8px' };

// Meta / dateline text.
export const meta: CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.78rem', color: 'var(--ink-3)', letterSpacing: '0.01em' };

// A claim statement — serif reading prose, verbatim from the Read.
export const claimText: CSSProperties = { fontFamily: 'var(--serif)', fontSize: '1.08rem', lineHeight: 1.5, color: 'var(--ink)', margin: '0 0 6px' };

// Verbatim receipt text — visually distinct from product prose: sans, soft panel, hairline border.
export const receiptQuote: CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.85rem', lineHeight: 1.55, color: 'var(--ink-2)', background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 13px', marginTop: 8 };

// Receipt source metadata line (shown only where stored).
export const receiptMeta: CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.7rem', color: 'var(--ink-3)', letterSpacing: '0.02em', marginTop: 6 };

// Epistemic label — differentiated by weight + CASE + structure, NOT color. A neutral hairline chip.
export const epistemicChip: CSSProperties = { display: 'inline-block', fontFamily: 'var(--sans)', fontSize: '0.62rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)', border: '1px solid var(--line-2)', borderRadius: 4, padding: '2px 7px' };

// Disclosure toggle — a quiet text button, no chrome, keyboard-native.
export const discButton: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: '4px 0', margin: 0, cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: '0.74rem', fontWeight: 500, letterSpacing: '0.01em', color: 'var(--ink-2)' };

// Quiet empty-section copy.
export const emptyCopy: CSSProperties = { fontFamily: 'var(--serif)', fontSize: '1rem', fontStyle: 'italic', lineHeight: 1.55, color: 'var(--ink-3)', margin: 0 };
