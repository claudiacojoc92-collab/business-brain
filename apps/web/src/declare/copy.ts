/**
 * Founder-facing copy for the declaration surface (P1 · Slice 1). Quiet, plain, verdict-free — no hype,
 * no urgency, no "connect more" nudge (Article VI / PI-08). Per-field labels come from the API questions;
 * this module holds only the framing and state strings.
 */
export const DECLARE_COPY = {
  title: 'Tell me what I can’t see',
  intro:
    'I can read what your business shows the world. What I can’t see is what you’re actually trying to build — so tell me directly. You can answer as few or as many as you like.',
  submit: 'Save what I’ve told you',
  submitting: 'Saving…',
  success: 'Saved. I’ve kept what you told me — it’s yours, and you can change it any time.',
  errorEmpty: 'Add at least one answer before saving.',
  errorGeneric: 'I couldn’t save that. Nothing was changed — you can try again.',
  loading: 'Loading…',
  yourReads: 'Your Reads',
  account: 'Account',
} as const;
