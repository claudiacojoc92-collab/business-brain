import { generateId } from '@bb/shared';
import { ContentPiece, type InternalBrief } from '@bb/domain';
import {
  validateContentOutput,
  checkPieceSetCompleteness,
  type ContentValidationContext,
  type CtaStyle,
} from './content-validators';
import type { ContentPieceOutput } from './content-schemas';

/** Thrown for any unrecoverable CEL condition; the worker maps it to ContentGenerationFailed. */
export class ContentExecutionError extends Error {}

/** Minimal LLM surface (the real LLMRouter satisfies it; mockable in tests). */
export interface LlmCaller {
  call(opts: { promptId: string; variables: Record<string, string> }): Promise<{ content: string }>;
}

export interface CelLogger {
  info(obj: unknown, msg: string): void;
  warn(obj: unknown, msg: string): void;
}

export interface ContentExecutionConfig {
  /** Regenerations allowed per piece on REGENERATE outcomes (default 2). */
  maxRegenPerPiece: number;
  /** Wall-clock budget for the whole job in ms (default 90 min). */
  wallClockMs: number;
  /** Injectable clock (ms since epoch) for deterministic tests. */
  now: () => number;
}

export const DEFAULT_CEL_CONFIG: ContentExecutionConfig = {
  maxRegenPerPiece: 2,
  wallClockMs: 90 * 60 * 1000,
  now: () => Date.now(),
};

/** Resolved generation target derived from one (free-form) piece_objective. */
export interface PieceSpec {
  pieceId: string;            // R1..R3 | C1..C2
  format: 'REEL' | 'CAROUSEL';
  role: string;
  objective: string;
  beliefTargetRef: string;
  priority: number;
}

const PROMPT_ID = 'PR-012';

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function detectFormat(obj: Record<string, unknown>): 'REEL' | 'CAROUSEL' | null {
  for (const c of [obj.format, obj.piece_type, obj.pieceType, obj.role, obj.type]) {
    const s = asString(c)?.toUpperCase();
    if (!s) continue;
    if (s.includes('REEL')) return 'REEL';
    if (s.includes('CAROUSEL')) return 'CAROUSEL';
  }
  return null;
}

function detectPriority(obj: Record<string, unknown>, index: number): number {
  const p = obj.priority;
  if (typeof p === 'number') return p;
  if (typeof p === 'string' && p.trim() !== '' && !Number.isNaN(Number(p))) return Number(p);
  return index + 1; // fall back to declared order
}

/**
 * Resolve the ordered piece set from brief.pieceObjectives.
 * piece_objectives is unconstrained (z.record(z.unknown()) in the frozen S11), so format,
 * priority, role and belief target are read defensively; an objective whose format cannot be
 * determined, or a count beyond the schema enums (3 reels / 2 carousels), fails the job.
 */
export function resolvePieceSpecs(brief: InternalBrief): PieceSpec[] {
  const objectives = (brief.pieceObjectives as unknown[]).map((o, i) => ({
    obj: (o ?? {}) as Record<string, unknown>,
    i,
  }));
  objectives.sort((a, b) => detectPriority(a.obj, a.i) - detectPriority(b.obj, b.i));

  let reels = 0;
  let carousels = 0;
  const specs: PieceSpec[] = [];
  for (const { obj, i } of objectives) {
    const format = detectFormat(obj);
    if (!format) {
      throw new ContentExecutionError(`UNRESOLVABLE_PIECE_OBJECTIVE: cannot determine format for objective ${i}`);
    }
    let pieceId: string;
    if (format === 'REEL') {
      reels += 1;
      if (reels > 3) throw new ContentExecutionError('TOO_MANY_REELS: piece_objectives exceed 3 reels');
      pieceId = `R${reels}`;
    } else {
      carousels += 1;
      if (carousels > 2) throw new ContentExecutionError('TOO_MANY_CAROUSELS: piece_objectives exceed 2 carousels');
      pieceId = `C${carousels}`;
    }
    specs.push({
      pieceId,
      format,
      role:            asString(obj.role) ?? asString(obj.piece_role) ?? format,
      objective:       asString(obj.objective) ?? asString(obj.description) ?? '',
      beliefTargetRef: asString(obj.belief_target_ref) ?? asString(obj.belief_target) ?? brief.beliefTargetPrimary,
      priority:        detectPriority(obj, i),
    });
  }
  return specs;
}

export function extractCtaStyle(brief: InternalBrief): CtaStyle {
  const raw = brief.voiceParameters['cta_style'];
  const s = typeof raw === 'string' ? raw.toUpperCase() : '';
  if (s === 'NONE' || s === 'SOFT' || s === 'INVITATION' || s === 'DIRECT') return s;
  return 'INVITATION'; // default register when the brief does not specify one
}

export function buildNeverList(brief: InternalBrief): string[] {
  return [...brief.hardBlocks, ...brief.voiceBoundaries];
}

export function extractAvoidPhrases(brief: InternalBrief): string[] {
  const ap = brief.audienceLanguage['avoid_phrases'];
  return Array.isArray(ap) ? ap.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Generates and validates content_pieces for a committed brief.
 * Pure of persistence/transport: returns built ContentPiece entities (AWAITING_APPROVAL)
 * or throws ContentExecutionError. Persistence/idempotency/events are the worker's job.
 */
export class ContentExecutionService {
  constructor(
    private readonly llm: LlmCaller,
    private readonly logger: CelLogger,
    private readonly config: ContentExecutionConfig = DEFAULT_CEL_CONFIG,
  ) {}

  async execute(brief: InternalBrief): Promise<ContentPiece[]> {
    const specs = resolvePieceSpecs(brief);
    if (specs.length === 0) throw new ContentExecutionError('NO_PIECE_OBJECTIVES');

    const validation: ContentValidationContext = {
      neverList:            buildNeverList(brief),
      ctaStyle:             extractCtaStyle(brief),
      audienceAvoidPhrases: extractAvoidPhrases(brief),
    };

    const deadline = this.config.now() + this.config.wallClockMs;
    const pieces: ContentPiece[] = [];
    const producedIds: string[] = [];

    for (const spec of specs) { // sequential, priority order
      pieces.push(await this.generatePiece(spec, brief, validation, deadline));
      producedIds.push(spec.pieceId);
    }

    const completeness = checkPieceSetCompleteness(producedIds, specs.map((s) => s.pieceId));
    if (completeness.length > 0) {
      throw new ContentExecutionError(`INCOMPLETE_PIECE_SET: ${completeness.map((i) => i.detail).join('; ')}`);
    }

    return pieces;
  }

  private async generatePiece(
    spec: PieceSpec,
    brief: InternalBrief,
    validation: ContentValidationContext,
    deadline: number,
  ): Promise<ContentPiece> {
    const maxAttempts = this.config.maxRegenPerPiece + 1;
    let lastDetail = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.config.now() > deadline) {
        throw new ContentExecutionError(`CONTENT_GENERATION_TIMEOUT on ${spec.pieceId}`);
      }

      const res = await this.llm.call({ promptId: PROMPT_ID, variables: assembleVariables(brief, spec, validation) });
      const outcome = await validateContentOutput(res.content, validation);

      if (outcome.severity === 'PASS' && outcome.piece) {
        return buildContentPiece(brief, spec, outcome.piece);
      }
      if (outcome.severity === 'FAIL_NO_RETRY') {
        throw new ContentExecutionError(
          `NEVER_LIST_VIOLATION on ${spec.pieceId}: ${outcome.issues.map((i) => i.detail).join('; ')}`,
        );
      }
      lastDetail = outcome.issues.map((i) => i.rule).join(',');
      this.logger.warn({ pieceId: spec.pieceId, attempt, issues: outcome.issues }, 'CEL piece regenerate');
    }

    throw new ContentExecutionError(`REGEN_EXHAUSTED on ${spec.pieceId} after ${maxAttempts} attempts: ${lastDetail}`);
  }
}

function assembleVariables(
  brief: InternalBrief,
  spec: PieceSpec,
  validation: ContentValidationContext,
): Record<string, string> {
  return {
    COMMITTED_BRIEF: JSON.stringify({
      mode:                   brief.mode,
      belief_target_primary:  brief.beliefTargetPrimary,
      belief_gap_addressed:   brief.beliefGapAddressed,
      audience_segment:       brief.audienceSegment,
      audience_temperature:   brief.audienceTemperature,
      relationship_move_type: brief.relationshipMoveType,
      relationship_move_desc: brief.relationshipMoveDesc,
      strategic_purpose:      brief.strategicPurpose,
      offer_constraints:      brief.offerConstraints,
    }),
    PIECE_OBJECTIVE: JSON.stringify({
      piece_id:          spec.pieceId,
      format:            spec.format,
      role:              spec.role,
      objective:         spec.objective,
      belief_target_ref: spec.beliefTargetRef,
    }),
    CONVICTION_ANGLE:  brief.convictionAngle,
    AUDIENCE_LANGUAGE: JSON.stringify(brief.audienceLanguage),
    VOICE_PARAMETERS:  JSON.stringify(brief.voiceParameters),
    NEVER_LIST:        JSON.stringify(validation.neverList),
    CTA_STYLE:         validation.ctaStyle,
  };
}

function buildContentPiece(brief: InternalBrief, spec: PieceSpec, output: ContentPieceOutput): ContentPiece {
  return new ContentPiece({
    id:                      generateId(),
    cycleId:                 brief.cycleId,
    founderId:               brief.founderId,
    briefId:                 brief.id,
    pieceType:               spec.format,
    pieceRole:               spec.role,
    contentBlobKey:          null,
    contentPreview:          JSON.stringify(output),
    approvalStatus:          'AWAITING_APPROVAL',
    approvalWindowExpiresAt: null,
    approvedAt:              null,
    rejectedAt:              null,
    rejectionReasonCode:     null,
    publishedAt:             null,
    platformPostId:          null,
  });
}
