/**
 * DAY ONE — the arc. Nine moments, one continuous flow, one surface. The founder never sees a tab, a panel,
 * or a "stage"; the strategist's message changes as the arc progresses. Every moment REUSES an existing engine
 * (understanding, conversation, mirror, strategy, plan, voice) — the only genuinely new piece is the email at
 * Moment 8. The arc's current moment is DERIVED (a pure function) from durable phase flags (founder_event) +
 * engine state, so it survives refresh/reopen and never skips a moment.
 */

export type ArcMoment =
  | 'pour_in'        // 1 — add sources; persists until "Done adding — start"
  | 'reading'        // 2 — "I'm reading… tell me a few words"
  | 'understanding'  // 3 — "here's what I see"; confirm/correct
  | 'conversation'   // 4 — the adaptive onboarding conversation (+ founder-self lanes)
  | 'mirror'         // 5 — one contrast held in tension
  | 'strategy'       // 6 — the bet + reconsider; adopt/challenge
  | 'week_day'       // 7 — this week's moves + today's one move
  | 'email'          // 8 — the first work item (a real email)
  | 'container'      // 9 — offer the read-only "what I know" view
  | 'done';          // arc complete → the normal home briefing takes over

export interface ArcFlags {
  readonly pourInDone: boolean;
  readonly readingDone: boolean;
  readonly understandingConfirmed: boolean;
  readonly mirrorSeen: boolean;
  readonly emailExported: boolean;
  readonly containerSeen: boolean;
}

/** The inputs to the pure moment computation — durable flags + a snapshot of engine state. */
export interface ArcState {
  readonly flags: ArcFlags;
  readonly understandingPresent: boolean;
  readonly conversationReady: boolean;
  readonly strategyAdopted: boolean;
  readonly planActive: boolean;
}

// ── per-moment payloads (only the current moment's field is populated) ──
export interface ArcSource { readonly url: string }
export interface ArcUnderstanding { readonly does: string; readonly serves: string; readonly standsOut: string; readonly confident: string[]; readonly unsure: string[] }
export interface ArcTurn { readonly id: string; readonly role: 'founder' | 'bb'; readonly content: string }
export interface ArcMirror { readonly founderWords: string; readonly against: string; readonly tension: string }
export interface ArcStrategy { readonly bet: string; readonly over: string; readonly horizon: string; readonly reconsider: string[]; readonly proposalId: string | null; readonly adoptable: boolean }
export interface ArcWeekDay { readonly week: string[]; readonly today: string | null; readonly canCreate: boolean }
export interface ArcEmail { readonly subject: string; readonly body: string }
export interface ArcContainerItem { readonly label: string; readonly statement: string; readonly provenance: 'observed' | 'declared' | 'inferred' | 'unknown' }
export interface ArcContainer { readonly items: ArcContainerItem[] }

export interface ArcView {
  readonly moment: ArcMoment;
  readonly businessName: string;
  readonly sources?: ArcSource[];          // pour_in
  readonly understanding?: ArcUnderstanding; // understanding / (container derives from same engine)
  readonly turns?: ArcTurn[];              // reading / conversation
  readonly mirror?: ArcMirror | null;      // mirror
  readonly strategy?: ArcStrategy;         // strategy
  readonly weekDay?: ArcWeekDay;           // week_day
  readonly email?: ArcEmail | null;        // email (null → not drafted yet)
  readonly container?: ArcContainer;       // container
}

// ── the one new engine: the email drafter (grounded in strategy + voice + the move) ──
export interface EmailDraftInput {
  readonly businessName: string;
  readonly interfaceLanguage: string;
  readonly strategyBet: string;
  readonly audience: string;
  readonly todaysMove: string;
  readonly voiceBoundaries: string[];   // what the voice must / must not do (from the voice model), may be []
  readonly founderContext: string[];    // a few grounded founder-declared facts, may be []
}
export interface IEmailModelPort {
  /** Return { subject, body }. Never throw — on any failure return a safe, clearly-grounded fallback. */
  draft(input: EmailDraftInput): Promise<ArcEmail>;
}
