/**
 * Upload connector (M2.2) — shared types. Mirrors the website connector's shape: the
 * connector's only output is observed evidence; classification is provenance-typing +
 * redundancy (spec §4), never intent-detection.
 */
export type SupportedType = 'pdf' | 'docx' | 'text';
export type DetectedType = SupportedType | 'unsupported';

export interface UploadInput {
  founderId: string;
  filename: string;
  bytes: Buffer;
}

/** Where inside the document a fragment came from — as specific as the artifact allows (§8). */
export interface Anchor {
  kind: 'page' | 'section' | 'paragraph' | 'document';
  page?: number;        // 1-based, PDF
  section?: string;     // heading path, DOCX/markdown
  paragraph?: number;   // 1-based, text
  label: string;        // human-facing: "slide 7", "Positioning", "paragraph 3"
}

export interface ExtractedUnit {
  /** page/section-level text (engine input in Phase 2) */
  text: string;
  anchor: Anchor;
  /** finer blocks within the unit (resolution units, mirrors M2.1 leaf/group blocks) */
  blocks: Array<{ text: string; blockType: string }>;
}

export type ProvenanceStrength = 'strong' | 'weak';

export interface ExtractedDoc {
  type: SupportedType;
  filename: string;
  contentHash: string;                 // sha256 of the file bytes — document identity
  units: ExtractedUnit[];
  provenanceStrength: ProvenanceStrength;
  pageCount: number;
  empty: boolean;                      // readable file, no meaningful content (§10 Empty)
}

export type ProvenanceType = 'observed-artifact' | 'redundant';

/** A unit after classification: whether it duplicates already-connected reality (§4 Axis A). */
export interface ClassifiedUnit {
  unit: ExtractedUnit;
  provenanceType: ProvenanceType;
  /** if redundant: how much of the unit overlapped existing observed reality (0..1) */
  overlap: number;
}

export type UploadState =
  | 'reading' | 'synced' | 'partial' | 'empty' | 'redundant' | 'unsupported' | 'failed';

export interface UploadReadResult {
  state: UploadState;
  founderId: string;
  filename: string;
  type: DetectedType;
  provenanceStrength: ProvenanceStrength | null;
  unitsRead: number;
  fragmentsStored: number;
  fragmentsDeduped: number;
  redundantUnits: number;
  error?: string;
}
