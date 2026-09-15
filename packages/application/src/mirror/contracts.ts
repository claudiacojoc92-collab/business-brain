/**
 * THE MIRROR — the differentiator.
 *
 * Not a profile, not an assessment, not a summary. It reflects the founder's own inputs back and holds them
 * against what BB observed, then surfaces where they don't match. The founder cannot argue with it because it
 * is their own words and BB's own evidence, side by side.
 *
 * It is a PROJECTION over existing state — the understanding snapshot (observed), founder_state scope≠self
 * (told-about-business), founder_state scope='founder_self' (told-about-self) — plus a contrast calculation.
 * No new synthesis engine, no new tables, no founder-profile surface.
 */

export type MirrorLane = 'observed' | 'business' | 'self' | 'strategy';
export type Provenance = 'observed' | 'declared' | 'inferred' | 'unknown';

export interface MirrorLaneItem {
  readonly label: string;       // short heading ("Your offer", "What you told me")
  readonly statement: string;
  readonly provenance?: Provenance;
  readonly sources?: string[];  // observed lane only — where BB saw it
}

/**
 * ONE reflected mismatch. BOTH sides are real: `founderWords` is always the founder's own statement (business
 * or self lane); `against` is what it doesn't line up with — observed evidence, another declared fact, or the
 * held strategy. `tension` is the calm, specific articulation. A mismatch missing either cited side, or with
 * an empty tension, is dropped — the mirror never states one side or fabricates a contrast.
 */
export interface MirrorMismatch {
  readonly founderWords: string;
  readonly founderLane: 'business' | 'self';
  readonly against: string;
  readonly againstLane: MirrorLane;
  readonly tension: string;
}

export interface MirrorView {
  readonly observed: MirrorLaneItem[];
  readonly business: MirrorLaneItem[];
  readonly self: MirrorLaneItem[];
  readonly contrasts: MirrorMismatch[];
  /** true once the founder has answered at least one self lane — the mirror needs Lane 3 to be meaningful. */
  readonly hasSelf: boolean;
}

export interface MirrorContrastInput {
  readonly businessName: string;
  readonly interfaceLanguage: string;
  readonly observed: string[];
  readonly business: string[];
  readonly self: string[];
  readonly heldStrategy: { bet: string; notNow: string[]; reconsider: string[] } | null;
}

export interface MirrorContrastOutput {
  readonly mismatches: MirrorMismatch[];
}

export interface IMirrorModelPort {
  /** Find REAL mismatches only. Never throw, never fabricate — on any failure return { mismatches: [] }. */
  contrast(input: MirrorContrastInput): Promise<MirrorContrastOutput>;
}
