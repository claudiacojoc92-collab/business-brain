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

/** Inline rich text: plain runs plus emphasis (italic) / bold runs — no dangerouslySetInnerHTML. */
export type Rich = ReadonlyArray<string | { em: string } | { b: string }>;

export interface EvidenceData {
  key: string;
  source: string;          // e.g. "instagram"
  text: string;
  relevant: boolean;       // true → brightens on the Seeing reveal; false → recedes
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
}

export interface ConnectionSource {
  name: string;
}
