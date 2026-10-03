/**
 * Attribution by asking — V081 `workspace.reach_report`.
 *
 * A founder-led service business cannot attribute technically (analytics is useless at that scale), but the
 * owner CAN ask one question at the door. BB collects the founder's own weekly answer — how many new people
 * came, and how they heard — as REFLECTIVE, founder-owned data: their report, their words, their data.
 *
 * HARD WALL (enforced by reach-wall.test.ts). This data is reflective-only. It is NEVER a licensed proposition
 * and MUST NOT reach any asset generator (carousel / reel / voice). "You told me 3 of the 7 new people came
 * from Instagram" is sayable BACK TO THE FOUNDER as their own words; it is NOT a world-fact BB may publish, and
 * "the reel brought 3 people" is a causal claim BB never makes. The claim-safety kernel has no "attributed to
 * founder report" escape hatch, so if this ever leaked into `licensedPropositions` it would either be blocked
 * (good) or — worse, if mislabelled — laundered into a published carousel as a performance claim. The wall
 * exists precisely to stop that back door.
 *
 * NOT WIRED to the impact evaluator yet (by decision — store + reflect only). The shape below is deliberately
 * the shape the evaluator consumes, so the later connection is a thin call. See IMPACT WIRING in reach.service.ts.
 */

export interface ReachReport {
  readonly id: string;
  readonly businessId: string;
  readonly accountId: string;
  /** ISO date (Monday) of the week this answer covers. */
  readonly weekStart: string;
  /** ISO date (exclusive) one week after weekStart. */
  readonly weekEnd: string;
  /** How many new people came this week, if the founder gave a number. */
  readonly newPeopleCount: number | null;
  /** The founder's own words — how the new people heard about them. Preserved verbatim. */
  readonly rawText: string;
  /** Optional light single-tag structure (e.g. "instagram", "referral") — never required. */
  readonly channelHint: string | null;
  /** What BB published in this window (founder_event telemetry refs) — the link the later loop reads. */
  readonly publishedRefs: readonly string[];
  readonly reportedAt: string;
  readonly updatedAt: string;
}

export interface ReachReportInput {
  readonly businessId: string;
  readonly accountId: string;
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly newPeopleCount: number | null;
  readonly rawText: string;
  readonly channelHint?: string | null;
  readonly publishedRefs?: readonly string[];
}

export interface ReachReportPatch {
  readonly newPeopleCount?: number | null;
  readonly rawText?: string;
  readonly channelHint?: string | null;
}

/**
 * Port for the reach-report store. Reflective-only: there is deliberately NO method that returns a
 * `LicensedProposition` or feeds an asset context — adding one would breach the wall.
 */
export interface IReachReportRepository {
  create(input: ReachReportInput): Promise<ReachReport>;
  /** Newest first. */
  list(businessId: string): Promise<ReachReport[]>;
  get(businessId: string, id: string): Promise<ReachReport | null>;
  update(businessId: string, id: string, patch: ReachReportPatch): Promise<ReachReport | null>;
  delete(businessId: string, id: string): Promise<boolean>;
}
