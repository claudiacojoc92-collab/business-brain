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
  /** `evidence`: the exact source sentences behind the tension ("Why I'm saying this"), each cut to 200 chars at a
   *  clean boundary. Never empty: a tension without a verified quote is not shown (BUS-73). */
  readonly tensions: { readonly tension: string; readonly grounding: string; readonly sourceRefs: string[]; readonly evidence: { readonly page: string; readonly quote: string }[];
    /** About something NOT visible in the sources read: shown as such, never as a fact about the business. */
    readonly absence?: boolean }[];
  readonly confident: string[]; // still projected (BusinessPage + provenance); NOT rendered in the arc understanding moment
  readonly inferring: string[]; // still projected; NOT rendered in the arc understanding moment
  readonly unanswered: string[];
  /**
   * Strategic Depth W1 — the strategist's read, shown FIRST. `constraint`: the named constraint ({decided:true,text})
   * or an honest "not enough evidence" ({decided:false}); null = an older snapshot without one (card unchanged).
   * `stage`: the stage with its evidence, or undetermined; null = older snapshot.
   */
  readonly constraint: { readonly decided: true; readonly text: string } | { readonly decided: false } | null;
  /**
   * 2026-10-15 — the diagnosis as EARNED: `constraint` only when governance established every check (then `constraint`
   * above is decided too); otherwise a `hypothesis` worth testing. Older snapshots' "decided" constraints were never
   * earned, so they show as hypotheses. null = nothing to say yet.
   */
  readonly diagnosis?: { readonly state: 'hypothesis' | 'constraint'; readonly text: string } | null;
  /** v2 read (absent on older snapshots): what BB knows per dimension, what it will not conclude, what it does not trust,
   *  and why each question is worth asking. */
  readonly read?: {
    readonly model: { readonly dimension: string; readonly lines: { readonly text: string; readonly basis: 'observed' | 'declared' | 'inferred' | 'contradicted' }[] }[];
    readonly unknownDimensions: string[];
    /** `reason` set when code (not the model) drew the line: the card words it in the business's language. */
    readonly notConcluding: { readonly claim: string; readonly why: string; readonly reason?: 'no_goal' | 'not_established' }[];
    readonly untrusted: { readonly finding: string; readonly why: string; readonly reason?: 'sitemap' | 'technical' | 'sitemap_only' | 'unread' }[];
    /** `parts`: separate answers inside one question (metrics that can diverge, e.g. clients vs revenue). */
    readonly asks: { readonly question: string; readonly why: string; readonly parts?: string[];
      /** Why the question holds its place (A strategy-critical / B settles hypothesis `resolves` / C information value)
       *  and the dimension it fills: the founder view words "where I'd look first" from these, never from new facts. */
      readonly tier?: 'A' | 'B' | 'C'; readonly dimension?: string; readonly resolves?: number | string }[];
    /** Structural synthesis (2026-10-15; absent on older snapshots): what BB thinks the business is, the reversible
     *  hypotheses behind it (each with what else could explain it and what would change BB's mind), and whether BB is
     *  deliberately not naming a stage. When present, the card leads with it and the model above goes behind "What I read". */
    readonly structure?: {
      readonly synthesis: string;
      readonly hypotheses: { readonly pattern: string; readonly interpretation: string; readonly alternative: string; readonly reversal: string; readonly evidence: { readonly page: string; readonly quote: string }[] }[];
      readonly stageNotNamed: boolean;
      /** When the synthesis did not stand: a conservative read from governed facts only. `mechanisms` = the delivery /
       *  purchase mechanisms a trusted page shows (≥ 2 → "several mechanisms, not yet how they work together"); fewer →
       *  BB says it is not ready to form a structural read and goes to the questions. Never the inventory. */
      readonly fallback?: { readonly mechanisms: ('group_timetable' | 'one_to_one' | 'paid_first_step' | 'packages')[] };
      /**
       * FOUNDER VIEW (2026-10-16, projection only): the governed signals the card composes into "What you've built /
       * What stands out / Where I'd look first". No new fact: `mechanisms` = verified mechanism kinds; `places` = the two
       * locations a kept hypothesis compares (shared name prefix removed); `routes` = the synthesis clause that relates
       * the mechanisms; `placeFacts` = the governed sentences (synthesis, pattern) that show the location difference;
       * `placeHypothesis` = that hypothesis's index (the one a B question `resolves`).
       */
      readonly founder?: {
        readonly mechanisms: ('group_timetable' | 'one_to_one' | 'paid_first_step' | 'packages')[];
        readonly places?: string[]; readonly routes?: string; readonly placeFacts?: string[]; readonly placeHypothesis?: number;
        /** The team / public-offer gap at one place, in the source's words (role from the team page, service as the
         *  governed synthesis names it). When set, the card shows it instead of `placeFacts`. */
        readonly placeTeam?: { readonly place: string; readonly role: string; readonly service: string };
      };
    };
  };
  /** Founder-facing understanding (2026-10-16), written from the top strategic theses and re-checked: MY READ + WHAT I
   *  THINK MATTERS. Absent ⇒ the card composes its deterministic first read. The questions are in `read.asks`. */
  readonly founderRead?: { readonly snapshotId: string; readonly myRead: string; readonly matters: { readonly headline: string; readonly body: string }[] };
  /** WHAT I UNDERSTAND ABOUT YOUR BUSINESS (2026-10-17): governed facts only, projected at view time (business-snapshot). */
  readonly snapshot?: { readonly text: string };
  /** The understanding snapshot this card shows: lets the web tell a finished re-read (a new id) from one that failed. */
  readonly snapshotId?: string;
  readonly stage: {
    readonly stage: 'validating' | 'growth' | 'plateau'; readonly evidence: string[];
    /** A named part of the business at a different stage than the core (e.g. "the medical channel": validating). */
    readonly secondary: { readonly stage: 'validating' | 'growth' | 'plateau'; readonly area: string } | null;
  } | { readonly stage: 'undetermined' } | null;
}

/** Moment 3 — the strategist's SUBSTANTIVE reply to a founder correction (grounded in real state, not "✓ Got it"). */
export interface CorrectionReflection {
  readonly reflection: string; // what BB understood from the correction, in the founder's own terms
  readonly changes: string;    // what the correction changes about the understanding
  readonly holds: string;      // what it does NOT change — what still holds
  // No question (operator, 2026-10-12): correcting the understanding never opens a Q&A. Questions live only in the
  // capped conversation; after a correction the founder's next step is "Let's start".
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
export interface ArcMirror { readonly founderWords: string; readonly against: string; readonly tension: string;
  /** The UPDATED READ (2026-10-16): when present the card leads with it; the contrast stays the fallback (it may be
   *  empty when only the read stood). */
  readonly read?: { readonly now: string; readonly changed?: string; readonly matters?: string; readonly next?: string };
  /** Internal (persisted with the mirror, never rendered): how the founder's answers moved each strategic thesis. */
  readonly moves?: { readonly thesisId: string; readonly status: 'open' | 'strengthened' | 'weakened' | 'reversed' | 'sharpened' | 'unresolved'; readonly because: string }[] }
export interface ArcStrategy { readonly bet: string; readonly over: string; readonly horizon: string; readonly tradeOffs: string[]; readonly notNow: string[]; readonly reconsider: string[]; readonly proposalId: string | null; readonly adoptable: boolean;
  /** The constraint the strategy ASSUMED as the goal (the founder gave none before the cap); null when the goal is the founder's. */
  readonly assumedGoal?: string | null;
  /** What has to be checked before the bet starts (2026-10-17), e.g. free delivery capacity. Grounded, never a model call. */
  readonly before?: string[] }
export interface ArcWeekDay { readonly week: string[]; readonly today: string | null; readonly canCreate: boolean;
  /** Which canonical Today this is (BUS-82): a due follow-up, the selected plan move, or the move to unblock. */
  readonly todayKind?: 'follow_up' | 'plan' | 'blocked' | null;
  /** The week told as a strategist's chapter (operator, 2026-10-12). Absent only when the plan has no priorities. */
  readonly story?: ArcWeekStory | null }

/**
 * Moment 6 — the SAME plan (priorities, first action, done definition), told as a chapter in a story instead of a
 * project brief: where this week sits, what it actually is, why now, three beats, today's one move, and what done
 * looks like. Presentation only: it never adds a move, a number or a claim the plan and strategy don't hold.
 */
export interface ArcWeekStory {
  readonly planVersionId: string;  // the plan it tells; a new plan version → a new story
  readonly context: string;        // "Week 1 of your six-month push to a signed bank pilot."
  readonly statement: string;      // "The testnet becomes real this week."
  readonly whyNow: string;         // "Two banks are waiting on it. Everything else can wait."
  readonly chapters: { readonly title: string; readonly why: string }[]; // ≤ 3: the week's first actions, plan order, verb-first titles
  /** actionId = the plan action this story's "today" was told for (absent on stories saved before BUS-82). */
  readonly today: { readonly move: string; readonly detail: string; readonly actionId?: string };
  readonly doneLooksLike: string;
}
export interface WeekStoryInput {
  readonly businessName: string;
  readonly language: string;
  readonly goal: string;
  readonly horizon: string;
  readonly bet: string;
  readonly monthDirection: string;
  readonly priorities: { readonly title: string; readonly why: string }[]; // the month's arc, plan order (context only)
  readonly moves: { readonly what: string; readonly why: string }[];       // this week's beats: the first ≤ 3 actions, plan order
  readonly today: { readonly actionId: string; readonly what: string; readonly why: string; readonly done: string } | null; // the canonical Today's plan action, with its done
}
export interface IWeekStoryModel {
  /** Raw model draft (unguarded). May throw / return junk — `guardWeekStory` decides what survives. `rewrite` = the
   * consultant phrases a first draft used, for the one repair pass. */
  tell(input: WeekStoryInput, rewrite?: string[]): Promise<Partial<Omit<ArcWeekStory, 'planVersionId'>> | null>;
}
export interface ArcEmail { readonly subject: string; readonly body: string }
export interface ArcContainerItem { readonly labelKey: string; readonly statement: string; readonly provenance: 'observed' | 'declared' | 'inferred' | 'unknown' }
export interface ArcContainer { readonly items: ArcContainerItem[];
  /** Which unknowns the founder already answered (model-judged, guarded) and the fingerprint they were judged on.
   * The route persists these (founder_event arc_container_built) so a view never re-judges unchanged input. */
  readonly answered?: { readonly index: number; readonly answer: string }[]; readonly answeredKey?: string }

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
  /** Internal (2026-10-16): a strategic-thesis record composed during this view, for the route to persist (per
   *  snapshot) and strip before responding. Never rendered. */
  readonly internal?: { readonly theses?: import('./theses').ThesisRecord };
  readonly moment: ArcMoment;
  readonly businessName: string;
  /** A long operation (the business read, the theses, the mirror, the strategy) is still running for this business
   *  (2026-10-17): the view is a placeholder, poll again. Set only by the route, never rendered as a moment. */
  readonly pending?: string | null;
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
  /** Return { subject, body }. Never throw — on any failure return a safe, clearly-grounded fallback. `rewrite` = the
   * unbacked claims a first draft made ("a confirmed date"), for the one repair pass. */
  draft(input: EmailDraftInput, rewrite?: string[]): Promise<ArcEmail>;
}
