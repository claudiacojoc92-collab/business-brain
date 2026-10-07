/**
 * Rendering is a separate presentation projection, regenerable without changing any semantic id.
 * Keyed by the content-hash `statementVersionId` + renderVersion + locale, so it is NOT
 * business-owned mutable state (the versionId already encodes the business) — hence its port does not
 * take businessRef.
 */
export interface RenderedSnapshotStatement {
  readonly statementVersionId: string;
  readonly renderVersion: string;
  readonly locale: string;
  readonly renderedText: string;
}

export interface RenderedSnapshotRepository {
  get(
    statementVersionId: string,
    renderVersion: string,
    locale: string,
  ): Promise<RenderedSnapshotStatement | null>;
  put(rendered: RenderedSnapshotStatement): Promise<void>;
}
