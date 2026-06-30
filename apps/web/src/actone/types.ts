/**
 * Act I — shared types (Milestone 1, frontend-only / fixtures).
 * The phase union + transitions implement §7 of the Act I Build Specification.
 */

export type Phase =
  | 'contact'
  | 'connect'
  | 'analyzing'      // mocked holding state (timed; no spinner)
  | 'seeing'
  | 'seeing_verdict'
  | 'conversation'
  | 'absorbing'      // mocked holding state (timed; no spinner)
  | 'gift'
  | 'gift_reacted'
  | 'week'
  | 'complete';

export type RailFacet = 'business' | 'thinking' | 'voice' | 'rhythm';

export type EvidenceVisual = 'neutral' | 'bright' | 'recede';

/** Origin of a statement (Evidence & Trust Model) — metadata that travels with the data. */
export type Origin = 'i-know' | 'i-observed-sample' | 'you-told-me' | 'i-suspect';

/**
 * The single understanding carried out of the Seeing verdict.
 * Confirm → the observation, promoted (i-observed-sample, confirmed).
 * "Not quite" → the founder's correction replaces it (you-told-me, corrected);
 * an empty correction demotes the read to a hypothesis (i-suspect, corrected).
 */
export interface CarriedUnderstanding {
  text: string;
  origin: Origin;
  source: 'confirmed' | 'corrected';
}

/** Inline rich text: plain runs plus emphasis (italic) / bold runs — no dangerouslySetInnerHTML. */
export type Rich = ReadonlyArray<string | { em: string } | { b: string }>;

export interface EvidenceData {
  key: string;
  source: string;          // e.g. "instagram"
  text: string;
  relevant: boolean;       // true → brightens on the Seeing reveal; false → recedes
  origin: Origin;          // M1 sample evidence → 'i-observed-sample'
  pos: { left: string; top: string };
}

export interface GiftDraft {
  label: string;
  hook: string;
  body: string;
}

export interface WeekItem {
  day: string;
  title: string;
  note: string;
  origin: Origin;          // follows from the confirmed/corrected understanding → 'you-told-me'
}

export interface ConnectionSource {
  name: string;
}
