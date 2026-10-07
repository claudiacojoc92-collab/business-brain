/**
 * DAY ONE — the arc. Nine moments, one continuous flow, one surface. The founder never sees a tab, a panel,
 * or a "stage"; the strategist's message changes as the arc progresses. Every moment REUSES an existing engine
 * (understanding, conversation, mirror, strategy, plan, voice) — the only genuinely new piece is the email at
 * Moment 8. The arc's current moment is DERIVED (a pure function) from durable phase flags (founder_event) +
 * engine state, so it survives refresh/reopen and never skips a moment.
 */

export type ArcMoment =
  | 'pour_in'        // 1 — add sources; persists until "Done adding — start" (then a progress state while BB reads)
  | 'understanding'  // 2 — "here's what I see"; confirm/correct (the FIRST thing shown after pour-in — no "describe
                     //      your business" step: the bridge synthesizes during a loading state, not a founder input)
  | 'conversation'   // 3 — the adaptive onboarding conversation (+ founder-self lanes), after understanding is confirmed
  | 'mirror'         // 4 — one contrast held in tension
  | 'strategy'       // 5 — the bet + reconsider; adopt/challenge
  | 'week_day'       // 6 — this week's moves + today's one move
  | 'email'          // 7 — the first work item (a real email)
  | 'container'      // 8 — offer the read-only "what I know" view
  | 'done';          // arc complete → the normal home briefing takes over

export interface ArcFlags {
  readonly pourInDone: boolean;
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
export type ArcSourceType = 'website' | 'link' | 'pdf' | 'docx' | 'text' | 'instagram';
export interface ArcSource { readonly url: string; readonly type: ArcSourceType; readonly detail?: string }
/**
 * Moment 3 — a DIAGNOSTIC reading, not a description. `does`/`serves` are brief context; the strategist's real
 * work is in the rest: what STANDS OUT (unusual within this business), what does NOT line up across the sources
 * (tensions — the diagnostic core, projected from the engine's contradictions), what BB is CONFIDENT about from
 * evidence vs. what it is INFERRING from pattern (which may be wrong), and what the sources CANNOT answer (what
 * BB needs the founder to say).
 */
export interface ArcUnderstanding {
  readonly does: string;
  readonly serves: string;
  readonly standsOut: string;
  // FIX 2c — each tension carries ONE grounding line so its referent resolves in the card (never three sentences).
  // sourceRefs back the tension behind a collapsed "why I'm saying this" disclosure (the proof, on demand).
  readonly tensions: { readonly tension: string; readonly grounding: string; readonly sourceRefs: string[] }[];
  readonly confident: string[]; // still projected (BusinessPage + provenance); NOT rendered in the arc understanding moment
  readonly inferring: string[]; // still projected; NOT rendered in the arc understanding moment
  readonly unanswered: string[];
}

/** Moment 3 — the strategist's SUBSTANTIVE reply to a founder correction (grounded in real state, not "✓ Got it"). */
export interface CorrectionReflection {
  readonly reflection: string; // what BB understood from the correction, in the founder's own terms
  readonly changes: string;    // what the correction changes about the understanding
  readonly holds: string;      // what it does NOT change — what still holds
  readonly ask: string;        // the invitation to add anything else
}
export interface CorrectionReflectionInput {
  readonly businessName: string;
  readonly language: string;
  readonly correction: string;
  readonly does: string;
  readonly standsOut: string;
  readonly tensions: string[];
  readonly confident: string[];
}
export interface ICorrectionReflectionModel {
  /** Grounded reflection on a founder correction. Never throws — fails safe to a plain, honest acknowledgment. */
  reflect(input: CorrectionReflectionInput): Promise<CorrectionReflection>;
}
export interface ArcTurn { readonly id: string; readonly role: 'founder' | 'bb'; readonly content: string }
export interface ArcMirror { readonly founderWords: string; readonly against: string; readonly tension: string }
export interface ArcStrategy { readonly bet: string; readonly over: string; readonly horizon: string; readonly tradeOffs: string[]; readonly notNow: string[]; readonly reconsider: string[]; readonly proposalId: string | null; readonly adoptable: boolean }
export interface ArcWeekDay { readonly week: string[]; readonly today: string | null; readonly canCreate: boolean }
export interface ArcEmail { readonly subject: string; readonly body: string }
export interface ArcContainerItem { readonly labelKey: string; readonly statement: string; readonly provenance: 'observed' | 'declared' | 'inferred' | 'unknown' }
export interface ArcContainer { readonly items: ArcContainerItem[] }

/**
 * A per-moment error that must NOT fail the whole arc surface. `generation` = a model call for this moment
 * failed (mirror/strategy/plan/opener) — the UI shows a retry for THIS moment only. `pourin_empty`/`pourin_failed`
 * = the pour-in bridge produced nothing / threw — the founder stays on pour-in and fixes their sources. The UI
 * localizes the message by kind (content language), so no English leaks in.
 */
export type ArcErrorKind =
  | 'generation'          // a model call for this moment threw — genuinely transient; retry is the right action
  | 'pourin_empty'        // the pour-in bridge produced nothing — founder fixes their sources
  | 'pourin_failed'       // the pour-in bridge threw — founder fixes their sources
  | 'need_goal'           // NOT a failure: strategy needs a founder goal that was never captured (or was mis-filed)
  | 'need_understanding'  // no governed understanding yet — re-give the site or describe the business
  | 'strategy_insufficient'; // understanding + goal present, but the strategy still could not be formed (detail says why)

/** The founder's own words, reflected back for goal confirmation. `statement` is VERBATIM in the language it was
 * captured in — never translated. `stateId` is the mis-filed founder_state row it came from (null when asking cold). */
export interface ArcGoalCandidate {
  readonly stateId: string | null;
  readonly statement: string;
}

export interface ArcView {
  readonly moment: ArcMoment;
  readonly businessName: string;
  // per-moment status — never fails the whole surface. `need_goal` is a POSITIVE step (confirm your goal), not an
  // error; `goalCandidate` carries the founder's own words to reflect back (or null to ask cold); `detail` explains
  // a strategy_insufficient. The UI localizes chrome by kind but renders `goalCandidate.statement` verbatim.
  readonly error?: { readonly kind: ArcErrorKind; readonly goalCandidate?: ArcGoalCandidate | null; readonly detail?: string | null } | null;
  // The language BB read the business in (the source/founder language). During the arc the UI localizes its
  // CHROME (section labels, buttons, question tag, provenance) to THIS, so chrome never mismatches the content.
  readonly contentLanguage?: string | null;
  // Moment 6 — a transient one-line "the bet changed because you said X" note shown right after a challenge.
  readonly strategyChange?: { readonly because: string } | null;
  readonly sources?: ArcSource[];          // pour_in — every functional source the founder has added (with type)
  readonly igConnected?: boolean;          // pour_in — whether the founder's Instagram is connected (drives the affordance)
  readonly understanding?: ArcUnderstanding; // understanding / (container derives from same engine)
  readonly turns?: ArcTurn[];              // reading / conversation
  readonly coverage?: { readonly key: string; readonly covered: boolean }[]; // conversation — the quiet progress map
  readonly mirror?: ArcMirror | null;      // mirror
  readonly strategy?: ArcStrategy;         // strategy
  readonly weekDay?: ArcWeekDay;           // week_day
  readonly email?: ArcEmail | null;        // email (null → not drafted yet)
  readonly correctionReflection?: CorrectionReflection; // understanding — the reply to a just-sent correction (transient)
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
