/**
 * Extraction descriptor (L2). Records HOW a normalized value was derived from L1, so a probabilistic
 * classification can never masquerade as an unquestioned world fact. Not perfect reversibility —
 * traceable, reproducible-where-possible, source-locus-linked, rule-versioned, loss-disclosed.
 */
export type ExtractionMode =
  | 'deterministic'
  | 'model'
  | 'ocr'
  | 'classification'
  | 'segmentation';

export interface Extraction {
  readonly ruleKey: string;
  readonly ruleVersion: string;
  readonly mode: ExtractionMode;
  readonly sourceLocus: string;
  readonly reproducible: boolean;
  readonly extractionConfidence?: 'high' | 'medium' | 'low';
  readonly informationLoss?: string;
}
