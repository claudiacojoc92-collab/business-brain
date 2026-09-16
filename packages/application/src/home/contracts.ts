/**
 * THE HOME SURFACE — the strategist's presence, not a dashboard.
 *
 * A delivery projection over held state (understanding + current strategy + Today + the last change). It
 * produces ONE short message and THREE actions — never a report. No new engine, no new tables: it reads what
 * the existing services already hold and composes how it is DELIVERED.
 *
 * Lines and actions are emitted as i18n keys (+ interpolation vars), so the strategist stays tri-lingual and
 * the composition is deterministic and testable — the phrasing lives in the web message catalog.
 */

export interface HomeLine {
  readonly key: string;
  readonly vars?: Record<string, string>;
}

export type HomeActionKind = 'do' | 'talk' | 'why';

export interface HomeAction {
  readonly kind: HomeActionKind;
  readonly labelKey: string;
  /** relative destination under /b/:id (e.g. "/strategy"); null → open the Talk drawer / focus the input. */
  readonly to: string | null;
}

export interface HomeContext {
  readonly name: string;
  readonly day: number | null;   // day N of the bet (from adoptedAt), null before a bet is held
  readonly bet: string | null;   // the short bet label, null before a bet is held
}

export interface HomeBriefing {
  readonly phase: 'empty' | 'briefing';
  readonly context: HomeContext;
  readonly lines: HomeLine[];    // 3–6 short lines, in order; empty when phase='empty'
  readonly actions: HomeAction[]; // up to 3: [do, talk, why]
}

export interface HomeBriefingInput {
  readonly businessName: string;
  readonly now: string;          // ISO — for the day-of-the-bet count
  readonly understandingPresent: boolean;
  readonly strategy: { bet: string; adoptedAt: string | null } | null;
  readonly today: {
    state: 'active' | 'none';
    move: { what: string; canCreate: boolean } | null;
    blocked: { what: string } | null;
  };
  /** the one "what changed" line, already resolved by the caller (from the return-loop / todayNote reader). */
  readonly changeLine: HomeLine | null;
}
