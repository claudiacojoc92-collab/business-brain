/**
 * Business Brain V1 — Phase ② provenance types (pure; no I/O).
 *
 * These describe the REAL imported Instagram dataset and everything deterministically derived from
 * it. Nothing here is a fixture: an ImportedAccount is produced by the real Instagram import port;
 * the deterministic layers (signals, metrics, evidence, generation context) are pure computations
 * over it, so every downstream number is traceable to a persisted observation.
 */

/** One imported Instagram post — exactly what the Graph API returned, no fabrication. */
export interface ImportedPost {
  readonly postExternalId: string;      // IG media id
  readonly permalink: string | null;    // public URL — the human-checkable provenance handle
  readonly mediaType: string | null;    // IMAGE | VIDEO | CAROUSEL_ALBUM | ...
  readonly postedAt: string | null;     // ISO timestamp
  readonly caption: string;             // FULL caption (may be empty)
  readonly reach: number | null;        // null when Instagram did not return it (never faked)
  readonly likes: number | null;
  readonly comments: number | null;
}

/** The whole imported account for one refresh. */
export interface ImportedAccount {
  readonly accountExternalId: string | null;
  readonly username: string | null;
  readonly accountType: string | null;
  readonly followersCount: number | null;
  readonly mediaCount: number | null;   // account-reported total (context only)
  readonly posts: readonly ImportedPost[];
  readonly importedAt: string;          // ISO
}

/** Deterministic per-post signals — computed by code, never by the model. */
export interface PostSignals {
  readonly captionLength: number;
  readonly wordCount: number;
  readonly hashtagCount: number;
  readonly mentionCount: number;
  readonly hasLink: boolean;
  readonly hasCta: boolean;
}

/** A persisted observation = one imported post + its deterministic signals + an internal id. */
export interface ObservationRecord extends ImportedPost, PostSignals {
  readonly observationId: string;
}

/**
 * Deterministic account metrics — every value is a real computation over the observations.
 * Proportions are real count/total; averages are over posts where the metric was actually returned.
 * A value that cannot be computed (no posts, no metric) is null — never invented.
 */
export interface AccountMetrics {
  readonly postCount: number;
  readonly windowFrom: string | null;      // oldest postedAt (ISO)
  readonly windowTo: string | null;        // newest postedAt (ISO)
  readonly spanDays: number | null;
  readonly postsPerWeek: number | null;    // cadence
  readonly mediaTypeCounts: Readonly<Record<string, number>>;
  readonly mediaTypePct: Readonly<Record<string, number>>;
  readonly withCtaCount: number;
  readonly withCtaPct: number | null;      // real % = withCtaCount / postCount
  readonly withLinkCount: number;
  readonly withLinkPct: number | null;
  readonly avgCaptionChars: number | null;
  readonly avgHashtags: number | null;
  readonly reachAvailableCount: number;
  readonly avgReach: number | null;
  readonly avgLikes: number | null;
  readonly avgComments: number | null;
  readonly followersCount: number | null;
}

/**
 * The single structured context handed to the ONE LLM call. It carries the deterministic metrics,
 * the per-post captions + signals, and account facts. This exact object is persisted (frozen) and
 * hashed so a diagnosis is reproducible and every narrative claim traces to what the model saw.
 */
export interface GenerationContext {
  readonly account: {
    readonly username: string | null;
    readonly accountType: string | null;
    readonly followersCount: number | null;
    readonly mediaCount: number | null;
  };
  readonly window: { readonly from: string | null; readonly to: string | null; readonly postCount: number };
  readonly metrics: AccountMetrics;
  /**
   * The deterministic measures the model may CITE (by key) when grounding a root cause. Values here
   * are the only numbers the diagnosis is allowed to use — the grounding gate enforces it.
   */
  readonly evidence: ReadonlyArray<{ readonly key: string; readonly label: string; readonly kind: string; readonly value?: number }>;
  /** Bounded, ordered post digests the model reads — full caption + deterministic signals only. */
  readonly posts: ReadonlyArray<{
    readonly ref: string;            // permalink || postExternalId
    readonly mediaType: string | null;
    readonly postedAt: string | null;
    readonly caption: string;
    readonly likes: number | null;
    readonly comments: number | null;
    readonly reach: number | null;
    readonly hasCta: boolean;
    readonly hasLink: boolean;
    readonly hashtagCount: number;
  }>;
}
