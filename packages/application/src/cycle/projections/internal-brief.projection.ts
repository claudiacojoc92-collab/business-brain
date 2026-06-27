/**
 * Application-layer port for writing the committed brief into the
 * internal_briefs read model. Implemented in @bb/infrastructure
 * (PgInternalBriefProjection). Keeps CommitBriefHandler free of any
 * direct infrastructure dependency.
 */
export interface IInternalBriefProjection {
  upsert(
    brief: Record<string, unknown>,
    cycleId: string,
    founderId: string,
    isFallback: boolean,
    fallbackReason: string | null,
    tx: unknown,
  ): Promise<void>;
}
